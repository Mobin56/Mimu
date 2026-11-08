import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.core.config import settings


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "mimu_data_dir", tmp_path)
    monkeypatch.setattr(settings, "openai_api_key", "")
    with TestClient(main.app) as test_client:
        yield test_client


def test_health_and_memory_crud_use_local_database(client):
    assert client.get("/api/health").json()["memory"] == "ok"

    created = client.post("/api/memories", json={"content": "I prefer concise replies."})
    assert created.status_code == 200
    memory = created.json()
    assert memory["content"] == "I prefer concise replies."
    assert client.get("/api/memories").json() == [memory]

    assert client.delete("/api/memories/" + str(memory["id"])).json() == {"deleted": True}
    assert client.get("/api/memories").json() == []


def test_chat_reports_missing_key_without_saving_a_fake_reply(client):
    response = client.post(
        "/api/chat",
        json={"conversation_id": "test-conversation", "message": "Hello MiMu"},
    )

    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.json()["detail"]
    assert client.get("/api/conversations").json() == []


def test_text_chat_persists_provider_response(client, monkeypatch):
    async def provider_reply(_messages):
        yield "Hello!"
        yield " How can I help?"

    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(main, "stream_reply", provider_reply)

    response = client.post(
        "/api/chat",
        json={"conversation_id": "test-conversation", "message": "Hello MiMu"},
    )

    assert response.status_code == 200
    events = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert "".join(event.get("content", "") for event in events) == "Hello! How can I help?"
    assert events[-1]["type"] == "done"
    history = client.get("/api/conversations/test-conversation").json()
    assert [message["role"] for message in history["messages"]] == ["user", "assistant"]


def test_stream_failure_is_reported_and_partial_reply_is_not_saved(client, monkeypatch):
    async def failing_reply(_messages):
        yield "partial"
        raise main.AIProviderError("provider unavailable")

    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(main, "stream_reply", failing_reply)

    response = client.post(
        "/api/chat",
        json={"conversation_id": "failed-stream", "message": "Hello MiMu"},
    )

    events = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert events[-1] == {"type": "error", "detail": "provider unavailable"}
    assert client.get("/api/conversations").json() == []


def test_automation_requires_opt_in_and_explicit_confirmation(client, monkeypatch):
    monkeypatch.setattr(main, "execute_action", lambda *_args: pytest.fail("must not execute"))
    request = {"action_type": "app", "target": "Terminal", "confirmed": True}

    assert client.post("/api/automation/execute", json=request).status_code == 403
    client.put("/api/settings/automation", json={"enabled": True})
    request["confirmed"] = False
    assert client.post("/api/automation/execute", json=request).status_code == 400


def test_remote_backend_cannot_enable_mac_automation(client, monkeypatch):
    monkeypatch.setattr(main.platform, "system", lambda: "Linux")

    response = client.put("/api/settings/automation", json={"enabled": True})

    assert response.status_code == 400
    assert "locally on macOS" in response.json()["detail"]
    assert client.get("/api/settings").json()["automation_enabled"] is False
    assert client.get("/api/diagnostics").json()["automation"] == "unavailable"


def test_confirmed_automation_is_logged_in_chat_history(client, monkeypatch):
    monkeypatch.setattr(main, "execute_action", lambda *_args: None)
    client.put("/api/settings/automation", json={"enabled": True})

    response = client.post(
        "/api/automation/execute",
        json={
            "action_type": "app",
            "target": "VS Code",
            "confirmed": True,
            "conversation_id": "automation-conversation",
            "user_message": "Open VS Code",
        },
    )

    assert response.status_code == 200
    assert response.json()["reply"] == "Opened Visual Studio Code."
    history = client.get("/api/conversations/automation-conversation").json()
    assert [message["content"] for message in history["messages"]] == [
        "Open VS Code",
        "Opened Visual Studio Code.",
    ]
    assert client.get("/api/actions").json()[0]["status"] == "completed"
