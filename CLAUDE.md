# Marginalia

AI-assisted reader app. Simple, fast, convenient. Designed to work well on iPad.

## Architecture

- Pure static site: HTML + JS + CSS in `docs/` folder, served via GitHub Pages.
- No backend. No build step. No dependencies.
- Multi-format support: PDF (via pdf.js from CDN), EPUB, and potentially other formats.
- AI chat overlay for any content — not domain-specific.
- AI chat calls OpenRouter API directly from the browser (OpenAI-compatible format).
- User provides their own OpenRouter API key via settings UI, stored in localStorage.
- Books stored in IndexedDB (browser-local, persists across sessions).
- `ai-docs/` holds project documentation and design notes.
