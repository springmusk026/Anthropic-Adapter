/** Hosts the HTTP adapter and shared middleware. */

import type { Server } from "bun";
import { AnthropicErrorFactory } from "./anthropic/errors.js";
import { AuthMiddleware } from "./middleware/auth.js";
import { CorsMiddleware } from "./middleware/cors.js";
import {
  addRequestIdHeader,
  createRequestContext,
  getElapsedMs,
} from "./middleware/request-context.js";
import { RateLimiter } from "./middleware/rate-limiter.js";
import { MessagesRoute } from "./routes/messages.js";
import type { CompletionProvider } from "./types/provider.js";
import type { Logger } from "./utils/logger.js";
import { MetricsCollector } from "./utils/metrics.js";
import { ModelMapper } from "./utils/model-mapper.js";

export interface ServerConfig {
  port: number;
  provider: CompletionProvider;
  logger: Logger;
  auth: AuthMiddleware;
  cors: CorsMiddleware;
  rateLimiter: RateLimiter;
  metrics: MetricsCollector;
  modelMapper: ModelMapper;
  shutdownTimeoutMs: number;
}

export class AdapterServer {
  private readonly config: ServerConfig;
  private readonly messagesRoute: MessagesRoute;
  private server: Server<undefined> | null = null;
  private startTimestamp = Date.now();

  constructor(config: ServerConfig) {
    this.config = config;
    this.messagesRoute = new MessagesRoute(
      config.provider,
      config.metrics,
      config.modelMapper
    );
  }

  /** Starts the Bun server and installs shutdown hooks. */
  start(): Server<undefined> {
    const { port, logger, auth, cors, rateLimiter, metrics } = this.config;
    const messagesRoute = this.messagesRoute;

    this.server = Bun.serve({
      port,
      idleTimeout: 0, // Disable timeout for long-running inference requests
      fetch: async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        const method = req.method;

        const preflightResponse = cors.handlePreflight(req);
        if (preflightResponse) return preflightResponse;

        const rateLimitKey = RateLimiter.extractKey(req);
        const rateLimitResponse = rateLimiter.check(rateLimitKey);
        if (rateLimitResponse) {
          return cors.addCorsHeaders(req, rateLimitResponse);
        }

        const ctx = createRequestContext(req);

        if (method === "GET" && url.pathname === "/health") {
          const health = {
            status: "ok",
            uptime_seconds: Math.round((Date.now() - this.getStartTime()) / 1000),
            provider: process.env.PROVIDER ?? "openai",
            version: "1.0.0",
          };
          const response = new Response(JSON.stringify(health), {
            headers: { "Content-Type": "application/json" },
          });
          return cors.addCorsHeaders(
            req,
            addRequestIdHeader(response, ctx.requestId)
          );
        }

        if (method === "GET" && url.pathname === "/metrics") {
          const response = new Response(
            JSON.stringify(metrics.getMetrics(), null, 2),
            { headers: { "Content-Type": "application/json" } }
          );
          return cors.addCorsHeaders(
            req,
            addRequestIdHeader(response, ctx.requestId)
          );
        }

        const authResponse = auth.validate(req);
        if (authResponse) {
          ctx.logger.warn("Authentication failed", {
            path: url.pathname,
            clientIp: ctx.clientIp,
          });
          return cors.addCorsHeaders(
            req,
            addRequestIdHeader(authResponse, ctx.requestId)
          );
        }

        if (method === "POST" && url.pathname === "/v1/messages") {
          ctx.logger.info("POST /v1/messages", {
            clientIp: ctx.clientIp,
          });

          const response = await messagesRoute.handle(req, ctx);
          const elapsed = getElapsedMs(ctx);

          ctx.logger.info("Response sent", {
            status: response.status,
            durationMs: elapsed,
          });

          return cors.addCorsHeaders(
            req,
            addRequestIdHeader(response, ctx.requestId)
          );
        }

        ctx.logger.warn("Route not found", { path: url.pathname, method });
        const notFoundResponse = AnthropicErrorFactory.toResponse(
          AnthropicErrorFactory.fromProviderStatus(404, `Not found: ${url.pathname}`)
        );
        return cors.addCorsHeaders(
          req,
          addRequestIdHeader(notFoundResponse, ctx.requestId)
        );
      },
    });

    logger.info("Anthropic Adapter Server listening", {
      port: this.server.port,
      url: `http://localhost:${this.server.port}`,
    });

    this.registerShutdownHandlers();
    return this.server;
  }

  /** Stops the server and releases middleware resources. */
  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
      this.config.rateLimiter.destroy();
      this.config.logger.info("Server stopped");
    }
  }

  /** Returns the Bun server instance for tests. */
  getServer(): Server<undefined> | null {
    return this.server;
  }

  private getStartTime(): number {
    return this.startTimestamp;
  }

  private registerShutdownHandlers(): void {
    const shutdown = (signal: string) => {
      this.config.logger.info(`Received ${signal}, shutting down`);
      setTimeout(() => {
        this.config.logger.warn("Forced shutdown after timeout");
        process.exit(1);
      }, this.config.shutdownTimeoutMs);

      this.stop();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}
