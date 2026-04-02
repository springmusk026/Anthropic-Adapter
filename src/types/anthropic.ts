/** Anthropic-facing types used by the adapter. */

import Anthropic from "@anthropic-ai/sdk";

/** Anthropic Messages API request body. */
export type AnthropicMessageRequest = Anthropic.MessageCreateParams;

/** Anthropic Messages API non-streaming response. */
export type AnthropicMessage = Anthropic.Message;

/** Individual content block inside a message. */
export type AnthropicContentBlock = Anthropic.ContentBlock;

/** Tool definition accepted in the request. */
export type AnthropicTool = Anthropic.Tool;

/** Anthropic text content block in a request message. */
export type AnthropicTextBlock = Anthropic.TextBlockParam;

/** Anthropic tool-use block for assistant messages. */
export type AnthropicToolUseBlock = Anthropic.ToolUseBlockParam;

/** Anthropic tool-result block for user messages. */
export type AnthropicToolResultBlock = Anthropic.ToolResultBlockParam;

/** Anthropic thinking block. */
export type AnthropicThinkingBlock = Anthropic.ThinkingBlockParam;

/** Anthropic image block. */
export type AnthropicImageBlock = Anthropic.ImageBlockParam;

/** Stop reason from Anthropic responses. */
export type AnthropicStopReason = Anthropic.Message["stop_reason"];

/** Usage from Anthropic responses. */
export type AnthropicUsage = Anthropic.Usage;

export interface AnthropicMessageStartEvent {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    content: [];
    model: string;
    stop_reason: null;
    stop_sequence: null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

export interface AnthropicContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block:
    | { type: "thinking"; thinking: string }
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, never> };
}

export interface AnthropicContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "thinking_delta"; thinking: string }
    | { type: "input_json_delta"; partial_json: string };
}

export interface AnthropicContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason: string | null;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

export interface AnthropicMessageStopEvent {
  type: "message_stop";
}

export interface AnthropicPingEvent {
  type: "ping";
}

export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent;

export type AnthropicErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "not_found_error"
  | "rate_limit_error"
  | "api_error"
  | "overloaded_error";

export interface AnthropicErrorEnvelope {
  type: "error";
  error: {
    type: AnthropicErrorType;
    message: string;
  };
}
