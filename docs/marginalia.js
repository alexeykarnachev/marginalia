// Marginalia — main entry point for pdf.js viewer overlay
// Loaded after: db.js, tools.js, agent.js, katex, marked

// --- Prompt ---

const SYSTEM_PROMPT = `You are Marginalia, an AI reading assistant.

## Environment
You are embedded in a static web application (Marginalia) that runs entirely in the browser.
The user has a personal library of books (PDFs) organized in folders.
Your responses are rendered with **Markdown** and **LaTeX** support (KaTeX).

## Library
{{libraryTree}}

## Current focus
{{focusContext}}
{{#pageHistory}}

## Page history
{{pageHistory}}
{{/pageHistory}}
{{#selection}}

## Selected text
\`\`\`
{{selection}}
\`\`\`
{{/selection}}
{{#pageText}}

## Current page content
{{pageText}}
{{/pageText}}

## Tools
All read/search tools accept an optional book_id — you can access ANY book without switching.
- **Read**: read_page, read_pages (range, max 20)
- **Search**: search_book (regex grep), search_all_books (cross-library grep). Supports regex: | for alternation, \\d+, character classes, etc.
- **Navigate**: go_to_page, go_back, open_book
- **Book info**: get_table_of_contents
- **Library**: create/rename/move/delete folders and books (batch operations available)
If you need to re-read a page you read earlier in this turn, just call read_page again.

## Rules
- **Tool use is mandatory for actions**: NEVER claim you performed an action (created folder, moved book, renamed, searched, read) without calling the corresponding tool. If you cannot do something, say so honestly.
- **Grounding**: Base all claims about book content on tool results from this conversation. When you supplement with general knowledge, you MUST label it explicitly ("Based on general knowledge..."). When asked to read, search, or check a book — ALWAYS use tools, never answer from memory alone.
- **Language**: Always respond in the language the user writes in. Even when discussing foreign-language books, your response body must be in the user's language. Brief original-language quotes are fine.
- **Identity**: You are a reading assistant. Maintain a professional tone. Do not roleplay as characters or adopt novelty voices unless the user explicitly asks.
- **Tool results are hidden**: The user CANNOT see tool inputs or outputs — only your response text. Never say "see above", "as shown in the search results", or reference tool output as if the user can read it. Include all relevant information directly in your response.
- **Conciseness**: Match response length to the question. For search results with many matches, show top 5-7 and summarize the rest.
- **Accuracy**: When organizing books into categories, verify facts before acting. If unsure about a book's genre, author nationality, or classification, say so rather than guessing wrong. Kafka is not English, Homer is not modern, etc.
- **Ambiguity**: When user instructions are vague ("make it cleaner", "organize"), explain your plan before executing. For clear instructions, act immediately.
- **LaTeX**: Use KaTeX-compatible syntax for math.

## IMPORTANT — follow strictly
- **Page references**: When citing pages, ALWAYS use [p.N] format (e.g. [p.42], [p.10-15]). These render as clickable navigation links. NEVER write "page 42", "стр. 42", "с. 42", "p.42" — ONLY [p.N].
  - CORRECT: "See [p.42]" / "Exercises on [p.22-25]" / "Перешёл на [p.10]"
  - WRONG: "page 42" / "стр. 22" / "p.42" / "страницу 10" / "(page 10)"
- **PDF vs printed page numbers**: Page numbers printed inside a book (e.g. in its table of contents) often do NOT match PDF page numbers. NEVER use printed page numbers in [p.N] links. Use search_book to find the actual PDF page number first, then reference that.
- **Book-specific instructions**: If a "Book-specific instructions" section appears below, follow it strictly — it overrides your default behavior for style, language, format, and tone.`;

function renderPrompt(template, context) {
    let result = template;
    for (const [key, val] of Object.entries(context)) {
        const blockRe = new RegExp(`\\{\\{#${key}\\}\\}([\\s\\S]*?)\\{\\{/${key}\\}\\}`, "g");
        result = result.replace(blockRe, val ? "$1" : "");
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val || "");
    }
    return result.trim();
}

// --- Settings ---

// Auto-compaction settings
function getAutoCompactEnabled() {
    return localStorage.getItem("marginalia_auto_compact") !== "0"; // on by default
}
function setAutoCompactEnabled(v) {
    localStorage.setItem("marginalia_auto_compact", v ? "1" : "0");
}
function getAutoCompactThreshold() {
    return parseInt(localStorage.getItem("marginalia_compact_threshold")) || 50000; // tokens
}
function setAutoCompactThreshold(v) {
    localStorage.setItem("marginalia_compact_threshold", String(v));
}

function modelStorageKey() {
    return `marginalia_model_${getBookId()}`;
}

function getChatModel() {
    return localStorage.getItem(modelStorageKey())
        || getSettings().model;
}

function setChatModel(model) {
    localStorage.setItem(modelStorageKey(), model);
}

// --- Theme ---

const THEMES = [
    { id: "light",  label: "☀",  ui: "light", filter: "none" },
    { id: "sepia",  label: "🌅", ui: "dark",  filter: "sepia(0.4) brightness(0.75) contrast(0.9)" },
    { id: "dim",    label: "🌙", ui: "dark",  filter: "invert(0.8) hue-rotate(180deg) contrast(0.8) brightness(0.85)" },
    { id: "dark",   label: "🌑", ui: "dark",  filter: "invert(0.92) hue-rotate(180deg) contrast(0.8) brightness(0.8)" },
    { id: "black",  label: "⬛", ui: "dark",  filter: "invert(1) hue-rotate(180deg) brightness(0.75)" },
];

function getTheme() {
    return localStorage.getItem("marginalia_theme") || "dark";
}

function setTheme(t) {
    localStorage.setItem("marginalia_theme", t);
    applyTheme();
}

function cycleTheme() {
    const current = getTheme();
    const idx = THEMES.findIndex(t => t.id === current);
    const next = THEMES[(idx + 1) % THEMES.length];
    setTheme(next.id);
}

function applyTheme() {
    const html = document.documentElement;
    const theme = THEMES.find(t => t.id === getTheme()) || THEMES[3];
    const lightEls = [
        document.getElementById("marginalia-chat"),
        document.getElementById("marginalia-prompt-overlay"),
        document.getElementById("marginalia-tools-overlay"),
    ];

    if (theme.ui === "light") {
        html.classList.remove("is-dark");
        html.classList.add("is-light");
        lightEls.forEach(el => el?.classList.add("marginalia-light"));
    } else {
        html.classList.remove("is-light");
        html.classList.add("is-dark");
        lightEls.forEach(el => el?.classList.remove("marginalia-light"));
    }

    // Apply page filter
    const pages = document.querySelector(".pdfViewer");
    if (pages) pages.style.filter = theme.filter;

    // Update theme button label
    const btn = document.getElementById("marginaliaTheme");
    if (btn) {
        btn.textContent = theme.label;
        btn.title = `Theme: ${theme.id}`;
    }
}

function getBookId() {
    return sessionStorage.getItem("marginalia_book_id") || "";
}

// --- Chat persistence ---

function chatStorageKey() {
    return `marginalia_chat_${getBookId()}`;
}

function statsStorageKey() {
    return `marginalia_stats_${getBookId()}`;
}

function promptStorageKey() {
    return `marginalia_prompt_${getBookId()}`;
}

function getBookPrompt() {
    return localStorage.getItem(promptStorageKey()) || "";
}

function setBookPrompt(text) {
    localStorage.setItem(promptStorageKey(), text);
}

function saveChatState() {
    localStorage.setItem(chatStorageKey(), JSON.stringify({
        messages: chatState.messages,
        summary: chatState.summary,
    }));
    localStorage.setItem(statsStorageKey(), JSON.stringify(chatState.stats));
}

function loadChatState() {
    try {
        const raw = JSON.parse(localStorage.getItem(chatStorageKey()));
        if (Array.isArray(raw)) {
            // Legacy format: bare array
            chatState.messages = raw;
            chatState.summary = null;
        } else if (raw && raw.messages) {
            chatState.messages = raw.messages;
            chatState.summary = raw.summary || null;
        }
    } catch {}
    try {
        const stats = JSON.parse(localStorage.getItem(statsStorageKey()));
        if (stats) chatState.stats = { ...chatState.stats, ...stats };
    } catch {}
}

// --- Load PDF from IndexedDB ---

async function loadPdfFromDB() {
    const bookId = getBookId();
    if (!bookId) { window.location.href = "../../"; return; }

    const app = window.PDFViewerApplication;
    if (!app) {
        document.addEventListener("webviewerloaded", () => loadPdfFromDB(), { once: true });
        return;
    }

    const book = await getBook(bookId);
    if (!book) { window.location.href = "../../"; return; }

    const blob = book.data instanceof Blob ? book.data : new Blob([book.data], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    await app.initializedPromise;
    app.open({ url });
    document.title = book.title + " - Marginalia";

    // Index book on first open (extract page texts for search)
    if (!book.pages) {
        indexBookInBackground(bookId);
    }
}

function _showIndexingStatus(text) {
    let el = document.getElementById("marginalia-indexing-status");
    if (!el) {
        el = document.createElement("div");
        el.id = "marginalia-indexing-status";
        el.style.cssText = "position:fixed;bottom:12px;left:12px;background:#2a2a2a;color:#4a9eff;border:1px solid #4a9eff;border-radius:8px;padding:6px 14px;font-size:12px;z-index:99999;font-family:-apple-system,sans-serif;transition:opacity 0.3s;";
        document.body.appendChild(el);
    }
    if (text) {
        el.textContent = text;
        el.style.opacity = "1";
        el.style.display = "";
    } else {
        el.style.opacity = "0";
        setTimeout(() => { el.style.display = "none"; }, 300);
    }
}

async function indexBookInBackground(bookId) {
    const app = window.PDFViewerApplication;
    if (!app?.pdfDocument) {
        _showIndexingStatus("Waiting for PDF...");
        await new Promise(resolve => {
            const check = setInterval(() => {
                if (app?.pdfDocument) { clearInterval(check); resolve(); }
            }, 500);
            setTimeout(() => { clearInterval(check); resolve(); }, 30000);
        });
    }
    if (!app?.pdfDocument) { _showIndexingStatus(null); return; }

    try {
        const total = app.pagesCount;
        const pages = [];
        for (let i = 1; i <= total; i++) {
            if (i === 1 || i % 10 === 0) {
                _showIndexingStatus(`Indexing ${i}/${total}...`);
            }
            const page = await app.pdfDocument.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map(item => item.str).join(" "));
        }
        const book = await getBook(bookId);
        if (book) {
            book.pages = pages;
            await saveBook(book);
        }
        _showIndexingStatus(`Indexed ${total} pages`);
        setTimeout(() => _showIndexingStatus(null), 2000);
    } catch (err) {
        console.warn("Indexing failed:", err);
        _showIndexingStatus("Indexing failed");
        setTimeout(() => _showIndexingStatus(null), 3000);
    }
}

// --- Inject UI ---

function _goToPage(app, page) {
    if (app.pdfLinkService) {
        app.pdfLinkService.goToPage(page);
    } else {
        app.page = page;
    }
}

function injectUI() {
    // --- Back button in pdf.js toolbar ---
    const toolbar = document.getElementById("toolbarViewerLeft");
    if (toolbar) {
        const backBtn = document.createElement("button");
        backBtn.className = "toolbarButton";
        backBtn.id = "marginaliaBack";
        backBtn.title = "Back to Library";
        backBtn.textContent = "← Library";
        backBtn.style.cssText = "font-size:13px;padding:4px 8px;cursor:pointer;color:inherit;background:none;border:none;";
        backBtn.addEventListener("click", () => { window.location.href = "../../"; });
        toolbar.insertBefore(backBtn, toolbar.firstChild);
    }

    // --- Theme toggle ---
    const toolbarRight = document.getElementById("toolbarViewerRight");
    if (toolbarRight) {
        const themeBtn = document.createElement("button");
        themeBtn.className = "toolbarButton";
        themeBtn.id = "marginaliaTheme";
        themeBtn.title = "Toggle theme";
        themeBtn.textContent = "☀";
        themeBtn.style.cssText = "font-size:16px;cursor:pointer;background:none;border:none;color:inherit;";
        themeBtn.addEventListener("click", cycleTheme);
        toolbarRight.insertBefore(themeBtn, toolbarRight.firstChild);
    }

    // --- Chat toggle button ---
    if (toolbarRight) {
        const chatBtn = document.createElement("button");
        chatBtn.className = "toolbarButton";
        chatBtn.id = "marginaliaChatToggle";
        chatBtn.title = "Toggle AI Chat";
        chatBtn.textContent = "Chat";
        chatBtn.style.cssText = "font-size:13px;padding:4px 8px;cursor:pointer;color:inherit;background:none;border:none;";
        chatBtn.addEventListener("click", toggleChat);
        toolbarRight.insertBefore(chatBtn, toolbarRight.firstChild);
    }

    // --- Chat panel ---
    const chatPanel = document.createElement("div");
    chatPanel.id = "marginalia-chat";
    chatPanel.innerHTML = `
        <div id="marginalia-chat-resize"></div>
        <div id="marginalia-chat-header">
            <span>Chat</span>
            <div id="marginalia-chat-header-right">
                <div id="marginalia-font-size">
                    <button class="marginalia-font-btn" data-size="s">S</button>
                    <button class="marginalia-font-btn" data-size="m">M</button>
                    <button class="marginalia-font-btn" data-size="l">L</button>
                    <button id="marginalia-mono-btn" title="Toggle monospace font">Mono</button>
                    <button id="marginalia-raw-btn" title="Toggle raw markdown view">Raw</button>
                </div>
                <button id="marginalia-chat-tools" title="Configure available tools">Tools</button>
                <button id="marginalia-chat-prompt" title="Edit system prompt for this book">Prompt</button>
                <button id="marginalia-chat-compact" title="Summarize and compact the conversation to save context">Compact</button>
                <button id="marginalia-chat-clear" title="Clear all chat history for this book">Clear</button>
                <button id="marginalia-chat-close">&times;</button>
            </div>
        </div>
        <div id="marginalia-context-bar">
            <div id="marginalia-context-progress"><div id="marginalia-context-fill"></div></div>
            <span id="marginalia-context-text"></span>
        </div>
        <div id="marginalia-chat-messages"></div>
        <div id="marginalia-chat-stats">
            <div id="marginalia-stats-bar"><div id="marginalia-stats-fill"></div></div>
            <span class="marginalia-stats-text"></span>
        </div>
        <div id="marginalia-chat-input-area">
            <textarea id="marginalia-chat-input" placeholder="Ask about this page..."></textarea>
            <button id="marginalia-chat-send">Send</button>
        </div>
    `;
    (document.getElementById("outerContainer") || document.body).appendChild(chatPanel);

    // Prompt editor overlay
    const promptOverlay = document.createElement("div");
    promptOverlay.id = "marginalia-prompt-overlay";
    promptOverlay.className = "marginalia-prompt-overlay hidden";
    promptOverlay.innerHTML = `
        <div id="marginalia-prompt-modal">
            <h3>System prompt for this book</h3>
            <p class="marginalia-prompt-hint">This text is appended to the base system prompt. Leave empty to use the default.</p>
            <textarea id="marginalia-prompt-textarea" placeholder="e.g. Answer in Russian. Focus on mathematical proofs..."></textarea>
            <div class="marginalia-prompt-buttons">
                <button id="marginalia-prompt-save">Save</button>
                <button id="marginalia-prompt-cancel">Cancel</button>
            </div>
            <button id="marginalia-prompt-view">View full system prompt</button>
            <div id="marginalia-prompt-viewer" class="hidden">
                <pre id="marginalia-prompt-viewer-text"></pre>
            </div>
        </div>
    `;
    document.body.appendChild(promptOverlay);

    // Tools overlay
    const toolsOverlay = document.createElement("div");
    toolsOverlay.id = "marginalia-tools-overlay";
    toolsOverlay.className = "marginalia-prompt-overlay hidden";
    toolsOverlay.innerHTML = `
        <div id="marginalia-tools-modal">
            <h3>Agent tools</h3>
            <p class="marginalia-prompt-hint">Toggle tools the AI agent can use. Disabled tools won't be offered to the model.</p>
            <div id="marginalia-tools-list"></div>
            <div class="marginalia-prompt-buttons">
                <button id="marginalia-tools-close">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(toolsOverlay);

    // --- Event wiring ---
    document.getElementById("marginalia-chat-close").addEventListener("click", toggleChat);
    document.getElementById("marginalia-chat-send").addEventListener("click", sendMessage);
    document.getElementById("marginalia-chat-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.querySelectorAll(".marginalia-font-btn").forEach(btn => {
        btn.addEventListener("click", () => setChatFontSize(btn.dataset.size));
    });
    document.getElementById("marginalia-chat-clear").addEventListener("click", clearChat);
    document.getElementById("marginalia-chat-compact").addEventListener("click", compactChat);
    document.getElementById("marginalia-chat-tools").addEventListener("click", openToolsEditor);
    document.getElementById("marginalia-tools-close").addEventListener("click", closeToolsEditor);
    document.getElementById("marginalia-chat-prompt").addEventListener("click", openPromptEditor);
    document.getElementById("marginalia-prompt-save").addEventListener("click", savePromptEditor);
    document.getElementById("marginalia-prompt-cancel").addEventListener("click", closePromptEditor);
    document.getElementById("marginalia-prompt-view").addEventListener("click", togglePromptViewer);
    document.getElementById("marginalia-mono-btn").addEventListener("click", toggleMono);
    document.getElementById("marginalia-raw-btn").addEventListener("click", toggleRaw);

    // Clickable page citations in chat + back button
    let _pageBeforeJump = null;
    const backBtn = document.createElement("button");
    backBtn.id = "marginalia-page-back";
    backBtn.className = "marginalia-page-back hidden";
    backBtn.addEventListener("click", () => {
        const app = window.PDFViewerApplication;
        if (_pageBeforeJump && app) {
            _goToPage(app, _pageBeforeJump);
            _pageBeforeJump = null;
            backBtn.classList.add("hidden");
        }
    });
    document.body.appendChild(backBtn);

    document.getElementById("marginalia-chat-messages").addEventListener("click", (e) => {
        const link = e.target.closest(".marginalia-page-link");
        if (link) {
            e.preventDefault();
            const page = parseInt(link.dataset.page);
            const app = window.PDFViewerApplication;
            if (page && app) {
                _pageBeforeJump = app.page;
                _goToPage(app, page);
                backBtn.textContent = `\u2190 Back to p.${_pageBeforeJump}`;
                backBtn.classList.remove("hidden");
            }
        }
    });

    initResize(chatPanel);
    injectStyles();
    applyChatFontSize();
    applyMono();
    renderChat();
    renderStats();
}

function initResize(panel) {
    const handle = document.getElementById("marginalia-chat-resize");
    let startX = null;
    let startW = null;

    const outer = document.getElementById("outerContainer");

    function _setChatWidth(w) {
        const clamped = Math.max(280, Math.min(w, window.innerWidth * 0.7));
        panel.style.width = clamped + "px";
        document.documentElement.style.setProperty("--chat-panel-width", clamped + "px");
    }

    function onMove(x) {
        if (startX == null) return;
        _setChatWidth(startW - (x - startX));
    }

    function onDragEnd() {
        if (startX != null) {
            localStorage.setItem("marginalia_chat_width", panel.offsetWidth);
            outer.classList.remove("chatResizing");
        }
        startX = null;
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
    }

    handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        startX = e.clientX; startW = panel.offsetWidth;
        outer.classList.add("chatResizing");
        document.body.style.userSelect = "none";
        document.body.style.webkitUserSelect = "none";
    });
    document.addEventListener("mousemove", (e) => { if (startX != null) { e.preventDefault(); onMove(e.clientX); } });
    document.addEventListener("mouseup", onDragEnd);

    handle.addEventListener("touchstart", (e) => {
        e.preventDefault();
        startX = e.touches[0].clientX; startW = panel.offsetWidth;
        outer.classList.add("chatResizing");
    });
    document.addEventListener("touchmove", (e) => { if (startX != null) onMove(e.touches[0].clientX); });
    document.addEventListener("touchend", onDragEnd);

    const saved = localStorage.getItem("marginalia_chat_width");
    if (saved) _setChatWidth(parseInt(saved));
}

function injectStyles() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "../../chat.css";
    document.head.appendChild(link);
}

// --- Chat logic ---

const chatState = {
    messages: [],
    summary: null,
    stats: { inputTokens: 0, outputTokens: 0, cost: 0, lastContextTokens: 0, model: "" },
    sending: false,
};

function getChatFontSize() {
    return localStorage.getItem("marginalia_chat_font") || "m";
}

function setChatFontSize(size) {
    localStorage.setItem("marginalia_chat_font", size);
    applyChatFontSize();
}

function applyChatFontSize() {
    const sizes = { s: "12px", m: "14px", l: "17px" };
    const el = document.getElementById("marginalia-chat-messages");
    if (el) el.style.fontSize = sizes[getChatFontSize()];
    document.querySelectorAll(".marginalia-font-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.size === getChatFontSize());
    });
}

function isMono() {
    return localStorage.getItem("marginalia_chat_mono") === "1";
}

function toggleMono() {
    localStorage.setItem("marginalia_chat_mono", isMono() ? "0" : "1");
    applyMono();
}

function applyMono() {
    const el = document.getElementById("marginalia-chat-messages");
    const btn = document.getElementById("marginalia-mono-btn");
    if (el) el.classList.toggle("mono", isMono());
    if (btn) btn.classList.toggle("active", isMono());
}

let rawMode = false;

function toggleRaw() {
    rawMode = !rawMode;
    document.getElementById("marginalia-raw-btn")?.classList.toggle("active", rawMode);
    renderChat();
}

let contextLimit = 200000;

async function fetchContextLimit(modelId) {
    if (!modelId) return;
    try {
        const res = await fetch("https://openrouter.ai/api/v1/models");
        const data = await res.json();
        const model = data.data?.find(m => m.id === modelId)
            || data.data?.find(m => m.id.startsWith(modelId));
        if (model?.context_length) {
            contextLimit = model.context_length;
            renderStats();
        }
    } catch {}
}

function renderStats() {
    const el = document.getElementById("marginalia-chat-stats");
    const bar = document.getElementById("marginalia-stats-fill");
    if (!el) return;

    const total = chatState.stats.inputTokens + chatState.stats.outputTokens;
    const ctx = chatState.stats.lastContextTokens;
    const pct = Math.min(100, (ctx / contextLimit) * 100);

    const modelName = chatState.stats.model || getChatModel();
    let parts = [];
    if (ctx > 0) parts.push(`ctx: ${fmtTokens(ctx)}/${fmtTokens(contextLimit)}`);
    if (total > 0) parts.push(`${fmtTokens(chatState.stats.inputTokens)} in / ${fmtTokens(chatState.stats.outputTokens)} out`);
    if (chatState.stats.cost > 0) parts.push(`$${chatState.stats.cost.toFixed(4)}`);

    const textEl = el.querySelector(".marginalia-stats-text");
    textEl.innerHTML = "";

    const modelSpan = document.createElement("span");
    modelSpan.className = "marginalia-model-name";
    modelSpan.textContent = modelName;
    modelSpan.title = "Click to change model for this book";
    modelSpan.addEventListener("click", promptChangeModel);
    textEl.appendChild(modelSpan);

    if (parts.length) {
        const rest = document.createTextNode(" | " + parts.join(" | "));
        textEl.appendChild(rest);
    }

    if (bar) {
        bar.style.width = pct + "%";
        bar.style.background = pct > 80 ? "#e05555" : pct > 50 ? "#e0a055" : "#4a9eff";
    }
}

function promptChangeModel() {
    const current = getChatModel();
    const newModel = prompt("Model for this book's chat:", current);
    if (newModel && newModel.trim() && newModel.trim() !== current) {
        setChatModel(newModel.trim());
        chatState.stats.model = newModel.trim();
        saveChatState();
    }
}

function fmtTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
}

let contextInterval = null;

async function toggleChat() {
    const s = getSettings();
    const outer = document.getElementById("outerContainer");
    const isOpen = outer.classList.contains("chatOpen");
    if (!isOpen && !s.apiKey) {
        alert("Please set your OpenRouter API key in Settings (on the library page).");
        return;
    }
    outer.classList.toggle("chatOpen");
    const nowOpen = outer.classList.contains("chatOpen");
    localStorage.setItem("marginalia_chat_open", nowOpen ? "1" : "0");
    if (nowOpen) {
        refreshContextBar();
        contextInterval = setInterval(refreshContextBar, 1000);
    } else {
        clearInterval(contextInterval);
        contextInterval = null;
    }
}

async function refreshContextBar() {
    updateContextBar(await getContext());
}

function openPromptEditor() {
    const overlay = document.getElementById("marginalia-prompt-overlay");
    document.getElementById("marginalia-prompt-textarea").value = getBookPrompt();
    overlay.classList.remove("hidden");
}

function savePromptEditor() {
    const text = document.getElementById("marginalia-prompt-textarea").value.trim();
    setBookPrompt(text);
    closePromptEditor();
}

function closePromptEditor() {
    document.getElementById("marginalia-prompt-overlay").classList.add("hidden");
    document.getElementById("marginalia-prompt-viewer").classList.add("hidden");
}

async function togglePromptViewer() {
    const viewer = document.getElementById("marginalia-prompt-viewer");
    if (!viewer.classList.contains("hidden")) {
        viewer.classList.add("hidden");
        return;
    }
    const context = await getContext();
    let system = renderPrompt(SYSTEM_PROMPT, context);
    const bookPrompt = getBookPrompt();
    if (bookPrompt) system += "\n\n## Book-specific instructions (MUST FOLLOW)\n" + bookPrompt;
    document.getElementById("marginalia-prompt-viewer-text").textContent = system;
    viewer.classList.remove("hidden");
}

function openToolsEditor() {
    const overlay = document.getElementById("marginalia-tools-overlay");
    const list = document.getElementById("marginalia-tools-list");
    list.innerHTML = "";
    for (const tool of getAllTools()) {
        const row = document.createElement("label");
        row.className = "marginalia-tool-row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = tool.enabled;
        cb.addEventListener("change", () => setToolEnabled(tool.name, cb.checked));
        const info = document.createElement("div");
        info.className = "marginalia-tool-info";
        info.innerHTML = `<strong>${tool.name}</strong><span>${tool.description}</span>`;
        row.appendChild(cb);
        row.appendChild(info);
        list.appendChild(row);
    }
    overlay.classList.remove("hidden");
}

function closeToolsEditor() {
    document.getElementById("marginalia-tools-overlay").classList.add("hidden");
}

function clearChat() {
    if (chatState.messages.length === 0) return;
    if (!confirm("Clear chat history for this book?")) return;
    chatState.messages = [];
    chatState.summary = null;
    chatState.stats = { inputTokens: 0, outputTokens: 0, cost: 0, lastContextTokens: 0, model: "" };
    saveChatState();
    renderChat();
    renderStats();
}

// Estimate tokens from text (rough: ~3.5 chars per token for English, ~2 for mixed)
function _estimateTokens(text) {
    return Math.ceil((text || "").length / 3.5);
}

// Build API messages with context management:
// 1. System prompt (always)
// 2. Compacted summary of old conversation (if exists)
// 3. Older messages with trimmed assistant responses
// 4. Recent messages in full (last RECENT_COUNT)
const RECENT_MSG_COUNT = 12; // ~6 exchanges kept verbatim
const MAX_OLD_ASSISTANT_CHARS = 400;
const MAX_OLD_USER_CHARS = 200;

function buildApiMessages(systemPrompt, messages, summary) {
    const convMessages = messages.filter(m => m.role === "user" || m.role === "assistant");
    const result = [{ role: "system", content: systemPrompt }];

    // Inject summary of compacted history
    if (summary) {
        result.push({ role: "assistant", content: "Previous conversation summary:\n" + summary });
    }

    // Split into recent (full) and older (trimmed)
    const recent = convMessages.slice(-RECENT_MSG_COUNT);
    const older = convMessages.slice(0, -RECENT_MSG_COUNT);

    // Trim older messages (both user and assistant)
    for (const m of older) {
        const limit = m.role === "user" ? MAX_OLD_USER_CHARS : MAX_OLD_ASSISTANT_CHARS;
        if (m.content && m.content.length > limit) {
            result.push({ role: m.role, content: m.content.slice(0, limit) + "\n...[trimmed]" });
        } else {
            result.push({ role: m.role, content: m.content });
        }
    }

    // Recent messages in full
    for (const m of recent) {
        result.push({ role: m.role, content: m.content });
    }

    return result;
}

async function compactChat() {
    const convMessages = chatState.messages.filter(m => m.role === "user" || m.role === "assistant");
    if (convMessages.length < 6) return;

    const s = getSettings();
    if (!s.apiKey) return;

    chatState.messages.push({ role: "system", content: "Compacting conversation..." });
    renderChat();

    // Split: summarize the older portion, keep recent verbatim
    const recent = convMessages.slice(-RECENT_MSG_COUNT);
    const older = convMessages.slice(0, -RECENT_MSG_COUNT);

    if (older.length < 2) {
        chatState.messages = chatState.messages.filter(m => m.content !== "Compacting conversation...");
        return;
    }

    // Build summarization prompt
    const previousSummary = chatState.summary ? `Previous summary:\n${chatState.summary}\n\n` : "";
    const historyText = older.map(m => `${m.role}: ${m.content}`).join("\n\n");

    const compactPrompt = [
        { role: "system", content: `Summarize this reading assistant conversation into a structured reference.
Preserve ALL of:
- Page numbers and citations mentioned
- Key conclusions and analysis
- Book titles and IDs referenced
- Folder/library changes made
- Any specific facts or arguments discussed
Format as a bulleted list grouped by topic. Be specific, cite pages.
${previousSummary}Conversation to summarize:` },
        { role: "user", content: historyText },
    ];

    try {
        const data = await simpleLLMCall(s.apiKey, getChatModel(), compactPrompt);
        const summary = data.choices?.[0]?.message?.content || "";
        if (!summary) throw new Error("Empty summary");

        if (data.usage) {
            chatState.stats.inputTokens += data.usage.prompt_tokens || 0;
            chatState.stats.outputTokens += data.usage.completion_tokens || 0;
            chatState.stats.cost += data.usage.cost || 0;
        }

        // Merge with existing summary
        chatState.summary = summary;

        // Keep only recent messages + a compaction notice
        chatState.messages = chatState.messages.filter(m => m.content !== "Compacting conversation...");
        const recentFromAll = chatState.messages.slice(-RECENT_MSG_COUNT);
        chatState.messages = [
            { role: "system", content: `Conversation compacted (${older.length} messages summarized)` },
            ...recentFromAll,
        ];
    } catch (err) {
        chatState.messages = chatState.messages.filter(m => m.content !== "Compacting conversation...");
        chatState.messages.push({ role: "system", content: `Compact failed: ${err.message}` });
    }

    saveChatState();
    renderChat();
    renderStats();
}

function renderMarkdown(text) {
    const blocks = [];
    const inlines = [];

    // Protect [p.N] page links from markdown parser
    const pageLinks = [];
    let result = text.replace(/\[p\.(\d+(?:[-–]\d+)?)\]/g, (m) => {
        const id = `%%PAGE${pageLinks.length}%%`;
        pageLinks.push(m);
        return id;
    });

    result = result.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_, a, b) => {
        const id = `%%BLOCK${blocks.length}%%`;
        blocks.push(a || b);
        return id;
    });

    result = result.replace(/\\\((.*?)\\\)|\$([^\s$](?:[^$]*?[^\s$])?)\$/g, (_, a, b) => {
        const id = `%%INLINE${inlines.length}%%`;
        inlines.push(a || b);
        return id;
    });

    if (typeof marked !== "undefined") {
        result = marked.parse(result);
    }

    if (typeof katex !== "undefined") {
        blocks.forEach((tex, i) => {
            try {
                result = result.replace(`%%BLOCK${i}%%`,
                    katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }));
            } catch {}
        });
        inlines.forEach((tex, i) => {
            try {
                result = result.replace(`%%INLINE${i}%%`,
                    katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false }));
            } catch {}
        });
    }

    // Strip UUIDs from display — user doesn't need them
    result = result.replace(/\s*\(id:\s*`?[0-9a-f-]{36}`?\)/gi, "");
    result = result.replace(/\bid:\s*`[0-9a-f-]{36}`/gi, "");
    result = result.replace(/`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`/g, "");

    // Restore [p.N] page links
    pageLinks.forEach((pl, i) => { result = result.replace(`%%PAGE${i}%%`, pl); });

    // Clickable page links — preferred [p.N] format
    result = result.replace(/\[p\.(\d+)[-–](\d+)\]/g, '<a class="marginalia-page-link" data-page="$1" href="#">p.$1-$2</a>');
    result = result.replace(/\[p\.(\d+)\]/g, '<a class="marginalia-page-link" data-page="$1" href="#">p.$1</a>');

    // Fallback — catch common patterns the model uses despite instructions
    const _pl = (m, pre, n) => `${pre}<a class="marginalia-page-link" data-page="${n}" href="#">${n}</a>`;
    result = result.replace(/\b(p\.)(\d+)\b/g, _pl);
    result = result.replace(/\b(pp?\.\s*)(\d+)\b/g, _pl);
    result = result.replace(/\b(page\s+)(\d+)\b/gi, _pl);
    result = result.replace(/\b(pages?\s+)(\d+)\b/gi, _pl);
    result = result.replace(/(стр\.\s*)(\d+)/g, _pl);
    result = result.replace(/(с\.\s+)(\d+)/g, _pl);
    result = result.replace(/(страниц[а-яё]*\s+)(\d+)/gi, _pl);

    return result;
}

function renderChat() {
    const el = document.getElementById("marginalia-chat-messages");
    el.innerHTML = "";
    for (const msg of chatState.messages) {
        el.appendChild(createMsgEl(msg));
    }
    el.scrollTop = el.scrollHeight;
}

function createMsgEl(msg) {
    const div = document.createElement("div");
    div.className = `marginalia-msg ${msg.role}`;
    if (msg.role === "assistant") {
        if (rawMode) {
            div.textContent = msg.content;
            div.style.whiteSpace = "pre-wrap";
            div.style.fontFamily = "monospace";
            div.style.fontSize = "0.9em";
        } else {
            div.innerHTML = renderMarkdown(msg.content);
        }
        div.dataset.raw = msg.content;
        const copyBtn = document.createElement("button");
        copyBtn.className = "marginalia-copy-btn";
        copyBtn.textContent = "Copy";
        copyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(div.dataset.raw).catch(() => {});
            copyBtn.textContent = "Copied";
            setTimeout(() => copyBtn.textContent = "Copy", 1500);
        });
        div.appendChild(copyBtn);
    } else {
        div.textContent = msg.content;
    }
    return div;
}

async function getContext() {
    try {
        return await buildLibraryContext();
    } catch (err) {
        console.error("getContext failed:", err);
        // Fallback minimal context
        const app = window.PDFViewerApplication;
        return {
            page: app?.page || 1,
            totalPages: app?.pagesCount || 1,
            title: document.title.replace(" - Marginalia", ""),
            selection: "",
            time: new Date().toLocaleString(),
            pageText: "",
            pageHistory: "",
            libraryTree: "(error loading library)",
            focusContext: `Page: ${app?.page || 1}`,
            currentBookId: getBookId(),
            currentBookTitle: "",
            bookCount: 0,
            folderCount: 0,
            totalSize: 0,
            totalPageCount: 0,
        };
    }
}

function setSending(val) {
    chatState.sending = val;
    const btn = document.getElementById("marginalia-chat-send");
    const input = document.getElementById("marginalia-chat-input");
    if (btn) {
        btn.disabled = val;
        if (!val && btn._wasSending) {
            // Flash a done indicator
            btn.textContent = "✓";
            btn.classList.add("done");
            setTimeout(() => { btn.textContent = "Send"; btn.classList.remove("done"); }, 1500);
        }
        btn._wasSending = val;
    }
    if (input) {
        input.disabled = val;
        if (!val) input.focus();
    }
}

function showThinking() {
    const el = document.getElementById("marginalia-chat-messages");
    const div = document.createElement("div");
    div.className = "marginalia-msg assistant marginalia-thinking";
    div.innerHTML = '<span class="thinking-dots">Thinking<span>.</span><span>.</span><span>.</span></span>';
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
}

function hideThinking() {
    document.querySelectorAll(".marginalia-thinking").forEach(el => el.remove());
}

function _humanizeToolAction(name, args) {
    // Friendly descriptions — never show UUIDs
    switch (name) {
        case "read_page": return `Reading page ${args.page}...`;
        case "read_pages": return `Reading pages ${args.from}-${args.to}...`;
        case "search_book": return `Searching for "${args.query}"...`;
        case "search_all_books": return `Searching all books for "${args.query}"...`;
        case "go_to_page": return `Going to page ${args.page}...`;
        case "go_back": return "Going back...";
        case "open_book": return "Opening book...";
        case "get_table_of_contents": return "Getting table of contents...";
        case "rename_book": return `Renaming to "${args.new_title}"...`;
        case "move_book": return "Moving book...";
        case "delete_book": return "Deleting book...";
        case "create_folder": return `Creating folder "${args.name}"...`;
        case "rename_folder": return `Renaming folder to "${args.new_name}"...`;
        case "delete_folder": return "Deleting folder...";
        case "move_folder": return "Moving folder...";
        case "batch_move_books": return `Moving ${args.book_ids?.length || "?"} books...`;
        case "batch_rename_books": return `Renaming ${args.renames?.length || "?"} books...`;
        default: return `${name}...`;
    }
}

// Tool activity is shown as ephemeral UI, not stored in chatState.messages.
// After the turn, a compact summary replaces the individual tool lines.
let _toolActivity = []; // accumulates during a turn

function _showToolActivity(name, args) {
    _toolActivity.push(_humanizeToolAction(name, args));

    // Update or create the tool activity element
    const messagesEl = document.getElementById("marginalia-chat-messages");
    let actEl = document.getElementById("marginalia-tool-activity");
    if (!actEl) {
        actEl = document.createElement("div");
        actEl.id = "marginalia-tool-activity";
        actEl.className = "marginalia-msg tool-activity";
        messagesEl.appendChild(actEl);
    }
    actEl.textContent = _toolActivity.join("\n");
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function _clearToolActivity() {
    const actEl = document.getElementById("marginalia-tool-activity");
    if (actEl) actEl.remove();
}

function _finalizeToolActivity() {
    _clearToolActivity();
    if (_toolActivity.length > 0) {
        // Store a compact one-line summary in chat history
        const summary = _toolActivity.length <= 2
            ? _toolActivity.join(" → ")
            : `${_toolActivity[0]} → ... → ${_toolActivity[_toolActivity.length - 1]} (${_toolActivity.length} steps)`;
        chatState.messages.push({ role: "system", content: summary });
    }
    _toolActivity = [];
}

async function sendMessage() {
    const input = document.getElementById("marginalia-chat-input");
    const text = input.value.trim();
    if (!text || chatState.sending) return;

    const s = getSettings();
    if (!s.apiKey) return;

    const context = await getContext();
    updateContextBar(context);
    _cachedSelection = ""; // consumed — clear for next turn

    chatState.messages.push({ role: "user", content: text });
    input.value = "";
    renderChat();
    setSending(true);
    showThinking();
    _toolActivity = [];

    // Build system prompt
    let system = renderPrompt(SYSTEM_PROMPT, context);
    const bookPrompt = getBookPrompt();
    if (bookPrompt) {
        system += "\n\n## Book-specific instructions (MUST FOLLOW)\n" + bookPrompt;
    }

    // Build API messages with context management (trimming + summary)
    const apiMessages = buildApiMessages(system, chatState.messages, chatState.summary);

    // Prepare streaming message element
    let streamingMsgEl = null;
    let streamingContent = "";

    try {
        const result = await agentLoop(s.apiKey, getChatModel(), apiMessages, {
            onThinking: (iteration) => {
                if (iteration > 0) {
                    // Agent is doing another LLM call after tool execution
                    showThinking();
                }
            },
            onDelta: (delta, fullContent) => {
                // First delta — finalize tool activity and start streaming
                if (!streamingMsgEl) {
                    hideThinking();
                    _finalizeToolActivity();
                    renderChat(); // re-render to show tool summary
                    streamingContent = "";
                    chatState.messages.push({ role: "assistant", content: "" });
                    streamingMsgEl = createMsgEl(chatState.messages[chatState.messages.length - 1]);
                    document.getElementById("marginalia-chat-messages").appendChild(streamingMsgEl);
                }
                streamingContent = fullContent;
                chatState.messages[chatState.messages.length - 1].content = fullContent;
                if (rawMode) {
                    streamingMsgEl.textContent = fullContent;
                } else {
                    streamingMsgEl.innerHTML = renderMarkdown(fullContent);
                }
                streamingMsgEl.dataset.raw = fullContent;
                const el = document.getElementById("marginalia-chat-messages");
                el.scrollTop = el.scrollHeight;
            },
            onToolCall: (name, args) => {
                hideThinking();
                _showToolActivity(name, args);
            },
            onToolResult: (name, args, toolResult) => {
                // Activity already shown by onToolCall
            },
            onUsage: (usage, model) => {
                chatState.stats.inputTokens += usage.prompt_tokens || 0;
                chatState.stats.outputTokens += usage.completion_tokens || 0;
                chatState.stats.cost += usage.cost || 0;
                chatState.stats.lastContextTokens = usage.prompt_tokens || 0;
                if (model) {
                    chatState.stats.model = model;
                    fetchContextLimit(model);
                }
            },
        });

        hideThinking();

        // If we streamed, the message is already in chatState.messages; just add copy button
        if (streamingMsgEl) {
            const copyBtn = document.createElement("button");
            copyBtn.className = "marginalia-copy-btn";
            copyBtn.textContent = "Copy";
            copyBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(streamingMsgEl.dataset.raw).catch(() => {});
                copyBtn.textContent = "Copied";
                setTimeout(() => copyBtn.textContent = "Copy", 1500);
            });
            streamingMsgEl.appendChild(copyBtn);
        } else {
            // No streaming happened (edge case) — add result normally
            chatState.messages.push({ role: "assistant", content: result.content });
        }
        renderStats();
    } catch (err) {
        hideThinking();
        _finalizeToolActivity();
        chatState.messages.push({ role: "assistant", content: `Error: ${err.message}` });
    }
    _clearToolActivity();
    setSending(false);
    saveChatState();
    if (!streamingMsgEl) renderChat();

    // Auto-compact: trigger on token threshold OR message count
    if (getAutoCompactEnabled()) {
        const convCount = chatState.messages.filter(m => m.role === "user" || m.role === "assistant").length;
        const overTokens = chatState.stats.lastContextTokens > getAutoCompactThreshold();
        const overMessages = convCount > RECENT_MSG_COUNT + 10; // ~11+ exchanges beyond the recent window
        if ((overTokens || overMessages) && convCount > RECENT_MSG_COUNT + 4) {
            await compactChat();
        }
    }
}

function updateContextBar(context) {
    const fill = document.getElementById("marginalia-context-fill");
    const text = document.getElementById("marginalia-context-text");
    if (!fill || !text) return;

    const pct = context.totalPages > 1
        ? ((context.page - 1) / (context.totalPages - 1)) * 100
        : 100;
    fill.style.width = pct + "%";

    const title = context.title || document.title.replace(" - Marginalia", "");
    const shortTitle = title.length > 30 ? title.slice(0, 28) + "..." : title;
    let info = `${shortTitle} — p.${context.page}/${context.totalPages}`;
    if (context.selection) {
        const preview = context.selection.length > 40
            ? context.selection.slice(0, 38) + "..."
            : context.selection;
        info += ` | "${preview}"`;
    }
    text.textContent = info;
}

// --- Init ---

// Called by open_book tool to reload the viewer with a different book
var _onBookChange = function(bookId) {
    // Save current book's chat state before switching
    saveChatState();
    // Switch to new book
    sessionStorage.setItem("marginalia_book_id", bookId);
    // Load new book's chat state
    chatState.messages = [];
    chatState.summary = null;
    chatState.stats = { inputTokens: 0, outputTokens: 0, cost: 0, lastContextTokens: 0, model: "" };
    loadChatState();
    renderChat();
    renderStats();
    // Reload PDF
    loadPdfFromDB();
    initPageTracking();
};

// Cache text selection — captured before focus moves to chat input
var _cachedSelection = "";

function _captureSelection() {
    const sel = window.getSelection()?.toString().trim() || "";
    if (sel) _cachedSelection = sel;
}

function init() {
    loadChatState();
    fetchContextLimit(chatState.stats.model || getChatModel());
    injectUI();
    applyTheme();
    loadPdfFromDB();
    initPageTracking();

    // Capture selection on any mouseup/touchend in the viewer
    document.addEventListener("mouseup", _captureSelection);

    document.addEventListener("touchend", _captureSelection);
    // Restore chat open state
    if (localStorage.getItem("marginalia_chat_open") === "1") {
        const outer = document.getElementById("outerContainer");
        if (outer && getSettings().apiKey) {
            outer.classList.add("chatOpen");
            refreshContextBar();
            contextInterval = setInterval(refreshContextBar, 1000);
        }
    }
}

if (window.PDFViewerApplication) {
    init();
} else {
    document.addEventListener("webviewerloaded", () => init(), { once: true });
}

// Auto-reload when SW updates
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
}
