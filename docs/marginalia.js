// Marginalia overlay for pdf.js viewer
// Loaded by viewer.html — adds: back button, chat panel, IndexedDB PDF loading

// --- IndexedDB helpers (shared with app.js) ---

const DB_NAME = "marginalia";
const DB_VERSION = 1;
const STORE_NAME = "books";

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getBook(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// --- Prompt ---

const SYSTEM_PROMPT = `You are Marginalia, an AI reading assistant.

## Environment
You are embedded in a static web application (Marginalia) that runs entirely in the browser.
The user is reading a document using pdf.js viewer. You see the extracted text of their current page.
Your responses are rendered with **Markdown** and **LaTeX** support:
- Use standard Markdown for formatting (headers, bold, lists, code blocks, etc.)
- Use LaTeX for math: inline \\(...\\) or $...$ and display \\[...\\] or $$...$$
- KaTeX is the renderer, so use KaTeX-compatible syntax.

## Current reading context
- Document: "{{title}}"
- Page: {{page}} of {{totalPages}}
- Time: {{time}}
{{#selection}}

## User's selected text
The user has highlighted this passage — they likely want it explained:
\`\`\`
{{selection}}
\`\`\`
{{/selection}}
{{#pageText}}

## Current page content (extracted text)
{{pageText}}
{{/pageText}}

## Guidelines
- Ground your answers in the page text when available. Don't guess or hallucinate content.
- When the user selects text, focus your explanation on that specific passage.
- Be concise but thorough. Prefer short, clear explanations over walls of text.
- Use LaTeX for any mathematical notation — the user is likely reading a technical document if math appears.
- You can reference other pages by number if the user asks about cross-references.`;

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

function modelStorageKey() {
    return `marginalia_model_${getBookId()}`;
}

function getChatModel() {
    return localStorage.getItem(modelStorageKey())
        || localStorage.getItem("openrouter_model")
        || "anthropic/claude-sonnet-4";
}

function setChatModel(model) {
    localStorage.setItem(modelStorageKey(), model);
    // Reset context limit for new model
    contextLimitFetched = false;
    fetchContextLimit(model);
    renderStats();
}

// --- Theme ---

function getTheme() {
    return localStorage.getItem("marginalia_theme") || "dark";
}

function setTheme(theme) {
    localStorage.setItem("marginalia_theme", theme);
    applyTheme();
}

function applyTheme() {
    const html = document.documentElement;
    const chat = document.getElementById("marginalia-chat");
    if (getTheme() === "light") {
        html.classList.remove("is-dark");
        html.classList.add("is-light");
        if (chat) chat.classList.add("marginalia-light");
    } else {
        html.classList.remove("is-light");
        html.classList.add("is-dark");
        if (chat) chat.classList.remove("marginalia-light");
    }
}

// --- Chat persistence ---

function getBookId() {
    return sessionStorage.getItem("marginalia_book_id") || "unknown";
}

function chatStorageKey() {
    return `marginalia_chat_${getBookId()}`;
}

function statsStorageKey() {
    return `marginalia_stats_${getBookId()}`;
}

function saveChatState() {
    localStorage.setItem(chatStorageKey(), JSON.stringify(chatMessages));
    localStorage.setItem(statsStorageKey(), JSON.stringify(chatStats));
}

function loadChatState() {
    try {
        const msgs = JSON.parse(localStorage.getItem(chatStorageKey()));
        if (Array.isArray(msgs)) chatMessages = msgs;
    } catch {}
    try {
        const stats = JSON.parse(localStorage.getItem(statsStorageKey()));
        if (stats) chatStats = { ...chatStats, ...stats };
    } catch {}
}

// --- Load PDF from IndexedDB ---

async function loadPdfFromDB() {
    const bookId = getBookId();
    if (bookId === "unknown") {
        window.location.href = "../../index.html";
        return;
    }

    const book = await getBook(bookId);
    if (!book) {
        window.location.href = "../../index.html";
        return;
    }

    const app = window.PDFViewerApplication;
    if (!app) {
        window.addEventListener("webviewerloaded", () => loadPdfIntoViewer(book));
        return;
    }
    await loadPdfIntoViewer(book);
}

async function loadPdfIntoViewer(book) {
    const app = window.PDFViewerApplication;
    await app.initializedPromise;
    const data = new Uint8Array(book.data);
    await app.open({ data });
    document.title = book.title + " - Marginalia";
}

// --- Inject UI ---

function injectUI() {
    // Back button in toolbar
    const toolbarLeft = document.getElementById("toolbarViewerLeft");
    if (toolbarLeft) {
        const backBtn = document.createElement("button");
        backBtn.className = "toolbarButton";
        backBtn.type = "button";
        backBtn.title = "Back to Library";
        backBtn.textContent = "\u2190";
        backBtn.style.cssText = "font-size: 18px; margin-right: 4px;";
        backBtn.addEventListener("click", () => {
            window.location.href = "../../index.html";
        });
        toolbarLeft.insertBefore(backBtn, toolbarLeft.firstChild);
    }

    // Theme toggle + Chat button in toolbar
    const toolbarRight = document.getElementById("toolbarViewerRight");
    if (toolbarRight) {
        const themeBtn = document.createElement("button");
        themeBtn.className = "toolbarButton";
        themeBtn.type = "button";
        themeBtn.id = "marginaliaTheme";
        themeBtn.title = "Toggle light/dark theme";
        themeBtn.textContent = getTheme() === "dark" ? "Light" : "Dark";
        themeBtn.style.cssText = "font-size: 13px; padding: 0 8px;";
        themeBtn.addEventListener("click", () => {
            const next = getTheme() === "dark" ? "light" : "dark";
            setTheme(next);
            themeBtn.textContent = next === "dark" ? "Light" : "Dark";
        });
        toolbarRight.insertBefore(themeBtn, toolbarRight.firstChild);

        const chatBtn = document.createElement("button");
        chatBtn.className = "toolbarButton";
        chatBtn.type = "button";
        chatBtn.id = "marginaliaChat";
        chatBtn.title = "AI Chat";
        chatBtn.textContent = "Chat";
        chatBtn.style.cssText = "font-size: 13px; padding: 0 8px;";
        chatBtn.addEventListener("click", toggleChat);
        toolbarRight.insertBefore(chatBtn, toolbarRight.firstChild);
    }

    // Chat panel
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

    document.getElementById("marginalia-chat-close").addEventListener("click", toggleChat);
    document.getElementById("marginalia-chat-send").addEventListener("click", sendMessage);
    document.getElementById("marginalia-chat-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    document.querySelectorAll(".marginalia-font-btn").forEach(btn => {
        btn.addEventListener("click", () => setChatFontSize(btn.dataset.size));
    });
    document.getElementById("marginalia-chat-clear").addEventListener("click", clearChat);
    document.getElementById("marginalia-chat-compact").addEventListener("click", compactChat);
    document.getElementById("marginalia-mono-btn").addEventListener("click", toggleMono);
    document.getElementById("marginalia-raw-btn").addEventListener("click", toggleRaw);

    initResize(chatPanel);
    injectStyles();
    applyChatFontSize();
    applyMono();
    renderChat();
    renderStats();
}

function initResize(panel) {
    const handle = document.getElementById("marginalia-chat-resize");
    let startX, startWidth;

    function onStart(clientX) {
        startX = clientX;
        startWidth = panel.offsetWidth;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
    }

    function onMove(clientX) {
        if (startX == null) return;
        const newWidth = Math.max(280, Math.min(window.innerWidth * 0.9, startWidth + (startX - clientX)));
        panel.style.width = newWidth + "px";
    }

    function onEnd() {
        if (startX != null) localStorage.setItem("marginalia_chat_width", panel.offsetWidth);
        startX = null;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
    }

    const saved = localStorage.getItem("marginalia_chat_width");
    if (saved) panel.style.width = saved + "px";

    handle.addEventListener("mousedown", (e) => { onStart(e.clientX); });
    document.addEventListener("mousemove", (e) => { onMove(e.clientX); });
    document.addEventListener("mouseup", onEnd);

    handle.addEventListener("touchstart", (e) => { onStart(e.touches[0].clientX); }, { passive: true });
    document.addEventListener("touchmove", (e) => { onMove(e.touches[0].clientX); });
    document.addEventListener("touchend", onEnd);
}

function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
        #marginalia-chat {
            position: fixed;
            top: 0;
            right: -100%;
            width: 100%;
            height: 100vh;
            background: #1e1e1e;
            display: flex;
            flex-direction: column;
            transition: right 0.3s ease;
            z-index: 100000;
        }
        #marginalia-chat.open { right: 0; }
        #marginalia-chat-resize {
            position: absolute;
            left: 0;
            top: 0;
            width: 12px;
            height: 100%;
            cursor: col-resize;
            z-index: 1;
            touch-action: none;
        }
        #marginalia-chat-resize::after {
            content: "";
            position: absolute;
            left: 4px;
            top: 50%;
            transform: translateY(-50%);
            width: 3px;
            height: 40px;
            background: #555;
            border-radius: 2px;
        }
        @media (min-width: 768px) {
            #marginalia-chat { width: 400px; right: -100%; }
            #marginalia-chat.open { right: 0; }
        }
        #marginalia-chat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #222;
            color: #e0e0e0;
            font-weight: 600;
        }
        #marginalia-chat-header-right {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #marginalia-chat-clear,
        #marginalia-chat-compact {
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
        #marginalia-chat-compact:hover {
            border-color: #888;
            color: #e0e0e0;
        }
        #marginalia-font-size {
            display: flex;
            gap: 2px;
        }
        .marginalia-font-btn {
            background: #333;
            border: 1px solid #444;
            color: #999;
            width: 26px;
            height: 26px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            padding: 0;
        }
        .marginalia-font-btn.active {
            background: #4a9eff;
            border-color: #4a9eff;
            color: white;
        }
        #marginalia-context-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 16px;
            background: #191919;
            color: #888;
            font-size: 12px;
            font-family: monospace;
            border-bottom: 1px solid #333;
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
        #marginalia-context-text {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        #marginalia-mono-btn,
        #marginalia-raw-btn {
            background: #333;
            border: 1px solid #444;
            color: #999;
            height: 26px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            padding: 0 6px;
        }
        #marginalia-mono-btn.active,
        #marginalia-raw-btn.active {
            background: #4a9eff;
            border-color: #4a9eff;
            color: white;
        }
        .marginalia-light #marginalia-mono-btn,
        .marginalia-light #marginalia-raw-btn { background: #ddd; border-color: #ccc; color: #666; }
        .marginalia-light #marginalia-mono-btn.active,
        .marginalia-light #marginalia-raw-btn.active { background: #4a9eff; border-color: #4a9eff; color: white; }
        #marginalia-chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        #marginalia-chat-messages.mono .marginalia-msg {
            font-family: "SF Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace;
        }
        .marginalia-msg {
            padding: 10px 14px;
            border-radius: 12px;
            max-width: 85%;
            font-size: 1em;
            line-height: 1.5;
            color: #e0e0e0;
        }
        .marginalia-msg.user {
            white-space: pre-wrap;
            background: #4a9eff;
            color: white;
            align-self: flex-end;
        }
        .marginalia-msg.assistant {
            background: #2a2a2a;
            align-self: flex-start;
            position: relative;
        }
        .marginalia-copy-btn {
            position: absolute;
            top: 6px;
            right: 6px;
            background: #333;
            border: 1px solid #555;
            color: #999;
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 4px;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .marginalia-msg.assistant:hover .marginalia-copy-btn { opacity: 1; }
        .marginalia-msg.system {
            background: #1a2a1a;
            color: #8a8;
            align-self: center;
            font-size: 0.85em;
            font-style: italic;
            max-width: 95%;
        }
        .marginalia-msg.assistant p { margin: 0.4em 0; }
        .marginalia-msg.assistant p:first-child { margin-top: 0; }
        .marginalia-msg.assistant p:last-child { margin-bottom: 0; }
        .marginalia-msg.assistant code {
            background: #1a1a1a;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 0.9em;
        }
        .marginalia-msg.assistant pre {
            background: #1a1a1a;
            padding: 8px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 0.4em 0;
        }
        .marginalia-msg.assistant pre code { background: none; padding: 0; }
        .marginalia-msg.assistant strong { color: #fff; }
        .marginalia-msg.assistant h3, .marginalia-msg.assistant h4 {
            margin: 0.6em 0 0.3em;
            color: #fff;
        }
        .marginalia-msg.assistant ul, .marginalia-msg.assistant ol {
            padding-left: 1.3em;
            margin: 0.3em 0;
        }
        .marginalia-msg .katex-display { margin: 0.5em 0; overflow-x: auto; }
        .marginalia-msg .katex { font-size: 1em; }
        .marginalia-msg.assistant table {
            border-collapse: collapse;
            margin: 0.4em 0;
            font-size: 0.9em;
            width: 100%;
            overflow-x: auto;
            display: block;
        }
        .marginalia-msg.assistant th,
        .marginalia-msg.assistant td {
            border: 1px solid #555;
            padding: 6px 10px;
            text-align: left;
        }
        .marginalia-msg.assistant th {
            background: #333;
            color: #fff;
            font-weight: 600;
        }
        .marginalia-msg.assistant tr:nth-child(even) td { background: #2a2a2a; }
        .marginalia-light .marginalia-msg.assistant th { background: #d0d0d0; color: #111; }
        .marginalia-light .marginalia-msg.assistant td { border-color: #bbb; }
        .marginalia-light .marginalia-msg.assistant tr:nth-child(even) td { background: #e8e8e8; }
        .thinking-dots span {
            animation: blink 1.4s infinite;
            opacity: 0;
        }
        .thinking-dots span:nth-child(1) { animation-delay: 0s; }
        .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
        .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes blink { 0%, 80%, 100% { opacity: 0; } 40% { opacity: 1; } }
        #marginalia-chat-send:disabled,
        #marginalia-chat-input:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        #marginalia-chat-stats {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 16px;
            background: #191919;
            color: #666;
            font-size: 11px;
            font-family: monospace;
            border-top: 1px solid #333;
        }
        #marginalia-stats-bar {
            flex-shrink: 0;
            width: 40px;
            height: 4px;
            background: #333;
            border-radius: 2px;
            overflow: hidden;
        }
        #marginalia-stats-fill {
            height: 100%;
            border-radius: 2px;
            transition: width 0.3s ease, background 0.3s ease;
            width: 0%;
        }
        .marginalia-stats-text {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .marginalia-model-name {
            cursor: pointer;
            color: #4a9eff;
            text-decoration: underline;
            text-decoration-style: dotted;
        }
        .marginalia-model-name:hover {
            color: #6ab4ff;
        }
        #marginalia-chat-input-area {
            display: flex;
            gap: 8px;
            padding: 10px 12px;
            background: #222;
        }
        #marginalia-chat-input {
            flex: 1;
            background: #333;
            color: #e0e0e0;
            border: none;
            border-radius: 8px;
            padding: 10px;
            font-size: 14px;
            resize: none;
            min-height: 44px;
            max-height: 120px;
            font-family: inherit;
        }
        #marginalia-chat-send {
            background: #4a9eff;
            color: white;
            border: none;
            border-radius: 8px;
            padding: 10px 16px;
            cursor: pointer;
            font-size: 14px;
        }
        /* Light theme overrides */
        .marginalia-light { background: #f5f5f5 !important; }
        .marginalia-light #marginalia-chat-header { background: #e8e8e8; color: #333; }
        .marginalia-light #marginalia-chat-close { color: #333; }
        .marginalia-light #marginalia-chat-clear,
        .marginalia-light #marginalia-chat-compact { border-color: #ccc; color: #666; }
        .marginalia-light .marginalia-font-btn { background: #ddd; border-color: #ccc; color: #666; }
        .marginalia-light .marginalia-font-btn.active { background: #4a9eff; border-color: #4a9eff; color: white; }
        .marginalia-light #marginalia-context-bar { background: #eee; color: #666; border-color: #ddd; }
        .marginalia-light #marginalia-context-progress { background: #ccc; }
        .marginalia-light #marginalia-chat-messages { background: #f5f5f5; }
        .marginalia-light .marginalia-msg { color: #333; }
        .marginalia-light .marginalia-msg.assistant { background: #e0e0e0; }
        .marginalia-light .marginalia-msg.system { background: #e0f0e0; color: #585; }
        .marginalia-light .marginalia-msg.assistant code { background: #d0d0d0; }
        .marginalia-light .marginalia-msg.assistant pre { background: #d0d0d0; }
        .marginalia-light .marginalia-msg.assistant strong { color: #111; }
        .marginalia-light .marginalia-msg.assistant h3,
        .marginalia-light .marginalia-msg.assistant h4 { color: #111; }
        .marginalia-light .marginalia-copy-btn { background: #ddd; border-color: #bbb; color: #666; }
        .marginalia-light #marginalia-chat-stats { background: #eee; color: #888; border-color: #ddd; }
        .marginalia-light #marginalia-stats-bar { background: #ccc; }
        .marginalia-light #marginalia-chat-input-area { background: #e8e8e8; }
        .marginalia-light #marginalia-chat-input { background: #fff; color: #333; }
    `;
    document.head.appendChild(style);
}

// --- Chat logic ---

let chatMessages = [];
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
        // Try exact match first, then prefix match (alias like "anthropic/claude-sonnet-4" -> resolved ID)
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

    // Clickable model name
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

function clearChat() {
    if (chatMessages.length === 0) return;
    if (!confirm("Clear chat history for this book?")) return;
    chatMessages = [];
    chatStats = { inputTokens: 0, outputTokens: 0, cost: 0, lastContextTokens: 0, model: "" };
    saveChatState();
    renderChat();
    renderStats();
}

async function compactChat() {
    if (chatMessages.length < 4) return; // nothing worth compacting

    const s = getSettings();
    if (!s.apiKey) return;

    // Show a system message while compacting
    chatMessages.push({ role: "system", content: "Compacting conversation..." });
    renderChat();

    const compactPrompt = [
        { role: "system", content: "Summarize the following conversation between a user and an AI reading assistant into a concise recap. Preserve key facts, conclusions, and any important context. Write it as a single paragraph addressed to an AI that will continue the conversation. Start with 'Previous conversation summary:'" },
        ...chatMessages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content })),
    ];

    try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${getSettings().apiKey}`,
            },
            body: JSON.stringify({ model: getChatModel(), messages: compactPrompt }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        const summary = data.choices?.[0]?.message?.content || "";
        if (!summary) throw new Error("Empty summary");

        if (data.usage) {
            chatStats.inputTokens += data.usage.prompt_tokens || 0;
            chatStats.outputTokens += data.usage.completion_tokens || 0;
            chatStats.cost += data.usage.cost || 0;
        }

        // Replace entire history with the summary as a single assistant message
        chatMessages = [
            { role: "assistant", content: summary },
            { role: "system", content: `Conversation compacted (${fmtTokens(chatStats.inputTokens + chatStats.outputTokens)} tokens saved)` },
        ];
    } catch (err) {
        // Remove the "compacting..." message
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
    const app = window.PDFViewerApplication;
    const page = app?.page || 1;
    const totalPages = app?.pagesCount || 1;
    const title = document.title.replace(" - Marginalia", "");
    const selection = window.getSelection()?.toString().trim() || "";
    const time = new Date().toLocaleString();

    let pageText = "";
    try {
        const pdfPage = await app.pdfDocument.getPage(page);
        const content = await pdfPage.getTextContent();
        pageText = content.items.map(item => item.str).join(" ");
    } catch {}

    return { page, totalPages, title, selection, time, pageText };
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

    const apiMessages = buildMessages(context, chatMessages);

    try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${s.apiKey}`,
            },
            body: JSON.stringify({
                model: s.model,
                messages: apiMessages,
                stream: true,
            }),
        });

        // Check for non-streaming error response
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const data = await res.json();
            chatMessages.push({ role: "assistant", content: `Error: ${data.error?.message || "Unknown error"}` });
            hideThinking();
            setSending(false);
            saveChatState();
            renderChat();
            return;
        }

        // Streaming SSE
        hideThinking();
        chatMessages.push({ role: "assistant", content: "" });
        const msgEl = createMsgEl(chatMessages[chatMessages.length - 1]);
        document.getElementById("marginalia-chat-messages").appendChild(msgEl);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop(); // keep incomplete line in buffer

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") continue;
                try {
                    const chunk = JSON.parse(payload);
                    const delta = chunk.choices?.[0]?.delta?.content;
                    if (delta) {
                        chatMessages[chatMessages.length - 1].content += delta;
                        msgEl.innerHTML = renderMarkdown(chatMessages[chatMessages.length - 1].content);
                        // Re-add copy button
                        msgEl.dataset.raw = chatMessages[chatMessages.length - 1].content;
                        const el = document.getElementById("marginalia-chat-messages");
                        el.scrollTop = el.scrollHeight;
                    }
                    if (chunk.usage) {
                        chatStats.inputTokens += chunk.usage.prompt_tokens || 0;
                        chatStats.outputTokens += chunk.usage.completion_tokens || 0;
                        chatStats.cost += chunk.usage.cost || 0;
                        chatStats.lastContextTokens = chunk.usage.prompt_tokens || 0;
                    }
                    if (chunk.model) {
                        chatStats.model = chunk.model;
                        fetchContextLimit(chunk.model);
                    }
                } catch {}
            }
        }

        // Add copy button to the final message
        const copyBtn = document.createElement("button");
        copyBtn.className = "marginalia-copy-btn";
        copyBtn.textContent = "Copy";
        copyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(msgEl.dataset.raw).catch(() => {});
            copyBtn.textContent = "Copied";
            setTimeout(() => copyBtn.textContent = "Copy", 1500);
        });
        msgEl.appendChild(copyBtn);

        renderStats();
    } catch (err) {
        chatMessages.push({ role: "assistant", content: `Error: ${err.message}` });
    }
    hideThinking();
    setSending(false);
    saveChatState();
    renderChat();
}

function buildMessages(context, messages) {
    const system = renderPrompt(SYSTEM_PROMPT, context);
    return [
        { role: "system", content: system },
        // Filter out local "system" messages (UI-only, not sent to API)
        ...messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content })),
    ];
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

function init() {
    loadChatState();
    fetchContextLimit(chatStats.model || getChatModel());
    injectUI();
    applyTheme();
    loadPdfFromDB();
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
