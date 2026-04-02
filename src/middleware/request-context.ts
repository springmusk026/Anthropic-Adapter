/** Builds request-scoped logging and timing context. */

import { Logger, getLogger } from "../utils/logger.js";

export interface RequestContext {
  /** Unique request identifier. */
  requestId: string;
  /** High-resolution start time. */
  startTime: number;
  /** Request-scoped logger with `requestId` attached. */
  logger: Logger;
  /** Best-effort client IP from trusted forwarding headers. */
  clientIp?: string;
}

/** Extracts or creates the request context for one HTTP request. */
export function createRequestContext(req: Request): RequestContext {
  const clientId = req.headers.get("x-request-id");
  const requestId = clientId || generateRequestId();
  const startTime = performance.now();

  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    undefined;

  const logger = getLogger().child({ requestId });
  return { requestId, startTime, logger, clientIp };
}

/** Returns elapsed request time in milliseconds. */
export function getElapsedMs(ctx: RequestContext): number {
  return Math.round(performance.now() - ctx.startTime);
}

/** Adds the request identifier to the outbound response. */
export function addRequestIdHeader(
  response: Response,
  requestId: string
): Response {
  response.headers.set("x-request-id", requestId);
  return response;
}

function generateRequestId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "req_";
  for (let i = 0; i < 16; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
