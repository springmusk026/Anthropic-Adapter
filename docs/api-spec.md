# API Specification

## Endpoints

### `POST /v1/messages`

Accepts Anthropic Messages API style requests and returns Anthropic-compatible responses.

Minimum accepted request:

```json
{
  "model": "string",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ]
}
```

Required validation rules:

- `model` must be present and must be a string
- `max_tokens` must be present and must be a positive number
- `messages` must be a non-empty array

The route supports both non-streaming and streaming responses through the Anthropic `stream` flag.

### `GET /health`

Returns a small JSON payload with status, uptime, version, and provider selection.

### `GET /metrics`

Returns the current in-memory metrics snapshot.

## Response Shape

### Non-streaming

The service returns Anthropic-style message responses with:

- `type: "message"`
- `role: "assistant"`
- `content` as an array of blocks
- `usage` with input and output token counts when available

Stop reasons are mapped as follows:

- `stop` -> `end_turn`
- `length` -> `max_tokens`
- `tool_calls` -> `tool_use`
- unknown values -> `end_turn`

### Streaming

The streaming response uses server-sent events with Anthropic-compatible event names. A normal stream emits:

1. `message_start`
2. zero or more `ping`
3. content block events
4. `message_delta`
5. `message_stop`

The response headers are:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

## Compatibility Notes

- Tool definitions are passed through in normalized form to the provider.
- Tool results are converted into tool-role messages.
- Unsupported image and document blocks are degraded to placeholder text.
- Thinking support is translated into a provider-facing reasoning hint and depends on upstream support.

## Error Shape

Errors are returned as Anthropic-style envelopes:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "model is required"
  }
}
```

Supported error types in the current adapter:

- `invalid_request_error`
- `authentication_error`
- `permission_error`
- `not_found_error`
- `rate_limit_error`
- `api_error`
- `overloaded_error`
