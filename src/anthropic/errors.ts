/** Builds Anthropic-style error envelopes and HTTP responses. */

import type {
  AnthropicErrorEnvelope,
  AnthropicErrorType,
} from "../types/anthropic.js";

export interface AnthropicErrorResult {
  status: number;
  body: AnthropicErrorEnvelope;
}

export class AnthropicErrorFactory {
  /** Creates a 400 validation error. */
  static validationError(message: string): AnthropicErrorResult {
    return {
      status: 400,
      body: AnthropicErrorFactory.envelope("invalid_request_error", message),
    };
  }

  /** Maps an upstream status code into the matching Anthropic error type. */
  static fromProviderStatus(
    status: number,
    message: string
  ): AnthropicErrorResult {
    const type = AnthropicErrorFactory.mapStatusToType(status);
    return {
      status,
      body: AnthropicErrorFactory.envelope(type, message),
    };
  }

  /** Creates a 500 internal error. */
  static internalError(message: string): AnthropicErrorResult {
    return {
      status: 500,
      body: AnthropicErrorFactory.envelope("api_error", message),
    };
  }

  /** Serializes an error result into a JSON response. */
  static toResponse(result: AnthropicErrorResult): Response {
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  private static envelope(
    type: AnthropicErrorType,
    message: string
  ): AnthropicErrorEnvelope {
    return {
      type: "error",
      error: { type, message },
    };
  }

  private static mapStatusToType(status: number): AnthropicErrorType {
    switch (status) {
      case 400:
        return "invalid_request_error";
      case 401:
        return "authentication_error";
      case 403:
        return "permission_error";
      case 404:
        return "not_found_error";
      case 429:
        return "rate_limit_error";
      case 529:
        return "overloaded_error";
      default:
        return "api_error";
    }
  }
}
