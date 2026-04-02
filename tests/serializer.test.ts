/**
 * Non-streaming response serializer tests.
 */

import { describe, it, expect } from "bun:test";
import { AnthropicResponseSerializer } from "../src/anthropic/serializer.js";
import type { ParsedCompletionLike } from "../src/types/internal.js";

describe("AnthropicResponseSerializer", () => {
  const serializer = new AnthropicResponseSerializer();

  // ── Text-only non-streaming ──────────────────────────────────────

  it("serializes text-only completion", () => {
    const completion: ParsedCompletionLike = {
      text: "Hello, world!",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 10,
      completionTokens: 5,
    };

    const result = serializer.serialize(completion, "claude-3-sonnet");

    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.model).toBe("claude-3-sonnet");
    expect(result.stop_reason).toBe("end_turn");
    expect(result.stop_sequence).toBeNull();
    expect(result.id).toStartWith("msg_");
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: "Hello, world!" });
  });

  // ── Tool-use-only non-streaming ──────────────────────────────────

  it("serializes tool-use-only completion", () => {
    const completion: ParsedCompletionLike = {
      text: "",
      toolCalls: [
        {
          id: "call_123",
          function: {
            name: "search",
            arguments: '{"query":"weather"}',
          },
        },
      ],
      stopReason: "tool_calls",
      promptTokens: 15,
      completionTokens: 10,
    };

    const result = serializer.serialize(completion, "claude-3-opus");

    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "tool_use",
      id: "call_123",
      name: "search",
      input: { query: "weather" },
    });
  });

  // ── Text plus tool-use non-streaming ─────────────────────────────

  it("serializes text plus tool-use completion", () => {
    const completion: ParsedCompletionLike = {
      text: "Let me search that for you.",
      toolCalls: [
        {
          id: "call_456",
          function: {
            name: "web_search",
            arguments: '{"q":"bun runtime"}',
          },
        },
      ],
      stopReason: "tool_calls",
      promptTokens: 20,
      completionTokens: 15,
    };

    const result = serializer.serialize(completion, "claude-3-sonnet");

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Let me search that for you.",
    });
    expect(result.content[1]).toEqual({
      type: "tool_use",
      id: "call_456",
      name: "web_search",
      input: { q: "bun runtime" },
    });
  });

  // ── Reasoning plus text non-streaming ────────────────────────────

  it("serializes reasoning plus text completion", () => {
    const completion: ParsedCompletionLike = {
      text: "The answer is 42.",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 12,
      completionTokens: 8,
      reasoning: "I need to think about the meaning of life...",
    };

    const result = serializer.serialize(completion, "claude-3-opus");

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({
      type: "thinking",
      thinking: "I need to think about the meaning of life...",
    });
    expect(result.content[1]).toEqual({
      type: "text",
      text: "The answer is 42.",
    });
  });

  // ── Empty output fallback ────────────────────────────────────────

  it("emits empty text block when output is empty", () => {
    const completion: ParsedCompletionLike = {
      text: "",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 5,
      completionTokens: 0,
    };

    const result = serializer.serialize(completion, "claude-3-haiku");

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: "" });
  });

  // ── Malformed tool JSON fallback ─────────────────────────────────

  it("keeps raw string when tool arguments are invalid JSON", () => {
    const completion: ParsedCompletionLike = {
      text: "",
      toolCalls: [
        {
          id: "call_bad",
          function: {
            name: "execute",
            arguments: "this is not json {{{",
          },
        },
      ],
      stopReason: "tool_calls",
      promptTokens: 10,
      completionTokens: 5,
    };

    const result = serializer.serialize(completion, "claude-3-sonnet");

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "tool_use",
      id: "call_bad",
      name: "execute",
      input: "this is not json {{{",
    });
  });

  // ── Stop reason mapping ──────────────────────────────────────────

  it.each([
    ["stop", "end_turn"],
    ["length", "max_tokens"],
    ["tool_calls", "tool_use"],
    ["unknown_reason", "end_turn"],
    ["", "end_turn"],
  ])("maps stop reason '%s' to '%s'", (input, expected) => {
    expect(AnthropicResponseSerializer.mapStopReason(input)).toBe(expected);
  });

  // ── Block ordering: thinking -> text -> tool_use ─────────────────

  it("preserves block ordering: thinking → text → tool_use", () => {
    const completion: ParsedCompletionLike = {
      text: "Here's what I found.",
      toolCalls: [
        {
          id: "call_789",
          function: { name: "read_file", arguments: '{"path":"/tmp/test"}' },
        },
      ],
      stopReason: "tool_calls",
      promptTokens: 20,
      completionTokens: 15,
      reasoning: "Let me think step by step...",
    };

    const result = serializer.serialize(completion, "claude-3-opus");

    expect(result.content).toHaveLength(3);
    expect(result.content[0].type).toBe("thinking");
    expect(result.content[1].type).toBe("text");
    expect(result.content[2].type).toBe("tool_use");
  });

  // ── ID format ────────────────────────────────────────────────────

  it("generates msg_ prefixed IDs", () => {
    const id = AnthropicResponseSerializer.generateMessageId();
    expect(id).toStartWith("msg_");
    expect(id.length).toBe(28); // "msg_" + 24 chars
  });
});
