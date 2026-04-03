/** OpenAI-compatible provider backed by the official OpenAI SDK. */

import OpenAI from "openai";
import type {
  NormalizedMessage,
  NormalizedRequest,
  NormalizedTool,
  ParsedCompletionLike,
  StreamChunkLike,
} from "../types/internal.js";
import type { CompletionProvider, ModelInfo } from "../types/provider.js";
import type { Logger } from "../utils/logger.js";
import { withRetry, type RetryConfig } from "../utils/retry.js";

export interface OpenAIProviderConfig {
  /** API key used for upstream requests. */
  apiKey: string;
  /** Base URL for the upstream API. */
  baseURL: string;
  /** Reserved for a future model fallback path. */
  defaultModel?: string;
  /** Upstream request timeout in milliseconds. */
  timeout?: number;
  /** Optional structured logger. */
  logger?: Logger;
  /** Retry settings for non-streaming requests. */
  retry?: Partial<RetryConfig>;
}

export class OpenAIProvider implements CompletionProvider {
  private readonly client: OpenAI;
  private readonly config: OpenAIProviderConfig;
  private readonly logger?: Logger;

  constructor(config: OpenAIProviderConfig) {
    this.config = config;
    this.logger = config.logger;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout ?? 120_000,
    });
  }

  async createCompletion(request: NormalizedRequest): Promise<ParsedCompletionLike> {
    const params = this.buildChatParams(request);

    this.logger?.debug("OpenAI request", {
      model: params.model,
      messageCount: params.messages.length,
      hasTools: !!params.tools,
    });

    const completion = await withRetry(
      () =>
        this.client.chat.completions.create(
          params
        ) as Promise<OpenAI.Chat.ChatCompletion>,
      this.config.retry,
      this.logger
    );

    this.logger?.debug("OpenAI response", {
      finishReason: completion.choices[0]?.finish_reason,
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
    });

    return this.mapCompletion(completion);
  }

  async *streamCompletion(
    request: NormalizedRequest
  ): AsyncGenerator<StreamChunkLike, void, undefined> {
    const params = this.buildChatParams(request);

    this.logger?.debug("OpenAI stream request", {
      model: params.model,
      messageCount: params.messages.length,
    });

    // Streaming retries would require replaying a partially-consumed response,
    // so only the initial connection attempt is made here.
    const stream = await this.client.chat.completions.create({
      ...params,
      stream: true,
      stream_options: { include_usage: true },
    });

    let finishReason: string | undefined;
    let usage: StreamChunkLike["usage"] | undefined;
    let chunkCount = 0;

    for await (const chunk of stream) {
      chunkCount++;
      const delta = chunk.choices?.[0]?.delta;
      const chunkFinish = chunk.choices?.[0]?.finish_reason;

      if (chunkFinish) {
        finishReason = chunkFinish;
      }

      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        };
      }

      if (!delta && !chunkFinish) {
        if (chunk.usage && finishReason) {
          this.logger?.debug("OpenAI stream done (usage chunk)", {
            chunkCount,
            finishReason,
          });
          yield { done: true, finishReason, usage };
          return;
        }
        continue;
      }

      const streamChunk: StreamChunkLike = { done: false };

      if (delta?.content) {
        streamChunk.content = delta.content;
      }

      const deltaAny = delta as Record<string, unknown> | undefined;
      if (
        deltaAny?.reasoning_content &&
        typeof deltaAny.reasoning_content === "string"
      ) {
        streamChunk.reasoningDelta = deltaAny.reasoning_content;
      }

      if (delta?.tool_calls && delta.tool_calls.length > 0) {
        const tc = delta.tool_calls[0];
        streamChunk.toolCallDelta = {
          index: tc.index,
          id: tc.id ?? undefined,
          name: tc.function?.name ?? undefined,
          argumentsDelta: tc.function?.arguments ?? undefined,
        };
      }

      const hasContent =
        streamChunk.content ||
        streamChunk.reasoningDelta ||
        streamChunk.toolCallDelta;

      if (hasContent) {
        yield streamChunk;
      }
    }

    this.logger?.debug("OpenAI stream done", { chunkCount, finishReason });

    yield {
      done: true,
      finishReason: finishReason ?? "stop",
      usage: usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  private buildChatParams(
    request: NormalizedRequest
  ): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
    const messages = this.mapMessages(request.messages);

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens,
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools.map((tool) => this.mapTool(tool));
    }

    if (request.toolChoice) {
      params.tool_choice = this.mapToolChoice(request.toolChoice);
    }

    if (request.topP !== undefined) params.top_p = request.topP;
    if (request.temperature !== undefined) params.temperature = request.temperature;
    if (request.stop && request.stop.length > 0) params.stop = request.stop;

    if (request.reasoningEffort) {
      (params as Record<string, unknown>).reasoning_effort =
        request.reasoningEffort;
    }

    return params;
  }

  private mapMessages(
    messages: NormalizedMessage[]
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((msg): OpenAI.Chat.ChatCompletionMessageParam => {
      switch (msg.role) {
        case "system":
          return { role: "system", content: msg.content };

        case "user":
          return { role: "user", content: msg.content ?? "" };

        case "assistant": {
          const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
            role: "assistant",
            content: msg.content ?? undefined,
          };

          if (msg.toolCalls && msg.toolCalls.length > 0) {
            assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            }));
          }

          return assistantMsg;
        }

        case "tool":
          return {
            role: "tool",
            tool_call_id: msg.toolCallId,
            content: msg.content,
          };

        default:
          throw new Error(
            `Unknown message role: ${(msg as Record<string, unknown>).role}`
          );
      }
    });
  }

  private mapTool(tool: NormalizedTool): OpenAI.Chat.ChatCompletionTool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as OpenAI.FunctionParameters,
      },
    };
  }

  private mapToolChoice(
    choice: "auto" | "required" | "none"
  ): OpenAI.Chat.ChatCompletionToolChoiceOption {
    return choice;
  }

  private mapCompletion(
    completion: OpenAI.Chat.ChatCompletion
  ): ParsedCompletionLike {
    const choice = completion.choices[0];
    const message = choice?.message;

    const messageAny = message as Record<string, unknown> | undefined;
    const reasoning =
      messageAny?.reasoning_content &&
      typeof messageAny.reasoning_content === "string"
        ? messageAny.reasoning_content
        : undefined;

    const toolCalls = (message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

    return {
      text: message?.content ?? "",
      toolCalls,
      stopReason: choice?.finish_reason ?? "stop",
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      reasoning,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await this.client.models.list();
    return response.data.map((model) => ({
      id: model.id,
      object: "model",
      created: model.created,
      owned_by: model.owned_by ?? "openai",
    }));
  }
}
