/** Retries transient upstream failures with exponential backoff. */

import type { Logger } from "./logger.js";

export interface RetryConfig {
  /** Maximum number of retry attempts. */
  maxRetries: number;
  /** Base delay between retries in milliseconds. */
  baseDelayMs: number;
  /** Maximum backoff cap in milliseconds. */
  maxDelayMs: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 10_000,
};

/** HTTP status codes that are treated as transient upstream failures. */
const RETRYABLE_STATUSES = new Set([429, 503, 529]);

/** Executes `fn` and retries when the thrown error has a retryable status. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  logger?: Logger
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const status = (err as { status?: number }).status;
      const isRetryable = status !== undefined && RETRYABLE_STATUSES.has(status);

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
        maxDelayMs
      );

      logger?.warn(`Retrying after ${Math.round(delay)}ms`, {
        attempt: attempt + 1,
        maxRetries,
        status,
        error: (err as Error).message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
