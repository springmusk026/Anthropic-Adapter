/** Serializes provider completions into Anthropic-style message responses. */

import type { ParsedCompletionLike } from "../types/internal.js";

interface AnthropicResponseContentBlock {
  type: string;
  [key: string]: unknown;
}

interface AnthropicMessageResponseShape {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicResponseContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicResponseSerializer {
  /** Converts one completion into the public JSON response shape. */
  serialize(
    completion: ParsedCompletionLike,
    requestModel: string
  ): AnthropicMessageResponseShape {
    const content = this.buildContentBlocks(completion);
    const stopReason = AnthropicResponseSerializer.mapStopReason(
      completion.stopReason
    );

    return {
      id: AnthropicResponseSerializer.generateMessageId(),
      type: "message",
      role: "assistant",
      content,
      model: requestModel,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: completion.promptTokens,
        output_tokens: completion.completionTokens,
      },
    };
  }

  private buildContentBlocks(
    completion: ParsedCompletionLike
  ): AnthropicResponseContentBlock[] {
    const blocks: AnthropicResponseContentBlock[] = [];

    if (completion.reasoning && completion.reasoning.length > 0) {
      blocks.push({
        type: "thinking",
        thinking: completion.reasoning,
      });
    }

    if (completion.text && completion.text.length > 0) {
      blocks.push({
        type: "text",
        text: completion.text,
      });
    }

    for (const toolCall of completion.toolCalls) {
      blocks.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.function.name,
        input: AnthropicResponseSerializer.parseToolArguments(
          toolCall.function.arguments
        ),
      });
    }

    if (blocks.length === 0) {
      blocks.push({ type: "text", text: "" });
    }

    return blocks;
  }

  static mapStopReason(internalReason: string): string {
    switch (internalReason) {
      case "stop":
        return "end_turn";
      case "length":
        return "max_tokens";
      case "tool_calls":
        return "tool_use";
      default:
        return "end_turn";
    }
  }

  /**
   * Tool arguments are returned as JSON when possible because Anthropic tool
   * blocks expect structured input. When upstream returns malformed JSON, the
   * raw string is preserved so the payload is still inspectable.
   */
  static parseToolArguments(args: string): unknown {
    try {
      return JSON.parse(args);
    } catch {
      return args;
    }
  }

  static generateMessageId(): string {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let id = "msg_";
    for (let i = 0; i < 24; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }
}
