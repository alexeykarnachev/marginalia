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
- **Citations**: Always cite page numbers when referencing book content.
- **Conciseness**: Match response length to the question. For search results with many matches, show top 5-7 and summarize the rest.
- **Deduplication**: Reference earlier results briefly rather than repeating in full.
- **Accuracy**: When organizing books into categories, verify facts before acting. If unsure about a book's genre, author nationality, or classification, say so rather than guessing wrong. Kafka is not English, Homer is not modern, etc.
- **Ambiguity**: When user instructions are vague ("make it cleaner", "organize"), explain your plan before executing. For clear instructions, act immediately.
- **Custom instructions**: If a "Book-specific instructions" section appears below, follow it strictly — it overrides your default behavior for style, language, format, and tone. These are set by the user for this specific book.
- **LaTeX**: Use KaTeX-compatible syntax for math.`;

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

function getSettings() {
    return {
        apiKey: localStorage.getItem("openrouter_api_key") || "",
        model: getChatModel(),
    };
}

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
        || localStorage.getItem("openrouter_model")
        || "x-ai/grok-4.1-fast";
}

function setChatModel(model) {
    localStorage.setItem(modelStorageKey(), model);
}

// --- Theme ---

function getTheme() {
    return localStorage.getItem("marginalia_theme") || "dark";
}

function setTheme(t) {
    localStorage.setItem("marginalia_theme", t);
    applyTheme();
}

function applyTheme() {
    const html = document.documentElement;
    const lightEls = [
        document.getElementById("marginalia-chat"),
        document.getElementById("marginalia-prompt-overlay"),
        document.getElementById("marginalia-tools-overlay"),
    ];
    if (getTheme() === "light") {
        html.classList.remove("is-dark");
        html.classList.add("is-light");
        lightEls.forEach(el => el?.classList.add("marginalia-light"));
    } else {
        html.classList.remove("is-light");
        html.classList.add("is-dark");
        lightEls.forEach(el => el?.classList.remove("marginalia-light"));
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
        messages: chatMessages,
        summary: chatSummary,
    }));
    localStorage.setItem(statsStorageKey(), JSON.stringify(chatStats));
}

function loadChatState() {
    try {
        const raw = JSON.parse(localStorage.getItem(chatStorageKey()));
        if (Array.isArray(raw)) {
            // Legacy format: bare array
            chatMessages = raw;
            chatSummary = null;
        } else if (raw && raw.messages) {
            chatMessages = raw.messages;
            chatSummary = raw.summary || null;
        }
    } catch {}
    try {
        const stats = JSON.parse(localStorage.getItem(statsStorageKey()));
        if (stats) chatStats = { ...chatStats, ...stats };
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
}

// --- Inject UI ---

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
        themeBtn.addEventListener("click", () => setTheme(getTheme() === "dark" ? "light" : "dark"));
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
    document.body.appendChild(chatPanel);

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
    document.getElementById("marginalia-mono-btn").addEventListener("click", toggleMono);
    document.getElementById("marginalia-raw-btn").addEventListener("click", toggleRaw);

    // Clickable page citations in chat
    document.getElementById("marginalia-chat-messages").addEventListener("click", (e) => {
        const link = e.target.closest(".marginalia-page-link");
        if (link) {
            e.preventDefault();
            const page = parseInt(link.dataset.page);
            if (page && window.PDFViewerApplication) {
                window.PDFViewerApplication.page = page;
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

    function onMove(x) {
        if (startX == null) return;
        panel.style.width = Math.max(280, startW - (x - startX)) + "px";
    }

    handle.addEventListener("mousedown", (e) => { startX = e.clientX; startW = panel.offsetWidth; });
    document.addEventListener("mousemove", (e) => onMove(e.clientX));
    document.addEventListener("mouseup", () => {
        if (startX != null) localStorage.setItem("marginalia_chat_width", panel.offsetWidth);
        startX = null;
    });

    handle.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; startW = panel.offsetWidth; });
    document.addEventListener("touchmove", (e) => { if (startX != null) onMove(e.touches[0].clientX); });
    document.addEventListener("touchend", () => {
        if (startX != null) localStorage.setItem("marginalia_chat_width", panel.offsetWidth);
        startX = null;
    });

    const saved = localStorage.getItem("marginalia_chat_width");
    if (saved) panel.style.width = saved + "px";
}

function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
        #marginalia-chat {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: 380px;
            min-width: 280px;
            max-width: 70vw;
            background: #1e1e1e;
            color: #e0e0e0;
            display: flex;
            flex-direction: column;
            z-index: 100000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 14px;
            transform: translateX(100%);
            transition: transform 0.2s ease;
        }
        #marginalia-chat.open { transform: translateX(0); }
        #marginalia-chat-resize {
            position: absolute;
            left: -4px;
            top: 0;
            bottom: 0;
            width: 8px;
            cursor: col-resize;
            z-index: 10;
        }
        #marginalia-chat-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: #2a2a2a;
            border-bottom: 1px solid #333;
            flex-shrink: 0;
        }
        #marginalia-chat-header-right {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #marginalia-font-size {
            display: flex;
            gap: 2px;
        }
        .marginalia-font-btn {
            background: #333;
            border: 1px solid #555;
            color: #aaa;
            height: 26px;
            width: 28px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            padding: 0;
        }
        .marginalia-font-btn.active {
            background: #4a9eff;
            border-color: #4a9eff;
            color: white;
        }
        #marginalia-mono-btn,
        #marginalia-raw-btn {
            background: #333;
            border: 1px solid #555;
            color: #aaa;
            height: 26px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            padding: 0 6px;
        }
        #marginalia-mono-btn.active,
        #marginalia-raw-btn.active {
            background: #4a9eff;
            border-color: #4a9eff;
            color: white;
        }
        #marginalia-chat-clear,
        #marginalia-chat-compact,
        #marginalia-chat-prompt,
        #marginalia-chat-tools {
            background: none;
            border: 1px solid #444;
            color: #999;
            height: 26px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            padding: 0 8px;
            white-space: nowrap;
        }
        #marginalia-chat-close {
            background: none;
            border: none;
            color: #e0e0e0;
            font-size: 22px;
            cursor: pointer;
            padding: 0;
        }
        #marginalia-chat-clear:hover,
        #marginalia-chat-compact:hover,
        #marginalia-chat-prompt:hover,
        #marginalia-chat-tools:hover {
            border-color: #888;
            color: #e0e0e0;
        }
        #marginalia-context-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: #252525;
            color: #888;
            font-size: 12px;
            border-bottom: 1px solid #333;
            flex-shrink: 0;
        }
        #marginalia-context-progress {
            flex-shrink: 0;
            width: 60px;
            height: 4px;
            background: #333;
            border-radius: 2px;
            overflow: hidden;
        }
        #marginalia-context-fill {
            height: 100%;
            background: #4a9eff;
            border-radius: 2px;
            transition: width 0.3s ease;
        }
        #marginalia-chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        #marginalia-chat-messages.mono {
            font-family: "Consolas", "Monaco", "Courier New", monospace;
        }
        .marginalia-msg {
            padding: 8px 12px;
            border-radius: 8px;
            word-break: break-word;
            line-height: 1.5;
            position: relative;
        }
        .marginalia-msg.user {
            align-self: flex-end;
            background: #2b5278;
            max-width: 85%;
            white-space: pre-wrap;
        }
        .marginalia-msg.assistant {
            background: #2a2a2a;
        }
        .marginalia-msg.assistant code {
            background: #363636;
            padding: 1px 4px;
            border-radius: 3px;
            font-size: 0.9em;
        }
        .marginalia-msg.assistant pre {
            background: #363636;
            padding: 10px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
        }
        .marginalia-msg.assistant pre code {
            background: none;
            padding: 0;
        }
        .marginalia-msg.assistant strong {
            color: #fff;
        }
        .marginalia-msg.assistant h3,
        .marginalia-msg.assistant h4 {
            margin: 12px 0 4px;
            color: #fff;
        }
        .marginalia-msg.assistant table {
            width: 100%;
            border-collapse: collapse;
            margin: 8px 0;
            font-size: 0.9em;
        }
        .marginalia-msg.assistant th,
        .marginalia-msg.assistant td {
            border: 1px solid #444;
            padding: 6px 10px;
            text-align: left;
        }
        .marginalia-msg.assistant th {
            background: #363636;
            font-weight: 600;
            color: #fff;
        }
        .marginalia-msg.assistant tr:nth-child(even) {
            background: #2f2f2f;
        }
        .marginalia-msg.system {
            background: #1a2e1a;
            color: #8a8;
            font-size: 0.85em;
            font-style: italic;
        }
        .marginalia-msg.tool-status {
            background: #1a1a2e;
            color: #88a;
            font-size: 0.8em;
            font-style: italic;
            padding: 4px 12px;
        }
        .marginalia-copy-btn {
            position: absolute;
            top: 6px;
            right: 6px;
            background: #444;
            border: 1px solid #555;
            color: #ccc;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 3px;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .marginalia-msg:hover .marginalia-copy-btn { opacity: 1; }
        .marginalia-page-link {
            color: #4a9eff;
            text-decoration: underline;
            text-decoration-style: dotted;
            cursor: pointer;
        }
        .marginalia-page-link:hover { text-decoration-style: solid; }

        .thinking-dots span {
            animation: blink 1.4s infinite both;
        }
        .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
        .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes blink { 0%, 80%, 100% { opacity: 0; } 40% { opacity: 1; } }

        #marginalia-chat-stats {
            padding: 4px 12px;
            background: #252525;
            color: #888;
            font-size: 11px;
            border-top: 1px solid #333;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #marginalia-stats-bar {
            flex-shrink: 0;
            width: 40px;
            height: 3px;
            background: #333;
            border-radius: 2px;
            overflow: hidden;
        }
        #marginalia-stats-fill {
            height: 100%;
            background: #4a9eff;
            border-radius: 2px;
            transition: width 0.3s ease;
        }
        .marginalia-model-name {
            cursor: pointer;
            text-decoration: underline;
            text-decoration-style: dotted;
        }

        #marginalia-chat-input-area {
            display: flex;
            gap: 8px;
            padding: 10px 12px;
            background: #2a2a2a;
            flex-shrink: 0;
        }
        #marginalia-chat-input {
            flex: 1;
            background: #1a1a1a;
            color: #e0e0e0;
            border: 1px solid #444;
            border-radius: 6px;
            padding: 8px;
            font-size: 13px;
            resize: none;
            min-height: 36px;
            max-height: 120px;
            font-family: inherit;
        }
        #marginalia-chat-send {
            background: #4a9eff;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            align-self: flex-end;
        }
        #marginalia-chat-send:disabled {
            opacity: 0.5;
            cursor: default;
        }

        /* Light theme overrides */
        .marginalia-light #marginalia-chat { background: #f9f9f9; color: #333; }
        .marginalia-light #marginalia-mono-btn,
        .marginalia-light #marginalia-raw-btn { background: #ddd; border-color: #ccc; color: #666; }
        .marginalia-light #marginalia-mono-btn.active,
        .marginalia-light #marginalia-raw-btn.active { background: #4a9eff; border-color: #4a9eff; color: white; }
        .marginalia-light #marginalia-chat-header { background: #e8e8e8; color: #333; }
        .marginalia-light #marginalia-chat-close { color: #333; }
        .marginalia-light #marginalia-chat-clear,
        .marginalia-light #marginalia-chat-compact,
        .marginalia-light #marginalia-chat-prompt,
        .marginalia-light #marginalia-chat-tools { border-color: #ccc; color: #666; }
        .marginalia-light .marginalia-font-btn { background: #ddd; border-color: #ccc; color: #666; }
        .marginalia-light .marginalia-font-btn.active { background: #4a9eff; border-color: #4a9eff; color: white; }
        .marginalia-light #marginalia-context-bar { background: #eee; color: #666; border-color: #ddd; }
        .marginalia-light #marginalia-context-progress { background: #ccc; }
        .marginalia-light #marginalia-chat-messages { background: #f5f5f5; }
        .marginalia-light .marginalia-msg { color: #333; }
        .marginalia-light .marginalia-msg.assistant { background: #e0e0e0; }
        .marginalia-light .marginalia-msg.system { background: #e0f0e0; color: #585; }
        .marginalia-light .marginalia-msg.tool-status { background: #e0e0f0; color: #558; }
        .marginalia-light .marginalia-msg.assistant code { background: #d0d0d0; }
        .marginalia-light .marginalia-msg.assistant pre { background: #d0d0d0; }
        .marginalia-light .marginalia-msg.assistant strong { color: #111; }
        .marginalia-light .marginalia-msg.assistant h3,
        .marginalia-light .marginalia-msg.assistant h4 { color: #111; }
        .marginalia-light .marginalia-msg.assistant th,
        .marginalia-light .marginalia-msg.assistant td { border-color: #ccc; }
        .marginalia-light .marginalia-msg.assistant th { background: #ddd; color: #111; }
        .marginalia-light .marginalia-msg.assistant tr:nth-child(even) { background: #eee; }
        .marginalia-light .marginalia-copy-btn { background: #ddd; border-color: #bbb; color: #666; }
        .marginalia-light .marginalia-page-link { color: #2070cc; }
        .marginalia-light #marginalia-chat-stats { background: #eee; color: #888; border-color: #ddd; }
        .marginalia-light #marginalia-stats-bar { background: #ccc; }
        .marginalia-light #marginalia-chat-input-area { background: #e8e8e8; }
        .marginalia-light #marginalia-chat-input { background: #fff; color: #333; }

        /* Prompt editor overlay */
        .marginalia-prompt-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.6); z-index: 100001;
            display: flex; align-items: center; justify-content: center;
        }
        .marginalia-prompt-overlay.hidden { display: none; }
        #marginalia-prompt-modal {
            background: #2a2a2a; border: 1px solid #555; border-radius: 8px;
            padding: 20px; width: 90%; max-width: 500px; color: #ccc;
        }
        #marginalia-prompt-modal h3 { margin: 0 0 4px; color: #fff; font-size: 15px; }
        .marginalia-prompt-hint { margin: 0 0 12px; font-size: 12px; color: #888; }
        #marginalia-prompt-textarea {
            width: 100%; height: 150px; background: #1a1a1a; color: #ddd;
            border: 1px solid #555; border-radius: 4px; padding: 8px;
            font-size: 13px; resize: vertical; box-sizing: border-box;
            font-family: inherit;
        }
        .marginalia-prompt-buttons { margin-top: 10px; display: flex; gap: 8px; justify-content: flex-end; }
        .marginalia-prompt-buttons button {
            padding: 6px 16px; border-radius: 4px; border: 1px solid #555;
            cursor: pointer; font-size: 13px;
        }
        #marginalia-prompt-save { background: #4a9eff; color: #fff; border-color: #4a9eff; }
        #marginalia-prompt-cancel { background: transparent; color: #ccc; }

        .marginalia-light #marginalia-prompt-modal { background: #f5f5f5; border-color: #ccc; color: #333; }
        .marginalia-light #marginalia-prompt-modal h3 { color: #111; }
        .marginalia-light #marginalia-prompt-textarea { background: #fff; color: #333; border-color: #ccc; }
        .marginalia-light #marginalia-prompt-cancel { color: #666; border-color: #ccc; }

        /* Tools editor */
        #marginalia-tools-modal {
            background: #2a2a2a; border: 1px solid #555; border-radius: 8px;
            padding: 20px; width: 90%; max-width: 500px; color: #ccc;
            max-height: 80vh; overflow-y: auto;
        }
        #marginalia-tools-modal h3 { margin: 0 0 4px; color: #fff; font-size: 15px; }
        #marginalia-tools-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
        .marginalia-tool-row {
            display: flex; align-items: flex-start; gap: 10px;
            padding: 8px; border-radius: 6px; cursor: pointer;
            background: #222;
        }
        .marginalia-tool-row:hover { background: #2f2f2f; }
        .marginalia-tool-row input[type="checkbox"] {
            margin-top: 3px; flex-shrink: 0; width: 16px; height: 16px;
            accent-color: #4a9eff;
        }
        .marginalia-tool-info { display: flex; flex-direction: column; gap: 2px; }
        .marginalia-tool-info strong { font-size: 13px; color: #ddd; }
        .marginalia-tool-info span { font-size: 11px; color: #888; line-height: 1.4; }

        .marginalia-light #marginalia-tools-modal { background: #f5f5f5; border-color: #ccc; color: #333; }
        .marginalia-light #marginalia-tools-modal h3 { color: #111; }
        .marginalia-light .marginalia-tool-row { background: #eee; }
        .marginalia-light .marginalia-tool-row:hover { background: #e0e0e0; }
        .marginalia-light .marginalia-tool-info strong { color: #222; }
        .marginalia-light .marginalia-tool-info span { color: #666; }

        /* Tool result in chat */
        .marginalia-tool-result-preview {
            font-size: 0.8em; color: #888; margin-top: 2px;
            white-space: pre-wrap; max-height: 60px; overflow: hidden;
            text-overflow: ellipsis;
        }
    `;
    document.head.appendChild(style);
}

// --- Chat logic ---

let chatMessages = [];
let chatSummary = null; // Compressed summary of older conversation
let chatStats = { inputTokens: 0, outputTokens: 0, cost: 0, lastContextTokens: 0, model: "" };
let isSending = false;

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
let contextLimitFetched = false;

async function fetchContextLimit(modelId) {
    if (contextLimitFetched || !modelId) return;
    try {
        const res = await fetch("https://openrouter.ai/api/v1/models");
        const data = await res.json();
        const model = data.data?.find(m => m.id === modelId)
            || data.data?.find(m => m.id.startsWith(modelId));
        if (model?.context_length) {
            contextLimit = model.context_length;
            contextLimitFetched = true;
            renderStats();
        }
    } catch {}
}

function renderStats() {
    const el = document.getElementById("marginalia-chat-stats");
    const bar = document.getElementById("marginalia-stats-fill");
    if (!el) return;

    const total = chatStats.inputTokens + chatStats.outputTokens;
    const ctx = chatStats.lastContextTokens;
    const pct = Math.min(100, (ctx / contextLimit) * 100);

    const modelName = chatStats.model || getChatModel();
    let parts = [];
    if (ctx > 0) parts.push(`ctx: ${fmtTokens(ctx)}/${fmtTokens(contextLimit)}`);
    if (total > 0) parts.push(`${fmtTokens(chatStats.inputTokens)} in / ${fmtTokens(chatStats.outputTokens)} out`);
    if (chatStats.cost > 0) parts.push(`$${chatStats.cost.toFixed(4)}`);

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
        chatStats.model = newModel.trim();
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
    const panel = document.getElementById("marginalia-chat");
    if (!panel.classList.contains("open") && !s.apiKey) {
        alert("Please set your OpenRouter API key in Settings (on the library page).");
        return;
    }
    panel.classList.toggle("open");
    localStorage.setItem("marginalia_chat_open", panel.classList.contains("open") ? "1" : "0");
    if (panel.classList.contains("open")) {
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
    if (chatMessages.length === 0) return;
    if (!confirm("Clear chat history for this book?")) return;
    chatMessages = [];
    chatSummary = null;
    chatStats = { inputTokens: 0, outputTokens: 0, cost: 0, lastContextTokens: 0, model: "" };
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
    const convMessages = chatMessages.filter(m => m.role === "user" || m.role === "assistant");
    if (convMessages.length < 6) return;

    const s = getSettings();
    if (!s.apiKey) return;

    chatMessages.push({ role: "system", content: "Compacting conversation..." });
    renderChat();

    // Split: summarize the older portion, keep recent verbatim
    const recent = convMessages.slice(-RECENT_MSG_COUNT);
    const older = convMessages.slice(0, -RECENT_MSG_COUNT);

    if (older.length < 2) {
        chatMessages = chatMessages.filter(m => m.content !== "Compacting conversation...");
        return;
    }

    // Build summarization prompt
    const previousSummary = chatSummary ? `Previous summary:\n${chatSummary}\n\n` : "";
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
            chatStats.inputTokens += data.usage.prompt_tokens || 0;
            chatStats.outputTokens += data.usage.completion_tokens || 0;
            chatStats.cost += data.usage.cost || 0;
        }

        // Merge with existing summary
        chatSummary = summary;

        // Keep only recent messages + a compaction notice
        chatMessages = chatMessages.filter(m => m.content !== "Compacting conversation...");
        const recentFromAll = chatMessages.slice(-RECENT_MSG_COUNT);
        chatMessages = [
            { role: "system", content: `Conversation compacted (${older.length} messages summarized)` },
            ...recentFromAll,
        ];
    } catch (err) {
        chatMessages = chatMessages.filter(m => m.content !== "Compacting conversation...");
        chatMessages.push({ role: "system", content: `Compact failed: ${err.message}` });
    }

    saveChatState();
    renderChat();
    renderStats();
}

function renderMarkdown(text) {
    const blocks = [];
    const inlines = [];

    let result = text.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_, a, b) => {
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

    // Make page citations clickable: p.42, page 42, pp.10-15
    result = result.replace(/\bp\.(\d+)\b/g, '<a class="marginalia-page-link" data-page="$1" href="#">p.$1</a>');
    result = result.replace(/\bpage\s+(\d+)\b/gi, '<a class="marginalia-page-link" data-page="$1" href="#">page $1</a>');
    result = result.replace(/\bpp\.(\d+)[-–](\d+)\b/g, '<a class="marginalia-page-link" data-page="$1" href="#">pp.$1-$2</a>');

    return result;
}

function renderChat() {
    const el = document.getElementById("marginalia-chat-messages");
    el.innerHTML = "";
    for (const msg of chatMessages) {
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
    return buildLibraryContext();
}

function setSending(val) {
    isSending = val;
    const btn = document.getElementById("marginalia-chat-send");
    const input = document.getElementById("marginalia-chat-input");
    if (btn) btn.disabled = val;
    if (input) input.disabled = val;
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

function addToolStatusMsg(name, args, result) {
    const argsStr = Object.entries(args).map(([k, v]) => `${k}=${v}`).join(", ");
    let content = `tool: ${name}(${argsStr})`;
    if (result) {
        const preview = result.length > 150 ? result.slice(0, 150) + "..." : result;
        content += `\n→ ${preview}`;
    }
    chatMessages.push({ role: "system", content });
    renderChat();
}

async function sendMessage() {
    const input = document.getElementById("marginalia-chat-input");
    const text = input.value.trim();
    if (!text || isSending) return;

    const s = getSettings();
    if (!s.apiKey) return;

    const context = await getContext();
    updateContextBar(context);

    chatMessages.push({ role: "user", content: text });
    input.value = "";
    renderChat();
    setSending(true);
    showThinking();

    // Build system prompt
    let system = renderPrompt(SYSTEM_PROMPT, context);
    const bookPrompt = getBookPrompt();
    if (bookPrompt) {
        system += "\n\n## Book-specific instructions (MUST FOLLOW)\n" + bookPrompt;
    }

    // Build API messages with context management (trimming + summary)
    const apiMessages = buildApiMessages(system, chatMessages, chatSummary);

    // Prepare streaming message element
    let streamingMsgEl = null;
    let streamingContent = "";

    try {
        const result = await agentLoop(s.apiKey, s.model, apiMessages, {
            onThinking: (iteration) => {
                if (iteration > 0) {
                    // Agent is doing another LLM call after tool execution
                    showThinking();
                }
            },
            onDelta: (delta, fullContent) => {
                // First delta — create the streaming message element
                if (!streamingMsgEl) {
                    hideThinking();
                    streamingContent = "";
                    chatMessages.push({ role: "assistant", content: "" });
                    streamingMsgEl = createMsgEl(chatMessages[chatMessages.length - 1]);
                    document.getElementById("marginalia-chat-messages").appendChild(streamingMsgEl);
                }
                streamingContent = fullContent;
                chatMessages[chatMessages.length - 1].content = fullContent;
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
                // Don't add to chat yet — wait for result
            },
            onToolResult: (name, args, toolResult) => {
                addToolStatusMsg(name, args, toolResult);
            },
            onUsage: (usage, model) => {
                chatStats.inputTokens += usage.prompt_tokens || 0;
                chatStats.outputTokens += usage.completion_tokens || 0;
                chatStats.cost += usage.cost || 0;
                chatStats.lastContextTokens = usage.prompt_tokens || 0;
                if (model) {
                    chatStats.model = model;
                    fetchContextLimit(model);
                }
            },
        });

        hideThinking();

        // If we streamed, the message is already in chatMessages; just add copy button
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
            chatMessages.push({ role: "assistant", content: result.content });
        }
        renderStats();
    } catch (err) {
        hideThinking();
        chatMessages.push({ role: "assistant", content: `Error: ${err.message}` });
    }
    setSending(false);
    saveChatState();
    if (!streamingMsgEl) renderChat();

    // Auto-compact: trigger on token threshold OR message count
    if (getAutoCompactEnabled()) {
        const convCount = chatMessages.filter(m => m.role === "user" || m.role === "assistant").length;
        const overTokens = chatStats.lastContextTokens > getAutoCompactThreshold();
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

    let info = `p.${context.page}/${context.totalPages}`;
    if (context.selection) {
        const preview = context.selection.length > 60
            ? context.selection.slice(0, 60) + "..."
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
    chatMessages = [];
    chatSummary = null;
    chatStats = { inputTokens: 0, outputTokens: 0, cost: 0, lastContextTokens: 0, model: "" };
    loadChatState();
    renderChat();
    renderStats();
    // Reload PDF
    loadPdfFromDB();
    initPageTracking();
};

function init() {
    loadChatState();
    fetchContextLimit(chatStats.model || getChatModel());
    injectUI();
    applyTheme();
    loadPdfFromDB();
    initPageTracking();
    // Restore chat open state
    if (localStorage.getItem("marginalia_chat_open") === "1") {
        const panel = document.getElementById("marginalia-chat");
        if (panel && getSettings().apiKey) {
            panel.classList.add("open");
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
