"""Server interfaces and registry wiring."""

from typing import Protocol

from marginalia import registry


class IServer(Protocol):
    """Web server for the reader + chat UI."""

    def create_app(self) -> object: ...


registry.register(IServer, "marginalia.server.server.Server")
