/** Adds CORS headers and handles preflight requests. */

export interface CorsConfig {
  /** Allowed origins. Use "*" to allow any origin. */
  allowedOrigins: string;
  /** Allowed methods. */
  allowedMethods: string;
  /** Allowed headers. */
  allowedHeaders: string;
  /** Max age for preflight cache, in seconds. */
  maxAge: number;
}

const DEFAULT_CONFIG: CorsConfig = {
  allowedOrigins: "*",
  allowedMethods: "GET, POST, OPTIONS",
  allowedHeaders:
    "Content-Type, Authorization, x-api-key, anthropic-version, x-request-id",
  maxAge: 86400,
};

export class CorsMiddleware {
  private readonly config: CorsConfig;

  constructor(config: Partial<CorsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Returns a response for `OPTIONS` preflight requests. */
  handlePreflight(req: Request): Response | null {
    if (req.method !== "OPTIONS") return null;

    return new Response(null, {
      status: 204,
      headers: this.getCorsHeaders(req),
    });
  }

  /** Adds CORS headers to a response before it is returned. */
  addCorsHeaders(req: Request, response: Response): Response {
    const headers = this.getCorsHeaders(req);
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  }

  private getCorsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get("origin") || "*";
    const allowOrigin =
      this.config.allowedOrigins === "*"
        ? "*"
        : this.config.allowedOrigins.includes(origin)
          ? origin
          : this.config.allowedOrigins.split(",")[0]?.trim() || "*";

    return {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": this.config.allowedMethods,
      "Access-Control-Allow-Headers": this.config.allowedHeaders,
      "Access-Control-Max-Age": String(this.config.maxAge),
    };
  }
}
