# Anthropic Adapter

Anthropic Adapter is a small Bun service that accepts Anthropic Messages API requests on `POST /v1/messages` and forwards them to an OpenAI-compatible backend.

It is useful when you already have clients built against the Anthropic message format but want to route requests to another provider or gateway that speaks the OpenAI chat completions interface.

It is not a full compatibility layer for every Anthropic feature, and it is not a multi-tenant gateway. The current implementation is best suited to single-service deployments where a narrow HTTP surface is a feature, not a limitation.

## What It Supports

- Anthropic-compatible `POST /v1/messages`
- Streaming and non-streaming responses
- Tool calls
- Basic request normalization and response serialization
- API key auth for clients
- CORS
- In-memory rate limiting
- In-memory metrics at `GET /metrics`
- Health checks at `GET /health`
- Model name mapping between client-facing and provider-facing names

## When To Use It

Use this project if:

- your application already speaks the Anthropic Messages API
- you want a narrow adapter in front of an OpenAI-compatible backend
- you want a codebase that is easy to audit and extend

Do not use it if:

- you need full multimodal parity with Anthropic
- you need distributed rate limiting or shared metrics storage
- you need a general-purpose API gateway with tenancy, billing, or persistence

## Quick Start

```bash
bun install
cp .env.example .env
bun run dev
```

The server listens on `http://localhost:3000` by default.

## Configuration

All configuration is provided through environment variables.

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `PORT` | `3000` | No | HTTP listen port |
| `PROVIDER` | `openai` | No | `openai` or `mock` |
| `OPENAI_API_KEY` | none | Yes when `PROVIDER=openai` | Upstream API key |
| `OPENAI_BASE_URL` | none | Yes when `PROVIDER=openai` | OpenAI-compatible base URL |
| `OPENAI_DEFAULT_MODEL` | none | No | Optional fallback model |
| `OPENAI_TIMEOUT` | `120000` | No | Upstream timeout in milliseconds |
| `AUTH_DISABLED` | `false` | No | Disables client auth entirely |
| `API_KEYS` | none | No | Comma-separated client API keys |
| `LOG_LEVEL` | `info` | No | `debug`, `info`, `warn`, or `error` |
| `LOG_FORMAT` | `pretty` | No | `pretty` or `json` |
| `MODEL_MAP` | none | No | `from:to` pairs separated by commas |
| `RETRY_COUNT` | `2` | No | Retries on retryable upstream failures |
| `RETRY_DELAY_MS` | `1000` | No | Base backoff delay in milliseconds |
| `CORS_ORIGINS` | `*` | No | `*` or a comma-separated allowlist |
| `RATE_LIMIT_RPM` | none | No | Requests per minute per client key or IP |
| `SHUTDOWN_TIMEOUT_MS` | `5000` | No | Drain period before forced shutdown |

See [.env.example](/D:/7th/ai/openAItoClaude/.env.example) for a documented operator-facing template.

## API

### `POST /v1/messages`

Minimum request:

```json
{
  "model": "claude-3-5-sonnet-latest",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ]
}
```

Example non-streaming request:

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: local-dev-key" \
  -d '{
    "model": "claude-3-5-sonnet-latest",
    "max_tokens": 256,
    "messages": [
      { "role": "user", "content": "Say hello in one sentence." }
    ]
  }'
```

Example response:

```json
{
  "id": "msg_abc123",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello."
    }
  ],
  "model": "claude-3-5-sonnet-latest",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 10,
    "output_tokens": 3
  }
}
```

Example streaming request:

```bash
curl -N -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-latest",
    "max_tokens": 256,
    "stream": true,
    "messages": [
      { "role": "user", "content": "Stream a short answer." }
    ]
  }'
```

The streaming response uses server-sent events and emits Anthropic-style event names such as `message_start`, `content_block_delta`, `message_delta`, and `message_stop`.

### `GET /health`

Returns a small JSON document with status, uptime, version, and provider selection.

### `GET /metrics`

Returns in-memory counters for requests, errors, latency, tokens, and estimated cost.

## Operational Notes

### Authentication

If `AUTH_DISABLED=true`, all requests are accepted.

If `AUTH_DISABLED=false` and `API_KEYS` is empty, the service still accepts all requests. That behavior is convenient for local development but is not a safe production default. Set `API_KEYS` explicitly before exposing the service.

### CORS

`CORS_ORIGINS=*` is fine for local testing. In production, use an explicit origin allowlist when the service is called from browsers.

### Rate Limiting And Metrics

Rate limiting and metrics are in-memory. They reset on restart and do not coordinate across multiple instances. If you need shared state, treat the current implementation as a starting point rather than a finished distributed design.

### Model Mapping

`MODEL_MAP` lets the service accept one model name from clients and send another upstream. The response still reports the client-facing model name.

### Logging

Use `LOG_FORMAT=json` for production log collection. The service includes a request ID in logs and returns `x-request-id` on responses.

## Known Limitations

- Image and document inputs are degraded to placeholder text during normalization.
- Anthropic thinking support is translated into a provider-facing reasoning hint and depends on upstream compatibility.
- Streaming request accounting records request volume and latency, but token accounting is less complete than the non-streaming path.
- The service only exposes the Anthropic-style messages endpoint plus health and metrics.

## Development

```bash
bun run dev
bun run start
bun test
```

## Documentation

- [docs/README.md](/D:/7th/ai/openAItoClaude/docs/README.md)
- [docs/api-spec.md](/D:/7th/ai/openAItoClaude/docs/api-spec.md)
- [docs/architecture.md](/D:/7th/ai/openAItoClaude/docs/architecture.md)

## Contributing And Security

- See [CONTRIBUTING.md](/D:/7th/ai/openAItoClaude/CONTRIBUTING.md) for development and review expectations.
- See [SECURITY.md](/D:/7th/ai/openAItoClaude/SECURITY.md) for responsible disclosure guidance.

## License

MIT. See [LICENSE](/D:/7th/ai/openAItoClaude/LICENSE).
