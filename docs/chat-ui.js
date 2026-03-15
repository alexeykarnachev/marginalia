// chat-ui.js — shared chat panel for Marginalia (library + viewer)
// Loaded after: db.js, tools.js, agent.js, marked, katex

/**
 * initChat(containerId, options) -> ChatInstance
 *
 * options:
 *   placeholder       — textarea placeholder text
 *   onOpen()          — called when chat opens
 *   onClose()         — called when chat closes
 *   getSystemPrompt() — async, returns system prompt string
 *   getMessages()     — returns message array (for external persistence)
 *   setMessages(msgs) — sets message array (for external persistence)
 *   getSummary()      — returns summary string (for compaction)
 *   setSummary(s)     — sets summary string
 *   getModel()        — returns model ID
 *   onSendDone()      — called after a send completes (for refreshing UI, etc.)
 *   onUsage(usage, model) — called with token usage info
 *   extraMenuItems    — array of { id, label, onClick } for overflow menu
 *   persistKey        — localStorage key prefix for width; null = don't persist
 *   resizeContainer   — element that gets "chatResizing" class during drag
 *   cssWidthVar       — CSS custom property name to set panel width on (e.g. "--chat-panel-width")
 *   pageNavEnabled    — if true, render [p.N] links and handle clicks
 *   onPageNav(page)   — called when user clicks a page link
 *   buildApiMessages(system, messages, summary) — optional, transforms messages before API call
 */

function initChat(containerId, options) {
    const container = document.getElementById(containerId);
    if (!container) { console.error("initChat: container not found:", containerId); return null; }

    const opts = Object.assign({
        placeholder: "Ask something...",
        onOpen: null,
        onClose: null,
        getSystemPrompt: async () => "You are a helpful assistant.",
        getMessages: () => [],
        setMessages: () => {},
        getSummary: () => null,
        setSummary: () => {},
        getModel: () => getSettings().model,
        onSendDone: null,
        onUsage: null,
        extraMenuItems: [],
        persistKey: null,
        resizeContainer: null,
        cssWidthVar: null,
        pageNavEnabled: false,
        onPageNav: null,
        buildApiMessages: null,
        onClear: null,
    }, options);

    // Unique prefix for element IDs (based on container ID)
    const p = containerId;

    // --- Inject HTML ---
    container.innerHTML = `
        <div class="chat-resize-handle" id="${p}-resize"></div>
        <div class="m-chat-header">
            <span>Chat</span>
            <div class="m-chat-header-right">
                <button class="m-chat-header-btn" id="${p}-menu-btn" title="More">&#x22EF;</button>
                <button class="m-chat-header-btn" id="${p}-close" title="Close">&#x2715;</button>
            </div>
        </div>
        <div class="marginalia-popover hidden" id="${p}-overflow-menu"></div>
        <div class="m-chat-messages" id="${p}-messages"></div>
        <div class="m-chat-input-area">
            <textarea class="m-chat-input" id="${p}-input" placeholder="${_escAttr(opts.placeholder)}"></textarea>
            <button class="m-chat-send" id="${p}-send">Send</button>
        </div>
    `;

    // --- Build overflow menu items ---
    const menuEl = document.getElementById(`${p}-overflow-menu`);
    const menuItems = [];
    for (const item of opts.extraMenuItems) {
        const btn = document.createElement("button");
        btn.className = "menu-item" + (item.danger ? " menu-item-danger" : "");
        btn.id = `${p}-menu-${item.id}`;
        btn.textContent = item.label;
        btn.addEventListener("click", () => { item.onClick(); _closeMenu(); });
        menuEl.appendChild(btn);
        menuItems.push(btn);
    }
    // Divider before Clear if there are extra items
    if (opts.extraMenuItems.length > 0) {
        const hr = document.createElement("hr");
        hr.className = "popover-divider";
        menuEl.appendChild(hr);
    }
    const clearBtn = document.createElement("button");
    clearBtn.className = "menu-item menu-item-danger";
    clearBtn.id = `${p}-menu-clear`;
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
        if (opts.onClear) { opts.onClear(); } else { _clearChat(); }
        _closeMenu();
    });
    menuEl.appendChild(clearBtn);

    // --- Element refs ---
    const inputEl = document.getElementById(`${p}-input`);
    const sendBtnEl = document.getElementById(`${p}-send`);
    const messagesEl = document.getElementById(`${p}-messages`);
    const menuBtnEl = document.getElementById(`${p}-menu-btn`);
    const closeBtnEl = document.getElementById(`${p}-close`);

    // --- State ---
    let sending = false;
    let toolActivity = [];

    // --- Helpers ---

    function _escAttr(s) { return s.replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

    function _closeMenu() { menuEl.classList.add("hidden"); }

    function _messages() { return opts.getMessages(); }

    // --- Rendering ---

    function _renderMarkdown(text) {
        const blocks = [];
        const inlines = [];
        const pageLinks = [];

        let result = text;

        // Protect [p.N] page links from markdown parser
        if (opts.pageNavEnabled) {
            result = result.replace(/\[p\.(\d+(?:[-\u2013]\d+)?)\]/g, (m) => {
                const id = `%%PAGE${pageLinks.length}%%`;
                pageLinks.push(m);
                return id;
            });
        }

        // Protect LaTeX blocks
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

        // Strip UUIDs from display
        result = result.replace(/\s*\(id:\s*`?[0-9a-f-]{36}`?\)/gi, "");
        result = result.replace(/\bid:\s*`[0-9a-f-]{36}`/gi, "");
        result = result.replace(/`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`/g, "");
        result = result.replace(/,?\s*id:\s*[^\s,)]+/gi, "");
        result = result.replace(/,\s*\)/g, ")");
        result = result.replace(/\(\s*\)/g, "");

        // Restore [p.N] page links
        if (opts.pageNavEnabled) {
            pageLinks.forEach((pl, i) => { result = result.replace(`%%PAGE${i}%%`, pl); });

            // Clickable page links
            result = result.replace(/\[p\.(\d+)[-\u2013](\d+)\]/g, '<a class="marginalia-page-link" data-page="$1" href="#">p.$1-$2</a>');
            result = result.replace(/\[p\.(\d+)\]/g, '<a class="marginalia-page-link" data-page="$1" href="#">p.$1</a>');

            // Fallback patterns
            const _pl = (m, pre, n) => `${pre}<a class="marginalia-page-link" data-page="${n}" href="#">${n}</a>`;
            result = result.replace(/\b(p\.)(\d+)\b/g, _pl);
            result = result.replace(/\b(pp?\.\s*)(\d+)\b/g, _pl);
            result = result.replace(/\b(page\s+)(\d+)\b/gi, _pl);
            result = result.replace(/\b(pages?\s+)(\d+)\b/gi, _pl);
            result = result.replace(/(стр\.\s*)(\d+)/g, _pl);
            result = result.replace(/(с\.\s+)(\d+)/g, _pl);
            result = result.replace(/(страниц[а-яё]*\s+)(\d+)/gi, _pl);
        }

        return result;
    }

    function _createMsgEl(msg) {
        const div = document.createElement("div");
        div.className = `marginalia-msg ${msg.role}`;
        if (msg.role === "assistant") {
            div.innerHTML = _renderMarkdown(msg.content);
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

    function renderChat() {
        messagesEl.innerHTML = "";
        for (const msg of _messages()) {
            if (msg.role === "tool") continue;
            messagesEl.appendChild(_createMsgEl(msg));
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // --- Thinking indicator ---

    function _showThinking() {
        const div = document.createElement("div");
        div.className = "marginalia-msg assistant marginalia-thinking";
        div.innerHTML = '<span class="thinking-dots">Thinking<span>.</span><span>.</span><span>.</span></span>';
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function _hideThinking() {
        messagesEl.querySelectorAll(".marginalia-thinking").forEach(el => el.remove());
    }

    // --- Tool activity display ---

    function _humanizeToolAction(name, args) {
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

    function _showToolActivity(name, args) {
        toolActivity.push(_humanizeToolAction(name, args));
        let actEl = document.getElementById(`${p}-tool-activity`);
        if (!actEl) {
            actEl = document.createElement("div");
            actEl.id = `${p}-tool-activity`;
            actEl.className = "marginalia-msg tool-activity";
            messagesEl.appendChild(actEl);
        }
        actEl.textContent = toolActivity.join("\n");
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function _clearToolActivity() {
        const actEl = document.getElementById(`${p}-tool-activity`);
        if (actEl) actEl.remove();
    }

    function _finalizeToolActivity() {
        _clearToolActivity();
        if (toolActivity.length > 0) {
            const summary = toolActivity.length <= 2
                ? toolActivity.join(" \u2192 ")
                : `${toolActivity[0]} \u2192 ... \u2192 ${toolActivity[toolActivity.length - 1]} (${toolActivity.length} steps)`;
            _messages().push({ role: "system", content: summary });
        }
        toolActivity = [];
    }

    // --- Send/receive ---

    function _setSending(val) {
        sending = val;
        sendBtnEl.disabled = val;
        inputEl.disabled = val;
        if (!val && sendBtnEl._wasSending) {
            sendBtnEl.textContent = "\u2713";
            sendBtnEl.classList.add("done");
            setTimeout(() => { sendBtnEl.textContent = "Send"; sendBtnEl.classList.remove("done"); }, 1500);
        }
        sendBtnEl._wasSending = val;
        if (!val) inputEl.focus();
    }

    async function sendMessage() {
        const text = inputEl.value.trim();
        if (!text || sending) return;

        const s = getSettings();
        if (!s.apiKey) {
            alert("Set your OpenRouter API key in Settings first.");
            return;
        }

        const messages = _messages();
        messages.push({ role: "user", content: text });
        inputEl.value = "";
        renderChat();
        _setSending(true);
        _showThinking();
        toolActivity = [];

        try {
            const system = await opts.getSystemPrompt();

            let apiMessages;
            if (opts.buildApiMessages) {
                apiMessages = opts.buildApiMessages(system, messages, opts.getSummary());
            } else {
                apiMessages = [
                    { role: "system", content: system },
                    ...messages.filter(m => m.role !== "system"),
                ];
            }

            let streamingMsgEl = null;

            const result = await agentLoop(s.apiKey, opts.getModel(), apiMessages, {
                onThinking: (iteration) => {
                    if (iteration > 0) _showThinking();
                },
                onDelta: (delta, fullContent) => {
                    if (!streamingMsgEl) {
                        _hideThinking();
                        _finalizeToolActivity();
                        renderChat();
                        messages.push({ role: "assistant", content: "" });
                        streamingMsgEl = _createMsgEl(messages[messages.length - 1]);
                        messagesEl.appendChild(streamingMsgEl);
                    }
                    messages[messages.length - 1].content = fullContent;
                    streamingMsgEl.innerHTML = _renderMarkdown(fullContent);
                    streamingMsgEl.dataset.raw = fullContent;
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                },
                onToolCall: (name, args) => {
                    _hideThinking();
                    _showToolActivity(name, args);
                },
                onToolResult: () => {},
                onUsage: (usage, model) => {
                    if (opts.onUsage) opts.onUsage(usage, model);
                },
            });

            _hideThinking();

            if (streamingMsgEl) {
                // Add copy button to final streamed message
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
                // No streaming happened
                if (result.content) {
                    messages.push({ role: "assistant", content: result.content });
                }
            }
        } catch (err) {
            _hideThinking();
            _finalizeToolActivity();
            messages.push({ role: "assistant", content: `Error: ${err.message}` });
        }

        _clearToolActivity();
        _setSending(false);
        opts.setMessages(messages);

        if (!document.querySelector(`#${p}-messages .marginalia-msg.assistant:last-child .marginalia-copy-btn`)) {
            renderChat();
        }

        if (opts.onSendDone) opts.onSendDone();
    }

    // --- Clear ---

    function _clearChat() {
        const messages = _messages();
        if (messages.length === 0) return;
        if (!confirm("Clear conversation?")) return;
        messages.length = 0;
        opts.setMessages(messages);
        opts.setSummary(null);
        renderChat();
    }

    // --- Resize ---

    (function initResize() {
        const handle = document.getElementById(`${p}-resize`);
        let startX = null, startW = null;

        function setWidth(w) {
            const clamped = Math.max(280, Math.min(w, window.innerWidth * 0.7));
            container.style.width = clamped + "px";
            if (opts.cssWidthVar) {
                document.documentElement.style.setProperty(opts.cssWidthVar, clamped + "px");
            }
        }

        function onMove(x) {
            if (startX == null) return;
            setWidth(startW + (startX - x));
        }

        function onDragEnd() {
            if (startX != null && opts.persistKey) {
                localStorage.setItem(opts.persistKey, container.offsetWidth);
            }
            if (startX != null && opts.resizeContainer) {
                opts.resizeContainer.classList.remove("chatResizing");
            }
            startX = null;
            document.body.style.userSelect = "";
            document.body.style.webkitUserSelect = "";
        }

        handle.addEventListener("mousedown", (e) => {
            e.preventDefault();
            startX = e.clientX; startW = container.offsetWidth;
            if (opts.resizeContainer) opts.resizeContainer.classList.add("chatResizing");
            document.body.style.userSelect = "none";
            document.body.style.webkitUserSelect = "none";
        });
        handle.addEventListener("touchstart", (e) => {
            e.preventDefault();
            startX = e.touches[0].clientX; startW = container.offsetWidth;
            if (opts.resizeContainer) opts.resizeContainer.classList.add("chatResizing");
        });
        document.addEventListener("mousemove", (e) => { if (startX != null) { e.preventDefault(); onMove(e.clientX); } });
        document.addEventListener("touchmove", (e) => { if (startX != null) onMove(e.touches[0].clientX); });
        document.addEventListener("mouseup", onDragEnd);
        document.addEventListener("touchend", onDragEnd);

        if (opts.persistKey) {
            const saved = localStorage.getItem(opts.persistKey);
            if (saved) setWidth(parseInt(saved));
        }
    })();

    // --- Event wiring ---

    closeBtnEl.addEventListener("click", () => { if (opts.onClose) opts.onClose(); });
    sendBtnEl.addEventListener("click", sendMessage);
    inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    menuBtnEl.addEventListener("click", () => { menuEl.classList.toggle("hidden"); });
    document.addEventListener("click", (e) => {
        if (!e.target.closest(`#${p}-menu-btn`) && !e.target.closest(`#${p}-overflow-menu`)) {
            _closeMenu();
        }
    });

    // Page link clicks
    if (opts.pageNavEnabled && opts.onPageNav) {
        messagesEl.addEventListener("click", (e) => {
            const link = e.target.closest(".marginalia-page-link");
            if (link) {
                e.preventDefault();
                const page = parseInt(link.dataset.page);
                if (page) opts.onPageNav(page);
            }
        });
    }

    // --- Public API ---
    const instance = {
        renderChat,
        sendMessage,
        getMessagesEl: () => messagesEl,
        getInputEl: () => inputEl,
        getSendBtn: () => sendBtnEl,
        getContainer: () => container,
        getMenuEl: () => menuEl,
    };

    return instance;
}
