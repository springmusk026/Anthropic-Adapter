/** Validates client API keys before the request reaches the route handler. */

import { AnthropicErrorFactory } from "../anthropic/errors.js";

export interface AuthConfig {
  /** Disables authentication entirely when true. */
  disabled: boolean;
  /** Accepted client API keys. */
  apiKeys: Set<string>;
}

export class AuthMiddleware {
  private readonly config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  /** Returns an Anthropic-style error response when the request is unauthorized. */
  validate(req: Request): Response | null {
    if (this.config.disabled) return null;
    if (this.config.apiKeys.size === 0) return null;

    const key = this.extractKey(req);

    if (!key) {
      return AnthropicErrorFactory.toResponse(
        AnthropicErrorFactory.fromProviderStatus(
          401,
          "Missing API key. Provide via x-api-key header or Authorization: Bearer <key>"
        )
      );
    }

    if (!this.config.apiKeys.has(key)) {
      return AnthropicErrorFactory.toResponse(
        AnthropicErrorFactory.fromProviderStatus(401, "Invalid API key")
      );
    }

    return null;
  }

  private extractKey(req: Request): string | null {
    const xApiKey = req.headers.get("x-api-key");
    if (xApiKey) return xApiKey;

    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) {
      return auth.slice(7).trim();
    }

    return null;
  }
}

/** Parses a comma-separated API key list from the environment. */
export function parseApiKeys(envValue?: string): Set<string> {
  if (!envValue) return new Set();
  return new Set(
    envValue
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key.length > 0)
  );
}
