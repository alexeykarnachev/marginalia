// Marginalia — library page logic
// Loaded after: db.js

// --- Elements ---

const libraryEl = document.getElementById("book-list");
const uploadInput = document.getElementById("upload-input");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsApiKey = document.getElementById("settings-api-key");
const settingsModel = document.getElementById("settings-model");
const settingsAutoCompact = document.getElementById("settings-auto-compact");
const settingsCompactThreshold = document.getElementById("settings-compact-threshold");

// --- Event wiring ---

document.getElementById("btn-settings").addEventListener("click", openSettings);
document.getElementById("btn-settings-save").addEventListener("click", onSettingsSave);
document.getElementById("btn-settings-cancel").addEventListener("click", () => settingsOverlay.classList.add("hidden"));
document.getElementById("btn-new-folder").addEventListener("click", onNewFolder);

uploadInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const uploadBtn = document.getElementById("btn-upload");
    const origText = uploadBtn.childNodes[0].textContent;
    uploadBtn.childNodes[0].textContent = "...";

    try {
        const data = await file.arrayBuffer();
        const id = crypto.randomUUID();

        await saveBook({
            id,
            title: file.name.replace(/\.pdf$/i, ""),
            filename: file.name,
            data,
            size: data.byteLength,
            pages: null, // indexed on first open in the viewer
            folder_id: currentFolderId,
        });
        uploadInput.value = "";
        renderLibrary();
    } catch (err) {
        console.error("Upload failed:", err);
    }
    uploadBtn.childNodes[0].textContent = origText;
});

// --- Settings ---

function openSettings() {
    const s = getSettings();
    settingsApiKey.value = s.apiKey;
    settingsModel.value = s.model;
    if (settingsAutoCompact) settingsAutoCompact.checked = localStorage.getItem("marginalia_auto_compact") !== "0";
    if (settingsCompactThreshold) settingsCompactThreshold.value = parseInt(localStorage.getItem("marginalia_compact_threshold")) || 50000;
    settingsOverlay.classList.remove("hidden");
}

function onSettingsSave() {
    saveSettings(settingsApiKey.value.trim(), settingsModel.value.trim());
    if (settingsAutoCompact) localStorage.setItem("marginalia_auto_compact", settingsAutoCompact.checked ? "1" : "0");
    if (settingsCompactThreshold) localStorage.setItem("marginalia_compact_threshold", settingsCompactThreshold.value);
    settingsOverlay.classList.add("hidden");
}

// --- Library tree rendering ---

let currentFolderId = null; // null = root

async function renderLibrary() {
    const books = await getAllBooks();
    const folders = await getAllFolders();
    libraryEl.innerHTML = "";

    // Breadcrumb
    const breadcrumb = document.createElement("div");
    breadcrumb.className = "library-breadcrumb";
    const crumbs = buildBreadcrumbs(currentFolderId, folders);
    for (let i = 0; i < crumbs.length; i++) {
        const crumb = crumbs[i];
        const span = document.createElement("span");
        span.textContent = crumb.name;
        span.className = "breadcrumb-item";
        if (i < crumbs.length - 1) {
            span.addEventListener("click", () => { currentFolderId = crumb.id; renderLibrary(); });
            span.classList.add("clickable");
        } else {
            span.classList.add("current");
        }
        breadcrumb.appendChild(span);
        if (i < crumbs.length - 1) {
            const sep = document.createElement("span");
            sep.textContent = " / ";
            sep.className = "breadcrumb-sep";
            breadcrumb.appendChild(sep);
        }
    }
    libraryEl.appendChild(breadcrumb);

    // Child folders
    const childFolders = folders.filter(f => (f.parent_id || null) === currentFolderId);
    for (const folder of childFolders) {
        const el = document.createElement("div");
        el.className = "library-item folder-item";
        el.innerHTML = `<span class="item-icon">📁</span><span class="item-title">${escapeHtml(folder.name)}</span>`;

        const actions = document.createElement("div");
        actions.className = "item-actions";
        actions.innerHTML = `<button class="item-btn" title="Rename">✏</button><button class="item-btn item-btn-danger" title="Delete">✕</button>`;
        el.appendChild(actions);

        el.addEventListener("click", (e) => {
            if (e.target.closest(".item-actions")) return;
            currentFolderId = folder.id;
            renderLibrary();
        });

        actions.children[0].addEventListener("click", async (e) => {
            e.stopPropagation();
            const name = prompt("Rename folder:", folder.name);
            if (name && name.trim()) {
                folder.name = name.trim();
                await saveFolder(folder);
                renderLibrary();
            }
        });

        actions.children[1].addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete folder "${folder.name}"? Books inside will move here.`)) return;
            // Move children up
            await _reparentFolderContents(folder.id, currentFolderId);
            await deleteFolder(folder.id);
            renderLibrary();
        });

        libraryEl.appendChild(el);
    }

    // Child books
    const childBooks = books.filter(b => (b.folder_id || null) === currentFolderId);
    for (const book of childBooks) {
        const el = document.createElement("div");
        el.className = "book-item";

        const sizeMB = (book.size / 1048576).toFixed(1);
        const pageCount = book.pages ? book.pages.length + "p" : (book.pages === null ? "..." : "");
        const meta = [pageCount, sizeMB + " MB"].filter(Boolean).join(" · ");

        // Cover
        const cover = document.createElement("div");
        cover.className = "book-cover";
        cover.innerHTML = `<span class="book-cover-placeholder">📄</span>`;
        el.appendChild(cover);

        // Render first page as cover thumbnail
        renderBookCover(book, cover);

        // Info
        const info = document.createElement("div");
        info.className = "book-info";
        info.innerHTML = `<span class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</span><span class="book-meta">${meta}</span>`;

        const actions = document.createElement("div");
        actions.className = "item-actions";

        // Move button (dropdown with folder targets)
        const moveBtn = document.createElement("button");
        moveBtn.className = "item-btn";
        moveBtn.title = "Move to folder";
        moveBtn.textContent = "→";
        moveBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await showMoveDialog(book, folders);
        });

        const renameBtn = document.createElement("button");
        renameBtn.className = "item-btn";
        renameBtn.title = "Rename";
        renameBtn.textContent = "✏";
        renameBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const name = prompt("Rename book:", book.title);
            if (name && name.trim()) {
                book.title = name.trim();
                await saveBook(book);
                renderLibrary();
            }
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "item-btn item-btn-danger";
        deleteBtn.title = "Delete";
        deleteBtn.textContent = "✕";
        deleteBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete "${book.title}"?`)) return;
            await deleteBook(book.id);
            deleteBookData(book.id);
            renderLibrary();
        });

        actions.appendChild(moveBtn);
        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);
        info.appendChild(actions);
        el.appendChild(info);

        el.addEventListener("click", (e) => {
            if (e.target.closest(".item-actions")) return;
            openBook(book.id);
        });

        libraryEl.appendChild(el);
    }

    // Empty state
    if (childFolders.length === 0 && childBooks.length === 0) {
        const empty = document.createElement("div");
        empty.className = "library-empty";
        empty.textContent = currentFolderId ? "This folder is empty" : "No books yet — upload a PDF to get started";
        libraryEl.appendChild(empty);
    }
}

function buildBreadcrumbs(folderId, folders) {
    const crumbs = [];
    let current = folderId;
    while (current) {
        const f = folders.find(f => f.id === current);
        if (!f) break;
        crumbs.unshift({ id: f.id, name: f.name });
        current = f.parent_id;
    }
    crumbs.unshift({ id: null, name: "Library" });
    return crumbs;
}

async function showMoveDialog(book, folders) {
    const target = prompt(
        "Move to folder (type folder name, or empty for root):\n" +
        "Folders: " + (folders.length ? folders.map(f => f.name).join(", ") : "(none)")
    );
    if (target === null) return; // cancelled
    if (target.trim() === "") {
        book.folder_id = null;
        await saveBook(book);
        renderLibrary();
        return;
    }
    const folder = folders.find(f => f.name.toLowerCase() === target.trim().toLowerCase());
    if (folder) {
        book.folder_id = folder.id;
        await saveBook(book);
        renderLibrary();
    } else {
        alert(`Folder "${target}" not found.`);
    }
}

async function onNewFolder() {
    const name = prompt("New folder name:");
    if (!name || !name.trim()) return;
    const id = crypto.randomUUID();
    await saveFolder({ id, name: name.trim(), parent_id: currentFolderId });
    renderLibrary();
}

function openBook(id) {
    sessionStorage.setItem("marginalia_book_id", id);
    window.location.href = "pdfjs/web/viewer.html?file=";
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// Cache covers in memory to avoid re-rendering on every renderLibrary call
const _coverCache = {};

async function renderBookCover(book, coverEl) {
    // Use cached image if available
    if (_coverCache[book.id]) {
        coverEl.innerHTML = "";
        const img = document.createElement("img");
        img.src = _coverCache[book.id];
        img.style.cssText = "width:100%;height:100%;object-fit:cover;";
        coverEl.appendChild(img);
        return;
    }

    // Wait for pdfjsLib to be available (module script loads after defer)
    if (typeof globalThis.pdfjsLib === "undefined") {
        let attempts = 0;
        while (typeof globalThis.pdfjsLib === "undefined" && attempts < 50) {
            await new Promise(r => setTimeout(r, 200));
            attempts++;
        }
    }
    if (typeof globalThis.pdfjsLib === "undefined") return;

    // Set worker path (pdf.mjs defaults to ./pdf.worker.mjs which is wrong from index.html)
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs/build/pdf.worker.mjs";
    }

    try {
        const blob = book.data instanceof Blob ? book.data : new Blob([book.data], { type: "application/pdf" });
        const buf = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        const page = await pdf.getPage(1);

        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement("canvas");
        // Render at 300px width for crisp covers
        const scale = 300 / viewport.width;
        canvas.width = Math.round(viewport.width * scale);
        canvas.height = Math.round(viewport.height * scale);

        await page.render({
            canvasContext: canvas.getContext("2d"),
            viewport: page.getViewport({ scale }),
        }).promise;

        // Cache as data URL and display as img (more reliable than canvas in grid)
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        _coverCache[book.id] = dataUrl;

        coverEl.innerHTML = "";
        const img = document.createElement("img");
        img.src = dataUrl;
        img.style.cssText = "width:100%;height:100%;object-fit:cover;";
        coverEl.appendChild(img);
    } catch (err) {
        console.warn("Cover render failed for", book.title, err);
    }
}

// --- Init ---

document.documentElement.dataset.theme = localStorage.getItem("marginalia_theme") || "dark";

const versionEl = document.getElementById("version-label");
if (versionEl) versionEl.textContent = "v" + MARGINALIA_VERSION;

renderLibrary().catch((e) => console.error("Failed to load library:", e));
