/** Handles the Anthropic-compatible messages endpoint. */

import { AnthropicErrorFactory } from "../anthropic/errors.js";
import { AnthropicRequestNormalizer } from "../anthropic/normalizer.js";
import { AnthropicResponseSerializer } from "../anthropic/serializer.js";
import { AnthropicStreamWriter } from "../anthropic/stream-writer.js";
import type { RequestContext } from "../middleware/request-context.js";
import type { CompletionProvider } from "../types/provider.js";
import type { MetricsCollector } from "../utils/metrics.js";
import type { ModelMapper } from "../utils/model-mapper.js";

/** Caps debug body logging so large prompts do not flood logs. */
const LOG_MAX_BODY_SIZE = 4096;

export class MessagesRoute {
  private readonly provider: CompletionProvider;
  private readonly normalizer: AnthropicRequestNormalizer;
  private readonly serializer: AnthropicResponseSerializer;
  private readonly metrics: MetricsCollector;
  private readonly modelMapper: ModelMapper;

  constructor(
    provider: CompletionProvider,
    metrics: MetricsCollector,
    modelMapper: ModelMapper
  ) {
    this.provider = provider;
    this.normalizer = new AnthropicRequestNormalizer();
    this.serializer = new AnthropicResponseSerializer();
    this.metrics = metrics;
    this.modelMapper = modelMapper;
  }

  /** Parses, validates, and dispatches a messages request. */
  async handle(req: Request, ctx: RequestContext): Promise<Response> {
    const { logger } = ctx;

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return AnthropicErrorFactory.toResponse(
        AnthropicErrorFactory.validationError("Invalid JSON in request body")
      );
    }

    logger.debug("Request body", {
      body: truncateForLog(JSON.stringify(body), LOG_MAX_BODY_SIZE),
    });

    const validationError = this.validate(body);
    if (validationError) {
      logger.warn("Validation failed", {
        error: validationError.body.error.message,
      });
      return AnthropicErrorFactory.toResponse(validationError);
    }

    const clientModel = body.model as string;
    const { providerModel, mapped } = this.modelMapper.resolve(clientModel);
    if (mapped) {
      logger.info("Model mapped", {
        from: clientModel,
        to: providerModel,
      });
    }

    let normalized;
    try {
      const normalizeBody = { ...body, model: providerModel };
      normalized = this.normalizer.normalize(normalizeBody as any);
    } catch (err) {
      logger.error("Normalization failed", {
        error: (err as Error).message,
      });
      return AnthropicErrorFactory.toResponse(
        AnthropicErrorFactory.validationError(
          `Request normalization failed: ${(err as Error).message}`
        )
      );
    }

    if (body.stream === true) {
      return this.handleStreaming(normalized, clientModel, ctx);
    }

    return this.handleNonStreaming(normalized, clientModel, ctx);
  }

  private validate(body: Record<string, unknown>) {
    if (!body.model || typeof body.model !== "string") {
      return AnthropicErrorFactory.validationError("model is required");
    }

    if (body.max_tokens === undefined || body.max_tokens === null) {
      return AnthropicErrorFactory.validationError("max_tokens is required");
    }

    if (typeof body.max_tokens !== "number" || body.max_tokens <= 0) {
      return AnthropicErrorFactory.validationError(
        "max_tokens must be a positive number"
      );
    }

    if (
      !body.messages ||
      !Array.isArray(body.messages) ||
      body.messages.length === 0
    ) {
      return AnthropicErrorFactory.validationError(
        "messages must be a non-empty array"
      );
    }

    return null;
  }

  private async handleNonStreaming(
    normalized: ReturnType<AnthropicRequestNormalizer["normalize"]>,
    clientModel: string,
    ctx: RequestContext
  ): Promise<Response> {
    const { logger } = ctx;

    try {
      const providerStart = performance.now();
      const completion = await this.provider.createCompletion(normalized);
      const providerMs = Math.round(performance.now() - providerStart);

      logger.info("Provider completed", {
        model: clientModel,
        providerModel: normalized.model,
        durationMs: providerMs,
        inputTokens: completion.promptTokens,
        outputTokens: completion.completionTokens,
        stopReason: completion.stopReason,
      });

      const response = this.serializer.serialize(completion, clientModel);

      const { estimatedCost } = this.metrics.recordRequest({
        model: clientModel,
        durationMs: providerMs,
        inputTokens: completion.promptTokens,
        outputTokens: completion.completionTokens,
        streaming: false,
        error: false,
      });

      logger.debug("Cost estimate", { estimatedCostUsd: estimatedCost });
      logger.debug("Response body", {
        body: truncateForLog(JSON.stringify(response), LOG_MAX_BODY_SIZE),
      });

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      this.metrics.recordRequest({
        model: clientModel,
        durationMs: Math.round(performance.now() - ctx.startTime),
        inputTokens: 0,
        outputTokens: 0,
        streaming: false,
        error: true,
      });

      logger.error("Provider error", {
        error: (err as Error).message,
        model: clientModel,
      });

      return this.handleProviderError(err);
    }
  }

  private handleStreaming(
    normalized: ReturnType<AnthropicRequestNormalizer["normalize"]>,
    clientModel: string,
    ctx: RequestContext
  ): Response {
    const provider = this.provider;
    const metrics = this.metrics;
    const { logger } = ctx;

    metrics.streamStarted();

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let chunkCount = 0;

        const writer = (event: string, data: unknown) => {
          const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(line));
          chunkCount++;
        };

        const streamWriter = new AnthropicStreamWriter();

        try {
          logger.info("Stream started", { model: clientModel });
          const generator = provider.streamCompletion(normalized);
          const result = await streamWriter.writeStream(
            clientModel,
            generator,
            writer,
            ctx.requestId
          );

          const streamDuration = Math.round(performance.now() - ctx.startTime);

          logger.info("Stream completed", {
            model: clientModel,
            chunkCount,
            durationMs: streamDuration,
            responseText: truncateForLog(result.responseText, 200),
          });

          metrics.recordRequest({
            model: clientModel,
            durationMs: streamDuration,
            inputTokens: 0,
            outputTokens: 0,
            streaming: true,
            error: false,
          });
        } catch (err) {
          logger.error("Stream error", {
            error: (err as Error).message,
            model: clientModel,
            chunkCount,
          });

          metrics.recordRequest({
            model: clientModel,
            durationMs: Math.round(performance.now() - ctx.startTime),
            inputTokens: 0,
            outputTokens: 0,
            streaming: true,
            error: true,
          });
        } finally {
          metrics.streamEnded();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  private handleProviderError(err: unknown): Response {
    const error = err as Error & { status?: number; statusCode?: number };
    const status = error.status ?? error.statusCode ?? 500;
    const message = error.message ?? "Internal server error";

    if (status >= 400 && status < 600) {
      return AnthropicErrorFactory.toResponse(
        AnthropicErrorFactory.fromProviderStatus(status, message)
      );
    }

    return AnthropicErrorFactory.toResponse(
      AnthropicErrorFactory.internalError(message)
    );
  }
}

function truncateForLog(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `... (${str.length - maxLen} more chars)`;
}
