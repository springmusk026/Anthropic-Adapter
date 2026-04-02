/**
 * In-memory rate limiter.
 *
 * Sliding window rate limiter per API key.
 * Returns Anthropic-format 429 errors when exceeded.
 */

import { AnthropicErrorFactory } from "../anthropic/errors.js";

export interface RateLimitConfig {
  /** Maximum requests per window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Whether rate limiting is enabled. */
  enabled: boolean;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 60,
  windowMs: 60_000, // 1 minute
  enabled: false,
};

interface WindowEntry {
  timestamps: number[];
}

export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly windows: Map<string, WindowEntry> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Periodic cleanup of expired windows
    if (this.config.enabled) {
      this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    }
  }

  /**
   * Check if a request is allowed.
   * Returns null if allowed, or an error Response if rate limited.
   */
  check(key: string): Response | null {
    if (!this.config.enabled) return null;

    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Remove expired timestamps
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= this.config.maxRequests) {
      const retryAfterMs =
        entry.timestamps[0]! + this.config.windowMs - now;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);

      const response = AnthropicErrorFactory.toResponse(
        AnthropicErrorFactory.fromProviderStatus(
          429,
          `Rate limit exceeded. Retry after ${retryAfterSec} seconds.`
        )
      );
      response.headers.set("Retry-After", String(retryAfterSec));
      return response;
    }

    entry.timestamps.push(now);
    return null;
  }

  /**
   * Get the key for rate limiting from a request.
   * Uses API key if available, falls back to IP.
   */
  static extractKey(req: Request): string {
    const apiKey = req.headers.get("x-api-key");
    if (apiKey) return `key:${apiKey}`;

    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) return `key:${auth.slice(7).trim()}`;

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    return `ip:${ip}`;
  }

  /**
   * Clean up expired window entries.
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [key, entry] of this.windows) {
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
      if (entry.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Stop the cleanup interval.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
