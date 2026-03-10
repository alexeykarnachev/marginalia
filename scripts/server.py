"""Server management CLI."""

import typer

app = typer.Typer()


@app.command()
def start(host: str = "0.0.0.0", port: int = 8000) -> None:
    """Start the marginalia server."""
    import uvicorn

    from marginalia.logging import setup_logging
    from marginalia.server.server import Server

    setup_logging("logs/server.log")
    server = Server()
    fastapi_app = server.create_app()
    uvicorn.run(fastapi_app, host=host, port=port)


if __name__ == "__main__":
    app()
