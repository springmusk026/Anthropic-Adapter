/** Contract implemented by all completion backends. */

import type {
  NormalizedRequest,
  ParsedCompletionLike,
  StreamChunkLike,
} from "./internal.js";

export interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface CompletionProvider {
  /** Returns the full completion for non-streaming requests. */
  createCompletion(request: NormalizedRequest): Promise<ParsedCompletionLike>;

  /** Yields streaming chunks and must finish with a `done: true` chunk. */
  streamCompletion(
    request: NormalizedRequest
  ): AsyncGenerator<StreamChunkLike, void, undefined>;

  /** Returns list of available models from the upstream provider. */
  listModels(): Promise<ModelInfo[]>;
}
