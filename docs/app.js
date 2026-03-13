// --- IndexedDB helpers ---

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

async function getAllBooks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
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

async function saveBook(book) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(book);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function deleteBook(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- Settings ---

function getSettings() {
    return {
        apiKey: localStorage.getItem("openrouter_api_key") || "",
        model: localStorage.getItem("openrouter_model") || "anthropic/claude-sonnet-4",
    };
}

function saveSettings(apiKey, model) {
    localStorage.setItem("openrouter_api_key", apiKey);
    localStorage.setItem("openrouter_model", model);
}

// --- Elements ---

const bookList = document.getElementById("book-list");
const uploadInput = document.getElementById("upload-input");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsApiKey = document.getElementById("settings-api-key");
const settingsModel = document.getElementById("settings-model");

// --- Navigation ---

document.getElementById("btn-settings").addEventListener("click", openSettings);
document.getElementById("btn-settings-save").addEventListener("click", onSettingsSave);
document.getElementById("btn-settings-cancel").addEventListener("click", () => settingsOverlay.classList.add("hidden"));

uploadInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const id = crypto.randomUUID();
    await saveBook({
        id,
        title: file.name.replace(/\.pdf$/i, ""),
        filename: file.name,
        data,
        size: data.byteLength,
    });
    uploadInput.value = "";
    loadBooks();
});

// --- Settings ---

function openSettings() {
    const s = getSettings();
    settingsApiKey.value = s.apiKey;
    settingsModel.value = s.model;
    settingsOverlay.classList.remove("hidden");
}

function onSettingsSave() {
    saveSettings(settingsApiKey.value.trim(), settingsModel.value.trim());
    settingsOverlay.classList.add("hidden");
}

// --- Library ---

async function loadBooks() {
    const books = await getAllBooks();
    bookList.innerHTML = "";
    for (const book of books) {
        const el = document.createElement("div");
        el.className = "book-item";
        const sizeMB = (book.size / 1048576).toFixed(1);
        const titleSpan = document.createElement("span");
        titleSpan.className = "book-title";
        titleSpan.textContent = book.title;
        const right = document.createElement("div");
        right.className = "book-item-right";
        right.innerHTML = `<span class="book-size">${sizeMB} MB</span><button class="book-delete" title="Delete">&times;</button>`;
        el.appendChild(titleSpan);
        el.appendChild(right);
        el.addEventListener("click", () => openBook(book.id));
        el.querySelector(".book-delete").addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete "${book.title}"?`)) return;
            await deleteBook(book.id);
            localStorage.removeItem(`marginalia_chat_${book.id}`);
            localStorage.removeItem(`marginalia_stats_${book.id}`);
            localStorage.removeItem(`marginalia_model_${book.id}`);
            loadBooks();
        });
        bookList.appendChild(el);
    }
}

async function openBook(id) {
    // Store book ID for the viewer to pick up and load from IndexedDB
    sessionStorage.setItem("marginalia_book_id", id);
    window.location.href = "pdfjs/web/viewer.html?file=";
}

// --- Init ---

loadBooks().catch((e) => console.error("Failed to load books:", e));
