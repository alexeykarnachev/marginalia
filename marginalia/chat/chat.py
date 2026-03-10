"""OpenRouter chat service implementation via OpenAI SDK."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

import httpx
from loguru import logger
from openai import AsyncOpenAI

from marginalia.chat.api import IChatService, Message
from marginalia.env import settings

_MAX_OUTPUT_TOKENS = 16_000
_MAX_RETRIES = 3
_RETRY_DELAY_SECONDS = 5

_T = TypeVar("_T")


async def _retry(fn: Callable[[], Awaitable[_T | None]]) -> _T | None:
    """Call fn up to _MAX_RETRIES times with linear backoff."""
    for attempt in range(1, _MAX_RETRIES + 1):
        result = await fn()
        if result is not None:
            return result
        if attempt < _MAX_RETRIES:
            await asyncio.sleep(_RETRY_DELAY_SECONDS * attempt)
    return None


class ChatService(IChatService):
    def __init__(self) -> None:
        self._client = AsyncOpenAI(
            base_url=settings.openrouter_base_url,
            api_key=settings.openrouter_api_key,
            timeout=httpx.Timeout(120, connect=10),
        )
        self._model = settings.openrouter_model

    async def complete(
        self,
        messages: list[Message],
        system_prompt: str | None = None,
    ) -> str | None:
        api_messages: list[dict[str, str]] = []
        if system_prompt:
            api_messages.append({"role": "system", "content": system_prompt})
        for msg in messages:
            api_messages.append({"role": msg.role.value, "content": msg.content})

        async def attempt() -> str | None:
            try:
                completion = await self._client.chat.completions.create(
                    model=self._model,
                    messages=api_messages,  # type: ignore[arg-type]
                    max_completion_tokens=_MAX_OUTPUT_TOKENS,
                )
            except Exception as e:
                logger.warning("LLM API error: {}", e)
                return None

            if not completion.choices:
                logger.warning("LLM returned no choices")
                return None

            content = completion.choices[0].message.content
            if not content:
                logger.warning("Empty LLM response")
                return None

            return content

        return await _retry(attempt)
