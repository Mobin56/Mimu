import json
from typing import AsyncIterator, Dict, List

import httpx

from app.core.config import settings


class AIConfigurationError(Exception):
    pass


class AIProviderError(Exception):
    pass


async def stream_reply(messages: List[Dict[str, str]]) -> AsyncIterator[str]:
    provider = settings.selected_ai_provider
    api_key = settings.selected_ai_api_key
    if provider not in ("openai", "gemini"):
        raise AIConfigurationError("Set AI_PROVIDER to either 'openai' or 'gemini'.")
    if not api_key:
        key_name = "GEMINI_API_KEY" if provider == "gemini" else "OPENAI_API_KEY"
        raise AIConfigurationError("Add " + key_name + " to the backend environment.")

    base_url = (
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        if provider == "gemini"
        else "https://api.openai.com/v1/chat/completions"
    )

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream(
                "POST",
                base_url,
                headers={"Authorization": "Bearer " + api_key},
                json={
                    "model": settings.selected_ai_model,
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
                    provider_name = "Gemini" if provider == "gemini" else "OpenAI"
                    raise AIProviderError(provider_name + " request failed: " + str(detail))

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
                            provider_name = "Gemini" if provider == "gemini" else "OpenAI"
                            detail = provider_error.get("message", provider_name + " stream failed.") if isinstance(provider_error, dict) else str(provider_error)
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
