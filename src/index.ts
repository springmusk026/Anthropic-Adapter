/** Bootstraps the server from environment configuration. */

import { AdapterServer } from "./server.js";
import { MockProvider } from "./providers/mock-provider.js";
import { OpenAIProvider } from "./providers/openai-provider.js";
import type { CompletionProvider } from "./types/provider.js";
import {
  Logger,
  setGlobalLogger,
  type LogFormat,
  type LogLevel,
} from "./utils/logger.js";
import { AuthMiddleware, parseApiKeys } from "./middleware/auth.js";
import { CorsMiddleware } from "./middleware/cors.js";
import { RateLimiter } from "./middleware/rate-limiter.js";
import { MetricsCollector } from "./utils/metrics.js";
import { ModelMapper, parseModelMap } from "./utils/model-mapper.js";

const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info") as LogLevel;
const LOG_FORMAT = (process.env.LOG_FORMAT ?? "pretty") as LogFormat;
const logger = new Logger(LOG_LEVEL, LOG_FORMAT);
setGlobalLogger(logger);

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const PROVIDER_TYPE = process.env.PROVIDER ?? "openai";

const auth = new AuthMiddleware({
  disabled: process.env.AUTH_DISABLED === "true",
  apiKeys: parseApiKeys(process.env.API_KEYS),
});

if (process.env.AUTH_DISABLED === "true") {
  logger.warn("Authentication is disabled");
} else if (!process.env.API_KEYS) {
  logger.warn("No API_KEYS configured; all requests will be allowed");
}

const cors = new CorsMiddleware({
  allowedOrigins: process.env.CORS_ORIGINS ?? "*",
});

const rateLimitEnabled = process.env.RATE_LIMIT_RPM !== undefined;
const rateLimiter = new RateLimiter({
  enabled: rateLimitEnabled,
  maxRequests: parseInt(process.env.RATE_LIMIT_RPM ?? "60", 10),
  windowMs: 60_000,
});

if (rateLimitEnabled) {
  logger.info("Rate limiting enabled", {
    rpm: process.env.RATE_LIMIT_RPM,
  });
}

const modelMapper = new ModelMapper(parseModelMap(process.env.MODEL_MAP));
if (modelMapper.hasMappings) {
  logger.info("Model mappings configured", {
    mappings: modelMapper.getMappings(),
  });
}

const metrics = new MetricsCollector();
const retryConfig = {
  maxRetries: parseInt(process.env.RETRY_COUNT ?? "2", 10),
  baseDelayMs: parseInt(process.env.RETRY_DELAY_MS ?? "1000", 10),
};

function createProvider(): CompletionProvider {
  switch (PROVIDER_TYPE) {
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      const baseURL = process.env.OPENAI_BASE_URL;

      if (!apiKey) {
        logger.error("OPENAI_API_KEY is required when PROVIDER=openai");
        logger.error("Copy .env.example to .env and fill in the values.");
        process.exit(1);
      }

      if (!baseURL) {
        logger.error("OPENAI_BASE_URL is required when PROVIDER=openai");
        logger.error("Copy .env.example to .env and fill in the values.");
        process.exit(1);
      }

      const timeout = process.env.OPENAI_TIMEOUT
        ? parseInt(process.env.OPENAI_TIMEOUT, 10)
        : undefined;

      logger.info("Using OpenAI provider", { baseURL });

      return new OpenAIProvider({
        apiKey,
        baseURL,
        defaultModel: process.env.OPENAI_DEFAULT_MODEL || undefined,
        timeout,
        logger,
        retry: retryConfig,
      });
    }

    case "mock":
      logger.info("Using mock provider");
      return new MockProvider();

    default:
      logger.error(`Unknown PROVIDER: "${PROVIDER_TYPE}". Use "openai" or "mock".`);
      process.exit(1);
  }
}

const provider = createProvider();
const server = new AdapterServer({
  port: PORT,
  provider,
  logger,
  auth,
  cors,
  rateLimiter,
  metrics,
  modelMapper,
  shutdownTimeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? "5000", 10),
});

server.start();
