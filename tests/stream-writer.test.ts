/**
 * Streaming SSE writer tests.
 */

import { describe, it, expect } from "bun:test";
import { AnthropicStreamWriter } from "../src/anthropic/stream-writer.js";
import type { StreamChunkLike } from "../src/types/internal.js";

/** Collect all SSE events emitted by the stream writer. */
interface CollectedEvent {
  event: string;
  data: Record<string, unknown>;
}

function collectEvents(): { events: CollectedEvent[]; writer: (event: string, data: unknown) => void } {
  const events: CollectedEvent[] = [];
  const writer = (event: string, data: unknown) => {
    events.push({ event, data: data as Record<string, unknown> });
  };
  return { events, writer };
}

async function* chunksToGenerator(
  chunks: StreamChunkLike[]
): AsyncGenerator<StreamChunkLike, void, undefined> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("AnthropicStreamWriter", () => {
  // ── Streaming text path ────────────────────────────────────────

  it("streams text deltas correctly", async () => {
    const streamWriter = new AnthropicStreamWriter();
    const { events, writer } = collectEvents();

    const chunks: StreamChunkLike[] = [
      { content: "Hello", done: false },
      { content: " world", done: false },
      {
        done: true,
        finishReason: "stop",
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      },
    ];

    await streamWriter.writeStream(
      "claude-3-sonnet",
      chunksToGenerator(chunks),
      writer
    );

    // message_start
    expect(events[0].event).toBe("message_start");
    expect((events[0].data as any).message.model).toBe("claude-3-sonnet");

    // initial ping
    expect(events[1].event).toBe("ping");

    // content_block_start (text)
    expect(events[2].event).toBe("content_block_start");
    expect((events[2].data as any).content_block.type).toBe("text");
    expect((events[2].data as any).index).toBe(0);

    // text deltas
    expect(events[3].event).toBe("content_block_delta");
    expect((events[3].data as any).delta.type).toBe("text_delta");
    expect((events[3].data as any).delta.text).toBe("Hello");

    expect(events[4].event).toBe("content_block_delta");
    expect((events[4].data as any).delta.text).toBe(" world");

    // content_block_stop
    expect(events[5].event).toBe("content_block_stop");
    expect((events[5].data as any).index).toBe(0);

    // message_delta
    expect(events[6].event).toBe("message_delta");
    expect((events[6].data as any).delta.stop_reason).toBe("end_turn");
    expect((events[6].data as any).usage.output_tokens).toBe(3);

    // message_stop
    expect(events[7].event).toBe("message_stop");
  });

  // ── Streaming thinking path ────────────────────────────────────

  it("streams thinking then text deltas correctly", async () => {
    const streamWriter = new AnthropicStreamWriter();
    const { events, writer } = collectEvents();

    const chunks: StreamChunkLike[] = [
      { reasoningDelta: "Let me think", done: false },
      { reasoningDelta: " step by step", done: false },
      { content: "The answer is 42", done: false },
      {
        done: true,
        finishReason: "stop",
        usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 },
      },
    ];

    await streamWriter.writeStream(
      "claude-3-opus",
      chunksToGenerator(chunks),
      writer
    );

    // Find thinking block events
    const thinkingStart = events.find(
      (e) =>
        e.event === "content_block_start" &&
        (e.data as any).content_block?.type === "thinking"
    );
    expect(thinkingStart).toBeDefined();
    expect((thinkingStart!.data as any).index).toBe(0);

    // Find thinking deltas
    const thinkingDeltas = events.filter(
      (e) =>
        e.event === "content_block_delta" &&
        (e.data as any).delta?.type === "thinking_delta"
    );
    expect(thinkingDeltas).toHaveLength(2);
    expect((thinkingDeltas[0].data as any).delta.thinking).toBe("Let me think");
    expect((thinkingDeltas[1].data as any).delta.thinking).toBe(" step by step");

    // Find thinking block stop (should come before text start)
    const blockStops = events.filter((e) => e.event === "content_block_stop");
    expect(blockStops.length).toBeGreaterThanOrEqual(2); // thinking stop + text stop

    // Find text block start
    const textStart = events.find(
      (e) =>
        e.event === "content_block_start" &&
        (e.data as any).content_block?.type === "text"
    );
    expect(textStart).toBeDefined();
    expect((textStart!.data as any).index).toBe(1);

    // Find text delta
    const textDeltas = events.filter(
      (e) =>
        e.event === "content_block_delta" &&
        (e.data as any).delta?.type === "text_delta"
    );
    expect(textDeltas).toHaveLength(1);
    expect((textDeltas[0].data as any).delta.text).toBe("The answer is 42");
  });

  // ── Streaming tool-use path ────────────────────────────────────

  it("streams tool-use with argument deltas", async () => {
    const streamWriter = new AnthropicStreamWriter();
    const { events, writer } = collectEvents();

    const chunks: StreamChunkLike[] = [
      { content: "Let me search.", done: false },
      {
        toolCallDelta: { index: 0, id: "call_abc", name: "search" },
        done: false,
      },
      {
        toolCallDelta: { index: 0, argumentsDelta: '{"query":' },
        done: false,
      },
      {
        toolCallDelta: { index: 0, argumentsDelta: '"weather"}' },
        done: false,
      },
      {
        done: true,
        finishReason: "tool_calls",
        usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
      },
    ];

    await streamWriter.writeStream(
      "claude-3-sonnet",
      chunksToGenerator(chunks),
      writer
    );

    // Text block start
    const textStart = events.find(
      (e) =>
        e.event === "content_block_start" &&
        (e.data as any).content_block?.type === "text"
    );
    expect(textStart).toBeDefined();

    // Tool block start
    const toolStart = events.find(
      (e) =>
        e.event === "content_block_start" &&
        (e.data as any).content_block?.type === "tool_use"
    );
    expect(toolStart).toBeDefined();
    expect((toolStart!.data as any).content_block.id).toBe("call_abc");
    expect((toolStart!.data as any).content_block.name).toBe("search");
    expect((toolStart!.data as any).content_block.input).toEqual({});

    // Argument deltas
    const jsonDeltas = events.filter(
      (e) =>
        e.event === "content_block_delta" &&
        (e.data as any).delta?.type === "input_json_delta"
    );
    expect(jsonDeltas).toHaveLength(2);
    expect((jsonDeltas[0].data as any).delta.partial_json).toBe('{"query":');
    expect((jsonDeltas[1].data as any).delta.partial_json).toBe('"weather"}');

    // message_delta shows tool_use stop reason
    const messageDelta = events.find((e) => e.event === "message_delta");
    expect((messageDelta!.data as any).delta.stop_reason).toBe("tool_use");
  });

  // ── Streaming error mid-flight ─────────────────────────────────

  it("handles generator error gracefully", async () => {
    const streamWriter = new AnthropicStreamWriter();
    const { events, writer } = collectEvents();

    async function* failingGenerator(): AsyncGenerator<
      StreamChunkLike,
      void,
      undefined
    > {
      yield { content: "Starting...", done: false };
      throw new Error("Provider exploded");
    }

    await streamWriter.writeStream(
      "claude-3-sonnet",
      failingGenerator(),
      writer
    );

    // Should still have message_start
    expect(events[0].event).toBe("message_start");

    // Should end with message_delta + message_stop
    const messageDelta = events.find((e) => e.event === "message_delta");
    expect(messageDelta).toBeDefined();
    expect((messageDelta!.data as any).delta.stop_reason).toBe("end_turn");
    expect((messageDelta!.data as any).usage.output_tokens).toBe(0);

    const messageStop = events.find((e) => e.event === "message_stop");
    expect(messageStop).toBeDefined();
  });

  // ── Empty stream ───────────────────────────────────────────────

  it("handles stream with only done chunk", async () => {
    const streamWriter = new AnthropicStreamWriter();
    const { events, writer } = collectEvents();

    const chunks: StreamChunkLike[] = [
      {
        done: true,
        finishReason: "stop",
        usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
      },
    ];

    await streamWriter.writeStream(
      "claude-3-haiku",
      chunksToGenerator(chunks),
      writer
    );

    expect(events[0].event).toBe("message_start");
    expect(events[1].event).toBe("ping");

    // message_delta + message_stop should be at the end
    const lastTwo = events.slice(-2);
    expect(lastTwo[0].event).toBe("message_delta");
    expect(lastTwo[1].event).toBe("message_stop");
  });

  // ── Block transitions ──────────────────────────────────────────

  it("closes text block before opening tool block", async () => {
    const streamWriter = new AnthropicStreamWriter();
    const { events, writer } = collectEvents();

    const chunks: StreamChunkLike[] = [
      { content: "Text first", done: false },
      {
        toolCallDelta: { index: 0, id: "call_1", name: "tool1" },
        done: false,
      },
      {
        done: true,
        finishReason: "tool_calls",
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      },
    ];

    await streamWriter.writeStream(
      "claude-3-sonnet",
      chunksToGenerator(chunks),
      writer
    );

    // Find the text block stop and tool block start
    const eventTypes = events.map((e) => e.event);
    const textStopIdx = eventTypes.indexOf("content_block_stop");
    const toolStartIdx = eventTypes.lastIndexOf("content_block_start");

    // Text block should be stopped before tool block starts
    expect(textStopIdx).toBeLessThan(toolStartIdx);
  });
});
