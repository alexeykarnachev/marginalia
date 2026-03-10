"""Chat service interfaces and models."""

from dataclasses import dataclass
from enum import Enum
from typing import Protocol

from marginalia import registry


class Role(Enum):
    """Chat message role."""

    USER = "user"
    ASSISTANT = "assistant"


@dataclass
class Message:
    """A single chat message."""

    role: Role
    content: str


class IChatService(Protocol):
    """AI chat via OpenRouter."""

    async def complete(
        self,
        messages: list[Message],
        system_prompt: str | None = None,
    ) -> str | None:
        """Send messages and return the assistant's response text."""
        ...


registry.register(IChatService, "marginalia.chat.chat.ChatService")
