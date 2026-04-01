# Marginalia

AI-assisted reader app. Simple, fast, convenient. Designed to work well on iPad.

## Architecture

- Svelte 5 SPA built with Vite. Source in `svelte-app/`, output in `docs/`.
- Served via GitHub Pages as a static site. No backend.
- AI chat overlay for any content — not domain-specific.
- AI chat calls OpenRouter API directly from the browser (OpenAI-compatible format).
- User provides their own OpenRouter API key via settings UI, stored in localStorage.
- Books stored in IndexedDB (browser-local, persists across sessions).
- `ai-docs/` holds project documentation and design notes.

## Build & Deploy

- Build: `cd svelte-app && npm run build` — outputs to `docs/`.
- Do NOT manually bump `MARGINALIA_VERSION` in `svelte-app/src/lib/core/db.ts`. The pre-commit hook auto-bumps the version and rebuilds on every commit that touches `svelte-app/` or `docs/`.
