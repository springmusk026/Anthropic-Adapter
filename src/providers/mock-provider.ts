/**
 * Mock completion provider.
 *
 * Implements CompletionProvider with configurable canned responses
 * for testing and development. Not for production use.
 */

import type { CompletionProvider } from "../types/provider.js";
import type {
  NormalizedRequest,
  ParsedCompletionLike,
  StreamChunkLike,
} from "../types/internal.js";

export class MockProvider implements CompletionProvider {
  private nonStreamingResponse: ParsedCompletionLike;
  private streamingChunks: StreamChunkLike[];
  private shouldThrow: Error | null = null;

  constructor() {
    // Default canned response
    this.nonStreamingResponse = {
      text: "Hello! I'm a mock assistant.",
      toolCalls: [],
      stopReason: "stop",
      promptTokens: 10,
      completionTokens: 8,
    };

    // Default streaming chunks
    this.streamingChunks = [
      { content: "Hello", done: false },
      { content: "! I'm a ", done: false },
      { content: "mock ", done: false },
      { content: "assistant.", done: false },
      {
        done: true,
        finishReason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
      },
    ];
  }

  // ── Configuration for tests ────────────────────────────────────────

  /**
   * Set the response to return from createCompletion.
   */
  setResponse(response: ParsedCompletionLike): void {
    this.nonStreamingResponse = response;
  }

  /**
   * Set the chunks to yield from streamCompletion.
   */
  setStreamChunks(chunks: StreamChunkLike[]): void {
    this.streamingChunks = chunks;
  }

  /**
   * Configure the provider to throw an error.
   */
  setError(error: Error | null): void {
    this.shouldThrow = error;
  }

  // ── CompletionProvider interface ───────────────────────────────────

  async createCompletion(
    _request: NormalizedRequest
  ): Promise<ParsedCompletionLike> {
    if (this.shouldThrow) {
      throw this.shouldThrow;
    }
    return { ...this.nonStreamingResponse };
  }

  async *streamCompletion(
    _request: NormalizedRequest
  ): AsyncGenerator<StreamChunkLike, void, undefined> {
    if (this.shouldThrow) {
      throw this.shouldThrow;
    }

    for (const chunk of this.streamingChunks) {
      yield { ...chunk };
    }
  }
}
