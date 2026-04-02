/**
 * Request normalizer tests.
 */

import { describe, it, expect } from "bun:test";
import { AnthropicRequestNormalizer } from "../src/anthropic/normalizer.js";

describe("AnthropicRequestNormalizer", () => {
  const normalizer = new AnthropicRequestNormalizer();

  // ── System flattening (string) ─────────────────────────────────

  it("flattens string system into system message", () => {
    const result = normalizer.normalize({
      model: "claude-3-sonnet",
      max_tokens: 100,
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hi" }],
    } as any);

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(result.messages[1]).toEqual({ role: "user", content: "Hi" });
  });

  // ── System flattening (content blocks) ─────────────────────────

  it("flattens system content blocks into single system message", () => {
    const result = normalizer.normalize({
      model: "claude-3-sonnet",
      max_tokens: 100,
      system: [
        { type: "text", text: "You are helpful." },
        { type: "text", text: "Be concise." },
      ],
      messages: [{ role: "user", content: "Hi" }],
    } as any);

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are helpful.\nBe concise.",
    });
  });

  // ── User text message ──────────────────────────────────────────

  it("converts simple user text message", () => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hello world" }],
    } as any);

    expect(result.messages[0]).toEqual({
      role: "user",
      content: "Hello world",
    });
  });

  // ── User content block array ───────────────────────────────────

  it("converts user content block array", () => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this" },
            { type: "text", text: "and this" },
          ],
        },
      ],
    } as any);

    expect(result.messages[0]).toEqual({
      role: "user",
      content: "Look at this\nand this",
    });
  });

  // ── tool_result → tool role ────────────────────────────────────

  it("converts tool_result blocks into tool-role messages", () => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_123",
              content: "Search results here",
            },
          ],
        },
      ],
    } as any);

    expect(result.messages[0]).toEqual({
      role: "tool",
      toolCallId: "call_123",
      content: "Search results here",
    });
  });

  // ── tool_result with nested content blocks ─────────────────────

  it("extracts text from tool_result with nested content blocks", () => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_456",
              content: [
                { type: "text", text: "Result line 1" },
                { type: "text", text: "Result line 2" },
              ],
            },
          ],
        },
      ],
    } as any);

    expect(result.messages[0]).toEqual({
      role: "tool",
      toolCallId: "call_456",
      content: "Result line 1\nResult line 2",
    });
  });

  // ── Assistant tool_use → tool calls ────────────────────────────

  it("converts assistant tool_use blocks into tool calls", () => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 100,
      messages: [
        { role: "user", content: "Search for weather" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me search." },
            {
              type: "tool_use",
              id: "call_789",
              name: "search",
              input: { query: "weather" },
            },
          ],
        },
      ],
    } as any);

    const assistantMsg = result.messages[1] as any;
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Let me search.");
    expect(assistantMsg.toolCalls).toHaveLength(1);
    expect(assistantMsg.toolCalls[0]).toEqual({
      id: "call_789",
      name: "search",
      arguments: '{"query":"weather"}',
    });
  });

  // ── Tool choice mapping ────────────────────────────────────────

  it.each([
    [{ type: "auto" }, "auto"],
    [{ type: "none" }, "none"],
    [{ type: "any" }, "required"],
    [{ type: "tool", name: "search" }, "required"],
  ] as const)("maps tool_choice %j to '%s'", (choice, expected) => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hi" }],
      tool_choice: choice as any,
    } as any);

    expect(result.toolChoice).toBe(expected);
  });

  // ── Tools mapping ──────────────────────────────────────────────

  it("maps Anthropic tools to normalized tools", () => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          name: "search",
          description: "Search the web",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
    } as any);

    expect(result.tools).toHaveLength(1);
    expect(result.tools![0]).toEqual({
      name: "search",
      description: "Search the web",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    });
  });

  // ── Thinking intent mapping ────────────────────────────────────

  it("maps thinking.enabled to reasoningEffort high", () => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hi" }],
      thinking: { type: "enabled", budget_tokens: 1000 },
    } as any);

    expect(result.reasoningEffort).toBe("high");
  });

  it("does not set reasoning when thinking is disabled", () => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hi" }],
      thinking: { type: "disabled" },
    } as any);

    expect(result.reasoningEffort).toBeUndefined();
  });

  // ── Optional params ────────────────────────────────────────────

  it("carries through optional parameters", () => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 200,
      messages: [{ role: "user", content: "Hi" }],
      top_p: 0.9,
      temperature: 0.7,
      stop_sequences: ["STOP", "END"],
    } as any);

    expect(result.topP).toBe(0.9);
    expect(result.temperature).toBe(0.7);
    expect(result.stop).toEqual(["STOP", "END"]);
    expect(result.maxTokens).toBe(200);
    expect(result.stream).toBe(false);
  });

  // ── Image degradation ──────────────────────────────────────────

  it("degrades image blocks to text placeholder", () => {
    const result = normalizer.normalize({
      model: "test",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this:" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "..." },
            },
          ],
        },
      ],
    } as any);

    expect(result.messages[0]).toEqual({
      role: "user",
      content:
        "Look at this:\n[Image content not supported in this adapter]",
    });
  });
});
