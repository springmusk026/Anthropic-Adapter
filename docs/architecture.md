# Architecture

## Overview

The service exposes one primary application route, `POST /v1/messages`, and adapts Anthropic-style requests into calls against a provider that implements an OpenAI-compatible completion contract.

The codebase is organized around a few stable boundaries:

- the HTTP server and middleware chain
- request normalization
- provider execution
- non-streaming serialization
- streaming SSE serialization
- error mapping

## Request Flow

1. The server receives an HTTP request.
2. Middleware handles CORS, rate limiting, authentication, and request context.
3. The messages route parses and validates the request body.
4. The request normalizer converts Anthropic input into the internal provider-facing shape.
5. The provider executes either a non-streaming completion or a streaming completion.
6. The response serializer or stream writer converts the provider result back into Anthropic-compatible output.
7. Metrics are recorded and the response is returned.

## Core Components

### Server

The server owns:

- route registration
- middleware ordering
- health and metrics endpoints
- graceful shutdown

It should stay thin. Protocol conversion belongs in the adapter modules, not in the server entrypoint.

### Request Normalizer

The normalizer is responsible for the contract mismatch between Anthropic messages and the internal request shape. It flattens system prompts, converts tool calls and tool results, preserves request options that matter downstream, and applies intentional degradations for unsupported block types.

### Provider Interface

The route depends on a provider interface rather than a concrete backend. That keeps the HTTP layer stable even if the upstream API client changes.

The current implementation includes:

- a real OpenAI-compatible provider
- a mock provider for tests and local development

### Response Serialization

Non-streaming and streaming responses are handled separately because the wire contracts are meaningfully different.

The non-streaming serializer is responsible for:

- block ordering
- stop reason mapping
- tool argument parsing
- fallback behavior for empty output

The stream writer is responsible for:

- SSE event ordering
- block lifecycle state
- block transitions between thinking, text, and tool use
- graceful stream termination

## Operational Boundaries

This project intentionally keeps some concerns out of scope:

- persistence
- distributed rate limiting
- queueing
- tenancy and account management
- dashboards and administration tooling

Those can be layered around the service, but they are not built into the adapter.
