/** Internal request and response types shared by the route and providers. */

import type OpenAI from "openai";

export type ReasoningIntent = "none" | "low" | "medium" | "high";

export interface NormalizedTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string | null;
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  toolCalls?: NormalizedToolCall[];
}

export interface ToolMessage {
  role: "tool";
  toolCallId: string;
  content: string;
}

export type NormalizedMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

export interface NormalizedRequest {
  model: string;
  messages: NormalizedMessage[];
  tools?: NormalizedTool[];
  toolChoice?: "auto" | "required" | "none";
  topP?: number;
  temperature?: number;
  stop?: string[];
  reasoningEffort?: ReasoningIntent;
  stream: boolean;
  requestId?: string;
  maxTokens: number;
}

/** Provider-facing non-streaming completion shape. */
export interface ParsedCompletionLike {
  text: string;
  toolCalls: Array<{
    id: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  stopReason: string;
  promptTokens: number;
  completionTokens: number;
  reasoning?: string;
}

/** Provider-facing streaming chunk shape. */
export interface StreamChunkLike {
  content?: string;
  reasoningDelta?: string;
  toolCallDelta?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
  done: boolean;
  finishReason?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Reference type from the OpenAI SDK. */
export type OpenAIChatCompletion = OpenAI.Chat.ChatCompletion;

/** Reference type from the OpenAI SDK. */
export type OpenAIChatCompletionChunk = OpenAI.Chat.ChatCompletionChunk;
