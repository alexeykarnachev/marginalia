const MARGINALIA_VERSION = 56;

// Marginalia — library data layer
// In browser: backed by IndexedDB. In tests: backed by in-memory store.
//
// Data model:
//   Book:   { id, title, filename, data, size, folder_id? }
//   Folder: { id, name, parent_id? }

// --- Storage backend (swappable for tests) ---

const _db = {
    // Default: IndexedDB backend. Tests override these with in-memory implementations.
    _backend: null,

    async _idb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open("marginalia", 2);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("books")) {
                    db.createObjectStore("books", { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains("folders")) {
                    db.createObjectStore("folders", { keyPath: "id" });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    async _idbGetAll(store) {
        const db = await this._idb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readonly");
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    async _idbGet(store, id) {
        const db = await this._idb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readonly");
            const req = tx.objectStore(store).get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    async _idbPut(store, obj) {
        const db = await this._idb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).put(obj);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async _idbDelete(store, id) {
        const db = await this._idb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
};

// --- Public API (tools and app code call these) ---

async function getAllBooks() {
    if (_db._backend) return _db._backend.getAllBooks();
    return _db._idbGetAll("books");
}

async function getBook(id) {
    if (_db._backend) return _db._backend.getBook(id);
    return _db._idbGet("books", id);
}

async function saveBook(book) {
    if (_db._backend) return _db._backend.saveBook(book);
    return _db._idbPut("books", book);
}

async function deleteBook(id) {
    if (_db._backend) return _db._backend.deleteBook(id);
    return _db._idbDelete("books", id);
}

async function getAllFolders() {
    if (_db._backend) return _db._backend.getAllFolders();
    return _db._idbGetAll("folders");
}

async function getFolder(id) {
    if (_db._backend) return _db._backend.getFolder(id);
    return _db._idbGet("folders", id);
}

async function saveFolder(folder) {
    if (_db._backend) return _db._backend.saveFolder(folder);
    return _db._idbPut("folders", folder);
}

async function deleteFolder(id) {
    if (_db._backend) return _db._backend.deleteFolder(id);
    return _db._idbDelete("folders", id);
}

// --- In-memory backend (for tests and Node.js) ---

function createMemoryBackend() {
    const books = new Map();
    const folders = new Map();

    return {
        // Books
        getAllBooks: async () => [...books.values()],
        getBook: async (id) => books.get(id) || null,
        saveBook: async (book) => { books.set(book.id, { ...book }); },
        deleteBook: async (id) => { books.delete(id); },

        // Folders
        getAllFolders: async () => [...folders.values()],
        getFolder: async (id) => folders.get(id) || null,
        saveFolder: async (folder) => { folders.set(folder.id, { ...folder }); },
        deleteFolder: async (id) => { folders.delete(id); },

        // Test helpers
        _books: books,
        _folders: folders,
    };
}

function setBackend(backend) {
    _db._backend = backend;
}
