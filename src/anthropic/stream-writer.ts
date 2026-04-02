/** Emits Anthropic-compatible SSE events from provider stream chunks. */

import type { StreamChunkLike } from "../types/internal.js";
import { AnthropicResponseSerializer } from "./serializer.js";

type SSEWriter = (event: string, data: unknown) => void;

/** Maintains block state while converting provider chunks into SSE events. */
export class AnthropicStreamWriter {
  private blockIndex = 0;
  private thinkingBlockStarted = false;
  private textBlockStarted = false;
  private currentToolBlockIndex: number | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private responseTextBuffer = "";

  /** Consumes the provider stream and writes the full SSE response. */
  async writeStream(
    model: string,
    generator: AsyncGenerator<StreamChunkLike, void, undefined>,
    writer: SSEWriter,
    requestId?: string
  ): Promise<{ responseText: string }> {
    const messageId =
      requestId ?? AnthropicResponseSerializer.generateMessageId();

    writer("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });

    writer("ping", { type: "ping" });

    this.pingInterval = setInterval(() => {
      writer("ping", { type: "ping" });
    }, 15_000);

    let finalUsage = { prompt_tokens: 0, completion_tokens: 0 };
    let finalFinishReason = "stop";

    try {
      for await (const chunk of generator) {
        if (chunk.done) {
          if (chunk.usage) {
            finalUsage = {
              prompt_tokens: chunk.usage.prompt_tokens,
              completion_tokens: chunk.usage.completion_tokens,
            };
          }
          if (chunk.finishReason) {
            finalFinishReason = chunk.finishReason;
          }
          break;
        }

        this.processChunk(chunk, writer);
      }

      this.closeAllBlocks(writer);

      const stopReason =
        AnthropicResponseSerializer.mapStopReason(finalFinishReason);
      writer("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: stopReason,
          stop_sequence: null,
        },
        usage: {
          output_tokens: finalUsage.completion_tokens,
        },
      });

      writer("message_stop", { type: "message_stop" });
    } catch (error) {
      console.error("[AnthropicStreamWriter] Generator error:", error);

      this.closeLastOpenBlock(writer);

      writer("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: "end_turn",
          stop_sequence: null,
        },
        usage: {
          output_tokens: 0,
        },
      });

      writer("message_stop", { type: "message_stop" });
    } finally {
      this.clearPingInterval();
    }

    return { responseText: this.responseTextBuffer };
  }

  private processChunk(chunk: StreamChunkLike, writer: SSEWriter): void {
    if (chunk.reasoningDelta) {
      this.handleReasoningDelta(chunk.reasoningDelta, writer);
    }

    if (chunk.content) {
      this.handleTextDelta(chunk.content, writer);
    }

    if (chunk.toolCallDelta) {
      this.handleToolCallDelta(chunk.toolCallDelta, writer);
    }
  }

  private handleReasoningDelta(delta: string, writer: SSEWriter): void {
    if (!this.thinkingBlockStarted) {
      writer("content_block_start", {
        type: "content_block_start",
        index: this.blockIndex,
        content_block: { type: "thinking", thinking: "" },
      });
      this.thinkingBlockStarted = true;
    }

    writer("content_block_delta", {
      type: "content_block_delta",
      index: this.blockIndex,
      delta: { type: "thinking_delta", thinking: delta },
    });
  }

  private handleTextDelta(content: string, writer: SSEWriter): void {
    if (this.thinkingBlockStarted) {
      this.closeThinkingBlock(writer);
    }

    if (!this.textBlockStarted) {
      writer("content_block_start", {
        type: "content_block_start",
        index: this.blockIndex,
        content_block: { type: "text", text: "" },
      });
      this.textBlockStarted = true;
    }

    this.responseTextBuffer += content;

    writer("content_block_delta", {
      type: "content_block_delta",
      index: this.blockIndex,
      delta: { type: "text_delta", text: content },
    });
  }

  private handleToolCallDelta(
    delta: NonNullable<StreamChunkLike["toolCallDelta"]>,
    writer: SSEWriter
  ): void {
    if (delta.id && delta.name) {
      if (this.textBlockStarted) {
        this.closeTextBlock(writer);
      }

      if (this.currentToolBlockIndex !== null) {
        this.closeToolBlock(writer);
      }

      this.currentToolBlockIndex = this.blockIndex;
      writer("content_block_start", {
        type: "content_block_start",
        index: this.blockIndex,
        content_block: {
          type: "tool_use",
          id: delta.id,
          name: delta.name,
          input: {},
        },
      });
      this.blockIndex++;
    }

    if (delta.argumentsDelta) {
      // Some upstreams emit argument deltas before a fully-populated tool start
      // chunk. Keeping the current index is safer than dropping those deltas.
      const idx =
        this.currentToolBlockIndex !== null
          ? this.currentToolBlockIndex
          : this.blockIndex;

      writer("content_block_delta", {
        type: "content_block_delta",
        index: idx,
        delta: {
          type: "input_json_delta",
          partial_json: delta.argumentsDelta,
        },
      });
    }
  }

  private closeThinkingBlock(writer: SSEWriter): void {
    if (!this.thinkingBlockStarted) return;
    writer("content_block_stop", {
      type: "content_block_stop",
      index: this.blockIndex,
    });
    this.thinkingBlockStarted = false;
    this.blockIndex++;
  }

  private closeTextBlock(writer: SSEWriter): void {
    if (!this.textBlockStarted) return;
    writer("content_block_stop", {
      type: "content_block_stop",
      index: this.blockIndex,
    });
    this.textBlockStarted = false;
    this.blockIndex++;
  }

  private closeToolBlock(writer: SSEWriter): void {
    if (this.currentToolBlockIndex === null) return;
    writer("content_block_stop", {
      type: "content_block_stop",
      index: this.currentToolBlockIndex,
    });
    this.currentToolBlockIndex = null;
  }

  private closeAllBlocks(writer: SSEWriter): void {
    if (this.thinkingBlockStarted) this.closeThinkingBlock(writer);
    if (this.textBlockStarted) this.closeTextBlock(writer);
    if (this.currentToolBlockIndex !== null) this.closeToolBlock(writer);
  }

  private closeLastOpenBlock(writer: SSEWriter): void {
    if (this.currentToolBlockIndex !== null) {
      this.closeToolBlock(writer);
    } else if (this.textBlockStarted) {
      this.closeTextBlock(writer);
    } else if (this.thinkingBlockStarted) {
      this.closeThinkingBlock(writer);
    }
  }

  private clearPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
