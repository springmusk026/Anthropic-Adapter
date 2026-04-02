/**
 * Middleware and utility tests.
 */

import { describe, it, expect } from "bun:test";
import { AuthMiddleware, parseApiKeys } from "../src/middleware/auth.js";
import { ModelMapper, parseModelMap } from "../src/utils/model-mapper.js";
import { MetricsCollector } from "../src/utils/metrics.js";
import { RateLimiter } from "../src/middleware/rate-limiter.js";
import { Logger } from "../src/utils/logger.js";

// ── Auth ─────────────────────────────────────────────────────────────

describe("AuthMiddleware", () => {
  it("allows all requests when disabled", () => {
    const auth = new AuthMiddleware({ disabled: true, apiKeys: new Set() });
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
    });
    expect(auth.validate(req)).toBeNull();
  });

  it("allows all requests when no keys configured", () => {
    const auth = new AuthMiddleware({ disabled: false, apiKeys: new Set() });
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
    });
    expect(auth.validate(req)).toBeNull();
  });

  it("rejects request without key when keys are configured", () => {
    const auth = new AuthMiddleware({
      disabled: false,
      apiKeys: new Set(["key1"]),
    });
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
    });
    const res = auth.validate(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("accepts x-api-key header", () => {
    const auth = new AuthMiddleware({
      disabled: false,
      apiKeys: new Set(["my-key"]),
    });
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "my-key" },
    });
    expect(auth.validate(req)).toBeNull();
  });

  it("accepts Authorization Bearer header", () => {
    const auth = new AuthMiddleware({
      disabled: false,
      apiKeys: new Set(["bearer-key"]),
    });
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { Authorization: "Bearer bearer-key" },
    });
    expect(auth.validate(req)).toBeNull();
  });

  it("rejects invalid key", () => {
    const auth = new AuthMiddleware({
      disabled: false,
      apiKeys: new Set(["valid"]),
    });
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "invalid" },
    });
    expect(auth.validate(req)).not.toBeNull();
  });
});

describe("parseApiKeys", () => {
  it("parses comma-separated keys", () => {
    const keys = parseApiKeys("key1,key2,key3");
    expect(keys.size).toBe(3);
    expect(keys.has("key1")).toBe(true);
    expect(keys.has("key3")).toBe(true);
  });

  it("trims whitespace", () => {
    const keys = parseApiKeys(" key1 , key2 ");
    expect(keys.has("key1")).toBe(true);
    expect(keys.has("key2")).toBe(true);
  });

  it("returns empty set for undefined", () => {
    expect(parseApiKeys(undefined).size).toBe(0);
  });

  it("filters empty strings", () => {
    const keys = parseApiKeys("key1,,key2,");
    expect(keys.size).toBe(2);
  });
});

// ── Model mapper ─────────────────────────────────────────────────────

describe("ModelMapper", () => {
  it("maps known model names", () => {
    const mapper = new ModelMapper(
      new Map([["claude-3-sonnet", "gpt-4o"]])
    );
    const result = mapper.resolve("claude-3-sonnet");
    expect(result.providerModel).toBe("gpt-4o");
    expect(result.mapped).toBe(true);
  });

  it("passes through unknown models", () => {
    const mapper = new ModelMapper(new Map());
    const result = mapper.resolve("whatever-model");
    expect(result.providerModel).toBe("whatever-model");
    expect(result.mapped).toBe(false);
  });

  it("reports hasMappings correctly", () => {
    expect(new ModelMapper().hasMappings).toBe(false);
    expect(
      new ModelMapper(new Map([["a", "b"]])).hasMappings
    ).toBe(true);
  });
});

describe("parseModelMap", () => {
  it("parses colon-separated pairs", () => {
    const map = parseModelMap("claude:gpt-4o,opus:gpt-4-turbo");
    expect(map.get("claude")).toBe("gpt-4o");
    expect(map.get("opus")).toBe("gpt-4-turbo");
  });

  it("returns empty map for undefined", () => {
    expect(parseModelMap(undefined).size).toBe(0);
  });

  it("skips malformed pairs", () => {
    const map = parseModelMap("good:pair,badpair,another:one");
    expect(map.size).toBe(2);
    expect(map.has("badpair")).toBe(false);
  });
});

// ── Metrics ──────────────────────────────────────────────────────────

describe("MetricsCollector", () => {
  it("tracks request counts", () => {
    const metrics = new MetricsCollector();
    metrics.recordRequest({
      model: "test",
      durationMs: 100,
      inputTokens: 10,
      outputTokens: 5,
      streaming: false,
      error: false,
    });

    const snapshot = metrics.getMetrics() as any;
    expect(snapshot.requests.total).toBe(1);
    expect(snapshot.requests.errors).toBe(0);
    expect(snapshot.tokens.total_input).toBe(10);
    expect(snapshot.tokens.total_output).toBe(5);
  });

  it("tracks errors", () => {
    const metrics = new MetricsCollector();
    metrics.recordRequest({
      model: "test",
      durationMs: 50,
      inputTokens: 0,
      outputTokens: 0,
      streaming: false,
      error: true,
    });

    const snapshot = metrics.getMetrics() as any;
    expect(snapshot.requests.errors).toBe(1);
    expect(snapshot.requests.error_rate).toBeGreaterThan(0);
  });

  it("tracks active streams", () => {
    const metrics = new MetricsCollector();
    metrics.streamStarted();
    metrics.streamStarted();

    let snapshot = metrics.getMetrics() as any;
    expect(snapshot.requests.active_streams).toBe(2);

    metrics.streamEnded();
    snapshot = metrics.getMetrics() as any;
    expect(snapshot.requests.active_streams).toBe(1);
  });

  it("estimates costs", () => {
    const metrics = new MetricsCollector({
      defaultInputCostPer1k: 0.01,
      defaultOutputCostPer1k: 0.03,
    });

    const { estimatedCost } = metrics.recordRequest({
      model: "test",
      durationMs: 100,
      inputTokens: 1000,
      outputTokens: 1000,
      streaming: false,
      error: false,
    });

    expect(estimatedCost).toBeCloseTo(0.04, 4);
  });

  it("calculates latency percentiles", () => {
    const metrics = new MetricsCollector();
    for (let i = 1; i <= 100; i++) {
      metrics.recordRequest({
        model: "test",
        durationMs: i * 10,
        inputTokens: 0,
        outputTokens: 0,
        streaming: false,
        error: false,
      });
    }

    const snapshot = metrics.getMetrics() as any;
    expect(snapshot.latency_ms.p50).toBeGreaterThan(0);
    expect(snapshot.latency_ms.p95).toBeGreaterThan(snapshot.latency_ms.p50);
    expect(snapshot.latency_ms.p99).toBeGreaterThan(snapshot.latency_ms.p95);
  });
});

// ── Rate limiter ─────────────────────────────────────────────────────

describe("RateLimiter", () => {
  it("allows requests when disabled", () => {
    const limiter = new RateLimiter({ enabled: false });
    expect(limiter.check("key1")).toBeNull();
    limiter.destroy();
  });

  it("allows requests within limit", () => {
    const limiter = new RateLimiter({
      enabled: true,
      maxRequests: 5,
      windowMs: 60_000,
    });

    for (let i = 0; i < 5; i++) {
      expect(limiter.check("key1")).toBeNull();
    }
    limiter.destroy();
  });

  it("blocks requests over limit", () => {
    const limiter = new RateLimiter({
      enabled: true,
      maxRequests: 2,
      windowMs: 60_000,
    });

    expect(limiter.check("key1")).toBeNull();
    expect(limiter.check("key1")).toBeNull();

    const blocked = limiter.check("key1");
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    limiter.destroy();
  });

  it("tracks separate keys independently", () => {
    const limiter = new RateLimiter({
      enabled: true,
      maxRequests: 1,
      windowMs: 60_000,
    });

    expect(limiter.check("key1")).toBeNull();
    expect(limiter.check("key2")).toBeNull();

    expect(limiter.check("key1")).not.toBeNull(); // over limit
    expect(limiter.check("key2")).not.toBeNull(); // over limit
    limiter.destroy();
  });

  it("extracts key from x-api-key", () => {
    const req = new Request("http://localhost", {
      headers: { "x-api-key": "test-key" },
    });
    expect(RateLimiter.extractKey(req)).toBe("key:test-key");
  });
});

// ── Logger ───────────────────────────────────────────────────────────

describe("Logger", () => {
  it("creates child loggers with context", () => {
    const parent = new Logger("info", "json");
    const child = parent.child({ requestId: "req_123" });
    // Child should exist and be a Logger
    expect(child).toBeInstanceOf(Logger);
  });

  it("respects log level filtering", () => {
    // Create a logger at "warn" level — debug/info should be silent
    const logger = new Logger("warn", "json");
    // This shouldn't throw
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("shown");
    logger.error("shown");
  });
});
