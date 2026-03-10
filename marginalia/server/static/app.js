import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs";

// State
let pdfDoc = null;
let currentPage = 1;
let chatMessages = [];

// Elements
const libraryView = document.getElementById("library");
const readerView = document.getElementById("reader");
const bookList = document.getElementById("book-list");
const uploadInput = document.getElementById("upload-input");
const canvas = document.getElementById("pdf-canvas");
const ctx = canvas.getContext("2d");
const pageInfo = document.getElementById("page-info");
const readerTitle = document.getElementById("reader-title");
const chatPanel = document.getElementById("chat-panel");
const chatMessagesEl = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");

// Navigation
document.getElementById("btn-back").addEventListener("click", showLibrary);
document.getElementById("btn-prev").addEventListener("click", () => goToPage(currentPage - 1));
document.getElementById("btn-next").addEventListener("click", () => goToPage(currentPage + 1));
document.getElementById("btn-chat").addEventListener("click", () => chatPanel.classList.add("open"));
document.getElementById("btn-close-chat").addEventListener("click", () => chatPanel.classList.remove("open"));
document.getElementById("btn-send").addEventListener("click", sendMessage);

chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

uploadInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    await fetch("/api/books", { method: "POST", body: form });
    uploadInput.value = "";
    loadBooks();
});

// Book list
async function loadBooks() {
    const res = await fetch("/api/books");
    const books = await res.json();
    bookList.innerHTML = "";
    for (const book of books) {
        const el = document.createElement("div");
        el.className = "book-item";
        const sizeMB = (book.size_bytes / 1048576).toFixed(1);
        el.innerHTML = `<span class="book-title">${book.title}</span><span class="book-size">${sizeMB} MB</span>`;
        el.addEventListener("click", () => openBook(book));
        bookList.appendChild(el);
    }
}

async function openBook(book) {
    readerTitle.textContent = book.title;
    libraryView.classList.remove("active");
    readerView.classList.add("active");
    chatMessages = [];
    renderChat();

    const url = `/api/books/${book.id}/file`;
    pdfDoc = await pdfjsLib.getDocument(url).promise;
    currentPage = 1;
    renderPage();
}

function showLibrary() {
    readerView.classList.remove("active");
    chatPanel.classList.remove("open");
    libraryView.classList.add("active");
    pdfDoc = null;
    loadBooks();
}

// PDF rendering
async function renderPage() {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(currentPage);
    const containerWidth = document.getElementById("pdf-container").clientWidth;
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    pageInfo.textContent = `${currentPage} / ${pdfDoc.numPages}`;
}

function goToPage(num) {
    if (!pdfDoc || num < 1 || num > pdfDoc.numPages) return;
    currentPage = num;
    renderPage();
}

// Chat
function renderChat() {
    chatMessagesEl.innerHTML = "";
    for (const msg of chatMessages) {
        const el = document.createElement("div");
        el.className = `msg ${msg.role}`;
        el.textContent = msg.content;
        chatMessagesEl.appendChild(el);
    }
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    chatMessages.push({ role: "user", content: text });
    chatInput.value = "";
    renderChat();

    const systemPrompt = `You are a helpful math tutor. The user is reading a PDF book and is currently on page ${currentPage}. Help them understand the content. Use clear explanations. When writing math, use Unicode symbols where possible.`;

    const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
            system_prompt: systemPrompt,
        }),
    });
    const data = await res.json();
    chatMessages.push({ role: "assistant", content: data.response || "No response." });
    renderChat();
}

// Init
loadBooks();
