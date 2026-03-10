"""Shared logging configuration for scripts."""

import sys

from loguru import logger


def setup_logging(log_file: str) -> None:
    """Configure loguru with stderr + rotating file sinks."""
    logger.remove()
    logger.add(sys.stderr, level="INFO", format="{time:HH:mm:ss} | {level:<7} | {message}")
    logger.add(
        log_file,
        level="DEBUG",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level:<7} | {message}",
        rotation="10 MB",
    )
