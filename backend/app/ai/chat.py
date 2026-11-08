import json
from typing import AsyncIterator, Dict, List

import httpx

from app.core.config import settings


class AIConfigurationError(Exception):
    pass


class AIProviderError(Exception):
    pass


async def stream_reply(messages: List[Dict[str, str]]) -> AsyncIterator[str]:
    if not settings.openai_api_key:
        raise AIConfigurationError("Add OPENAI_API_KEY to the project root .env file.")

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream(
                "POST",
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": "Bearer " + settings.openai_api_key},
                json={
                    "model": settings.openai_model,
                    "messages": messages,
                    "temperature": 0.7,
                    "stream": True,
                },
            ) as response:
                if response.is_error:
                    body = await response.aread()
                    try:
                        detail = json.loads(body).get("error", {}).get("message", "Unknown provider error")
                    except (ValueError, AttributeError):
                        detail = "The AI provider returned an unreadable error."
                    raise AIProviderError("OpenAI request failed: " + str(detail))

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        event = json.loads(payload)
                        if event.get("error"):
                            provider_error = event["error"]
                            detail = provider_error.get("message", "OpenAI stream failed.") if isinstance(provider_error, dict) else str(provider_error)
                            raise AIProviderError(str(detail))
                        delta = event["choices"][0]["delta"].get("content")
                    except AIProviderError:
                        raise
                    except (ValueError, KeyError, IndexError, TypeError) as exc:
                        raise AIProviderError("The AI provider returned an unexpected stream event.") from exc
                    if isinstance(delta, str) and delta:
                        yield delta
    except httpx.TimeoutException as exc:
        raise AIProviderError("The AI provider timed out. Please try again.") from exc
    except httpx.HTTPError as exc:
        raise AIProviderError("Could not connect to the AI provider.") from exc
