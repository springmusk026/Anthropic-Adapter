/**
 * Integration tests — full route through POST /v1/messages.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { AdapterServer } from "../src/server.js";
import { MockProvider } from "../src/providers/mock-provider.js";
import { Logger } from "../src/utils/logger.js";
import { AuthMiddleware } from "../src/middleware/auth.js";
import { CorsMiddleware } from "../src/middleware/cors.js";
import { RateLimiter } from "../src/middleware/rate-limiter.js";
import { MetricsCollector } from "../src/utils/metrics.js";
import { ModelMapper } from "../src/utils/model-mapper.js";

describe("POST /v1/messages integration", () => {
  let server: AdapterServer;
  let provider: MockProvider;
  let baseUrl: string;

  beforeAll(() => {
    provider = new MockProvider();
    const logger = new Logger("error", "pretty"); // quiet for tests

    server = new AdapterServer({
      port: 0, // random available port
      provider,
      logger,
      auth: new AuthMiddleware({ disabled: true, apiKeys: new Set() }),
      cors: new CorsMiddleware(),
      rateLimiter: new RateLimiter(),
      metrics: new MetricsCollector(),
      modelMapper: new ModelMapper(),
      shutdownTimeoutMs: 1000,
    });

    const s = server.start();
    baseUrl = `http://localhost:${s.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  // ── Helper ─────────────────────────────────────────────────────

  async function postMessages(body: Record<string, unknown>): Promise<Response> {
    return fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ── Validation failures ────────────────────────────────────────

  it("rejects missing model", async () => {
    const res = await postMessages({
      max_tokens: 100,
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("model");
  });

  it("rejects missing max_tokens", async () => {
    const res = await postMessages({
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("max_tokens");
  });

  it("rejects empty messages", async () => {
    const res = await postMessages({
      model: "test",
      max_tokens: 100,
      messages: [],
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("messages");
  });

  it("rejects missing messages", async () => {
    const res = await postMessages({
      model: "test",
      max_tokens: 100,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.type).toBe("invalid_request_error");
  });

  // ── Non-streaming success ──────────────────────────────────────

  it("returns non-streaming Anthropic response", async () => {
    provider.setResponse({
      text: "Hello from the provider!",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 8,
      completionTokens: 5,
    });

    const res = await postMessages({
      model: "claude-3-sonnet",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.model).toBe("claude-3-sonnet");
    expect(body.id).toStartWith("msg_");
    expect(body.stop_reason).toBe("end_turn");
    expect(body.stop_sequence).toBeNull();
    expect(body.content).toHaveLength(1);
    expect(body.content[0]).toEqual({
      type: "text",
      text: "Hello from the provider!",
    });
    expect(body.usage).toEqual({ input_tokens: 8, output_tokens: 5 });
  });

  // ── Non-streaming with tools ───────────────────────────────────

  it("returns non-streaming tool-use response", async () => {
    provider.setResponse({
      text: "",
      toolCalls: [
        {
          id: "call_test_1",
          function: { name: "get_weather", arguments: '{"city":"NYC"}' },
        },
      ],
      stopReason: "tool_calls",
      promptTokens: 12,
      completionTokens: 8,
    });

    const res = await postMessages({
      model: "claude-3-opus",
      max_tokens: 200,
      messages: [{ role: "user", content: "What's the weather?" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.stop_reason).toBe("tool_use");
    expect(body.content).toHaveLength(1);
    expect(body.content[0].type).toBe("tool_use");
    expect(body.content[0].id).toBe("call_test_1");
    expect(body.content[0].input).toEqual({ city: "NYC" });
  });

  // ── Streaming success ──────────────────────────────────────────

  it("returns streaming SSE response", async () => {
    provider.setStreamChunks([
      { content: "Streaming ", done: false },
      { content: "works!", done: false },
      {
        done: true,
        finishReason: "stop",
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      },
    ]);

    const res = await postMessages({
      model: "claude-3-sonnet",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hi" }],
      stream: true,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const text = await res.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: ping");
    expect(text).toContain("event: content_block_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("event: content_block_stop");
    expect(text).toContain("event: message_delta");
    expect(text).toContain("event: message_stop");
    expect(text).toContain("Streaming ");
    expect(text).toContain("works!");
  });

  // ── Provider failure ───────────────────────────────────────────

  it("maps provider errors to Anthropic format", async () => {
    const err = new Error("Upstream failed") as Error & { status: number };
    err.status = 429;
    provider.setError(err);

    const res = await postMessages({
      model: "test",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("rate_limit_error");

    provider.setError(null);
  });

  it("maps generic provider errors to api_error", async () => {
    provider.setError(new Error("Something broke"));

    const res = await postMessages({
      model: "test",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("api_error");

    provider.setError(null);
  });

  // ── 404 for unknown routes ─────────────────────────────────────

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${baseUrl}/v1/completions`, { method: "POST" });

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("not_found_error");
  });

  // ── Health check ───────────────────────────────────────────────

  it("returns enhanced health check", async () => {
    const res = await fetch(`${baseUrl}/health`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(body.version).toBe("1.0.0");
  });

  // ── Metrics endpoint ──────────────────────────────────────────

  it("returns metrics JSON", async () => {
    const res = await fetch(`${baseUrl}/metrics`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(body.requests).toBeDefined();
    expect(body.requests.total).toBeGreaterThanOrEqual(0);
    expect(body.latency_ms).toBeDefined();
    expect(body.tokens).toBeDefined();
    expect(body.cost).toBeDefined();
  });

  // ── Request ID ─────────────────────────────────────────────────

  it("returns x-request-id header", async () => {
    provider.setResponse({
      text: "Test",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 5,
      completionTokens: 1,
    });

    const res = await postMessages({
      model: "test",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("passes through client x-request-id", async () => {
    provider.setResponse({
      text: "Test",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 5,
      completionTokens: 1,
    });

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "my-custom-id",
      },
      body: JSON.stringify({
        model: "test",
        max_tokens: 100,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    expect(res.headers.get("x-request-id")).toBe("my-custom-id");
  });

  // ── Invalid JSON ───────────────────────────────────────────────

  it("rejects invalid JSON body", async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json {{{",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("invalid_request_error");
  });
});

// ── Auth middleware integration tests ─────────────────────────────────

describe("Auth middleware integration", () => {
  let server: AdapterServer;
  let provider: MockProvider;
  let baseUrl: string;

  beforeAll(() => {
    provider = new MockProvider();
    const logger = new Logger("error", "pretty");

    server = new AdapterServer({
      port: 0,
      provider,
      logger,
      auth: new AuthMiddleware({
        disabled: false,
        apiKeys: new Set(["valid-key-1", "valid-key-2"]),
      }),
      cors: new CorsMiddleware(),
      rateLimiter: new RateLimiter(),
      metrics: new MetricsCollector(),
      modelMapper: new ModelMapper(),
      shutdownTimeoutMs: 1000,
    });

    const s = server.start();
    baseUrl = `http://localhost:${s.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  it("rejects request without API key", async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test",
        max_tokens: 100,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.type).toBe("authentication_error");
  });

  it("rejects request with invalid API key", async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "bad-key",
      },
      body: JSON.stringify({
        model: "test",
        max_tokens: 100,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    expect(res.status).toBe(401);
  });

  it("accepts request with valid x-api-key", async () => {
    provider.setResponse({
      text: "OK",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 1,
      completionTokens: 1,
    });

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "valid-key-1",
      },
      body: JSON.stringify({
        model: "test",
        max_tokens: 100,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    expect(res.status).toBe(200);
  });

  it("accepts request with valid Bearer token", async () => {
    provider.setResponse({
      text: "OK",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 1,
      completionTokens: 1,
    });

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-key-2",
      },
      body: JSON.stringify({
        model: "test",
        max_tokens: 100,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    expect(res.status).toBe(200);
  });

  it("allows health check without auth", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("allows metrics without auth", async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
  });
});

// ── Model mapping integration tests ──────────────────────────────────

describe("Model mapping integration", () => {
  let server: AdapterServer;
  let provider: MockProvider;
  let baseUrl: string;

  beforeAll(() => {
    provider = new MockProvider();
    const logger = new Logger("error", "pretty");

    const modelMap = new Map([
      ["claude-3-5-sonnet-latest", "gpt-4o"],
      ["claude-3-opus-latest", "gpt-4-turbo"],
    ]);

    server = new AdapterServer({
      port: 0,
      provider,
      logger,
      auth: new AuthMiddleware({ disabled: true, apiKeys: new Set() }),
      cors: new CorsMiddleware(),
      rateLimiter: new RateLimiter(),
      metrics: new MetricsCollector(),
      modelMapper: new ModelMapper(modelMap),
      shutdownTimeoutMs: 1000,
    });

    const s = server.start();
    baseUrl = `http://localhost:${s.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  it("maps model name but responds with client model", async () => {
    provider.setResponse({
      text: "Mapped!",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 5,
      completionTokens: 1,
    });

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 100,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Response should show the CLIENT model name, not the mapped one
    expect(body.model).toBe("claude-3-5-sonnet-latest");
  });

  it("passes through unmapped models as-is", async () => {
    provider.setResponse({
      text: "Unmapped!",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 5,
      completionTokens: 1,
    });

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "some-custom-model",
        max_tokens: 100,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.model).toBe("some-custom-model");
  });
});
