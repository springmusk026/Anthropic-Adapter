# Contributing

Thanks for taking the time to contribute.

## Development Setup

```bash
bun install
cp .env.example .env
bun test
```

Use `PROVIDER=mock` in `.env` when you want to work without an upstream API dependency.

## Working Style

- Keep changes narrowly scoped.
- Preserve the Anthropic-compatible wire contract unless the change is explicitly intended to modify it.
- Prefer small, readable functions over broad refactors.
- Update docs when public behavior, configuration, or operational guidance changes.

## Comments And Documentation

- Keep JSDoc for public contracts, protocol translation rules, and non-obvious behavior.
- Remove comments that only narrate the code.
- Write documentation in plain technical language.

## Tests

Run the full test suite before opening a pull request:

```bash
bun test
```

Add or update tests when you change:

- request validation
- normalization rules
- streaming behavior
- error mapping
- public configuration behavior

## Pull Requests

A good pull request should explain:

- what changed
- why it changed
- how it was tested
- whether docs or configuration guidance changed

Keep unrelated cleanup out of the same pull request when possible.
