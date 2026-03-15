# Svelte Migration — Status

## Completed

### Core Logic (TypeScript)
- [x] types.ts — all shared interfaces
- [x] db.ts — IndexedDB with CRUD, settings, memory backend
- [x] tools.ts — 17 tools, registry, buildLibraryContext
- [x] agent.ts — agentLoop, llmCall, simpleLLMCall, compression
- [x] prompt.ts — SYSTEM_PROMPT, renderPrompt, buildApiMessages, compactMessages

### State Management
- [x] settings.svelte.ts — theme, apiKey, model, autoCompact, compactThreshold, per-book prompt/model
- [x] chat.svelte.ts — createChatState factory with persistence (saveToStorage/loadFromStorage)

### Components
- [x] Toolbar.svelte — shared toolbar with snippets
- [x] ThemeToggle.svelte — CSS pill toggle
- [x] ChatPanel.svelte — shared chat panel (markdown, page links, book links, copy, resize, overflow menu, tool activity snippet)
- [x] BookCard.svelte — book card with cover thumbnail, SVG action icons
- [x] BookGrid.svelte — grid layout with folders, breadcrumbs
- [x] Settings.svelte — settings modal
- [x] PromptEditor.svelte — per-book prompt editor with full prompt preview
- [x] ToolsEditor.svelte — tool enable/disable UI

### Pages
- [x] LibraryApp.svelte — library with toolbar, book grid, chat, settings, default book loading
- [x] ViewerApp.svelte — PDF viewer (iframe) with toolbar, chat, context bar, tool activity, page nav, zoom, indexing, selection capture, page history, per-book persistence, auto-compact, prompt/tools editors

### Infrastructure
- [x] vite.config.ts — multi-page build to docs/
- [x] Service worker (public/sw.js)
- [x] Test harness (scripts/agent.ts + scripts/shims.ts)
- [x] manifest.json
- [x] Default book (public/default-book.pdf)

### Build & Deploy
- [x] `npx vite build` outputs to docs/
- [x] `npx vite dev` for development
- [x] Test harness: `npx tsx scripts/agent.ts`

## Remaining Polish (non-blocking)

- [ ] Remove old vanilla JS files from docs/ (db.js, tools.js, agent.js, marginalia.js, app.js, chat-ui.js, chat.css, style.css, theme.css, sw.js)
- [ ] Update test-mechanics.sh to use tsx
- [ ] Run full 43-turn experiment and verify
- [ ] Test on iPad Safari PWA
- [ ] Clean up public/pdfjs/web/viewer.html (remove old script references)
- [ ] Cover rendering: pdfjsLib not available on library page in Svelte (needs dynamic import)
- [ ] Pre-commit hook for version bump in Svelte project
