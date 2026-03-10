"""FastAPI server implementation."""

import os
from pathlib import Path

from fastapi import FastAPI, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pydantic import BaseModel

from marginalia import registry
from marginalia.books.api import IBookStore
from marginalia.chat.api import IChatService, Message, Role
from marginalia.server.api import IServer

_THIS_DIR = Path(__file__).parent
_TEMPLATES_DIR = _THIS_DIR / "templates"
_STATIC_DIR = _THIS_DIR / "static"


class ChatRequest(BaseModel):
    messages: list[dict[str, str]]
    system_prompt: str | None = None


class Server(IServer):
    def create_app(self) -> FastAPI:
        app = FastAPI(title="Marginalia")
        app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")
        self._register_routes(app)
        return app

    def _register_routes(self, app: FastAPI) -> None:
        @app.get("/", response_class=HTMLResponse)
        async def index() -> str:
            index_path = _TEMPLATES_DIR / "index.html"
            return index_path.read_text()

        @app.get("/api/books")
        async def list_books() -> list[dict[str, object]]:
            store = registry.get(IBookStore)
            books = store.list_books()
            return [{"id": b.id, "title": b.title, "filename": b.filename, "size_bytes": b.size_bytes} for b in books]

        @app.post("/api/books")
        async def upload_book(file: UploadFile) -> dict[str, object]:
            store = registry.get(IBookStore)
            filename = file.filename or "unnamed.pdf"
            data = await file.read()
            book = store.add_book(filename, data)
            logger.info("Uploaded book: {} ({} bytes)", filename, len(data))
            return {"id": book.id, "title": book.title, "filename": book.filename}

        @app.get("/api/books/{book_id}/file")
        async def serve_book(book_id: str) -> FileResponse:
            store = registry.get(IBookStore)
            path = store.get_book_path(book_id)
            if path is None or not os.path.exists(path):
                return FileResponse(status_code=404)  # type: ignore[call-arg]
            return FileResponse(path, media_type="application/pdf")

        @app.delete("/api/books/{book_id}")
        async def delete_book(book_id: str) -> dict[str, bool]:
            store = registry.get(IBookStore)
            deleted = store.delete_book(book_id)
            return {"deleted": deleted}

        @app.post("/api/chat")
        async def chat(req: ChatRequest) -> dict[str, str | None]:
            svc = registry.get(IChatService)
            messages = [Message(role=Role(m["role"]), content=m["content"]) for m in req.messages]
            response = await svc.complete(messages, system_prompt=req.system_prompt)
            return {"response": response}
