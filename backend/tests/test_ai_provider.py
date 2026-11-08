import asyncio
import json

import httpx

from app.ai.chat import stream_reply
from app.core.config import settings


def test_gemini_provider_uses_compatibility_api_and_selected_key(monkeypatch):
    async def run_test():
        return [chunk async for chunk in stream_reply([{"role": "user", "content": "Hi"}])]

    received = {}
    stream_body = (
        'data: {"choices":[{"delta":{"content":"Hello from "}}]}\n\n'
        'data: {"choices":[{"delta":{"content":"Gemini."}}]}\n\n'
        "data: [DONE]\n\n"
    )

    async def handler(request):
        received["url"] = str(request.url)
        received["authorization"] = request.headers.get("authorization")
        received["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=stream_body,
        )

    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", "gemini-test-key")
    monkeypatch.setattr(settings, "gemini_model", "gemini-3.6-flash")
    async_client = httpx.AsyncClient
    monkeypatch.setattr(
        "app.ai.chat.httpx.AsyncClient",
        lambda **kwargs: async_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    chunks = asyncio.run(run_test())

    assert chunks == ["Hello from ", "Gemini."]
    assert received["url"] == (
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    )
    assert received["authorization"] == "Bearer gemini-test-key"
    assert received["payload"]["model"] == "gemini-3.6-flash"
    assert received["payload"]["stream"] is True
    assert "gemini-test-key" not in json.dumps(received["payload"])
