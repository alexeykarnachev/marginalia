# Marginalia

PDF reader with AI chat overlay, designed for reading math books on iPad.

## Security

- NEVER read, cat, or access `.env` files in this project. They contain API keys and secrets.
- NEVER run shell commands that print environment variables.
- Secrets are loaded at runtime by the application code — you don't need them.
- Use OpenRouter API for LLM calls, never Anthropic API directly.

## Architecture

- Per-block sub-packages: `books/`, `chat/`, `server/`. Each block has `api.py` (interfaces + registry) and implementation files.
- `api.py` contains ONLY: `Protocol` interfaces, dataclasses, enums, and `registry.register()` calls. Nothing else. No constants, no free functions, no helpers, no utilities, no configuration data.
- Domain types (dataclasses, enums) live in the `api.py` of the block that owns them. There is no shared `models.py`.
- Implementation files resolve cross-block dependencies via `registry.get(IFoo)`, never by importing another block's implementation directly.
- Implementation files may import from their own block's `api.py`, from other blocks' `api.py` files, from `env.py` and `registry.py`.
- `env.py` holds configuration and secrets (pydantic `BaseSettings`). Imported directly by blocks that need it.
- `logging.py` holds shared logging setup for scripts.
- Services are resolved via `registry.get(IFoo)` — singletons, lazily instantiated. Implementations pull dependencies from the registry in `__init__`, never via constructor arguments.
- Use `Protocol` (not `ABC`) for interfaces.
- Document interfaces, methods, and non-obvious fields with docstrings, not inline comments.
- No inline imports — all imports at the top of the file.
- Use `enum.Enum` for finite sets of values. Never use bare strings for these.
- Logging: use `loguru`. Scripts configure log sinks; library code uses `logger` directly.
- `__init__.py` at the package root imports all block `api.py` modules to trigger `registry.register()` calls.
- `scripts/` contains thin entry-point wrappers that configure logging, resolve services via registry, and call them.
- `server/` provides a FastAPI web UI. Uses uvicorn. Templates in `server/templates/`, static assets in `server/static/`.
- `ai-docs/` holds project documentation and design notes. Not imported by code.

## Working Style

- If a required capability is missing from an API or library, do not introduce hacks, monkey-patching, workarounds, or subclass abuse. Stop, explain the limitation, and discuss the right solution with the user.
