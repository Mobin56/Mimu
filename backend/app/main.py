import logging
import json
import platform
import subprocess
from contextlib import asynccontextmanager
from typing import AsyncIterator, List

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.ai.chat import AIConfigurationError, AIProviderError, stream_reply
from app.automation.macos import execute_action, normalize_action
from app.core.config import settings
from app.core.database import connection, initialize_database
from app.memory.store import relevant_context
from app.skills.catalog import SKILLS

logger = logging.getLogger("mimu")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    initialize_database()
    yield


app = FastAPI(title="MiMu AI", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(set(settings.frontend_origins + ["http://127.0.0.1:3000"])),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)


class ChatRequest(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=12000)


class MemoryRequest(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class AutomationSettings(BaseModel):
    enabled: bool


class AutomationRequest(BaseModel):
    action_type: str
    target: str = Field(min_length=1, max_length=2048)
    confirmed: bool
    conversation_id: str = Field(default="", max_length=80)
    user_message: str = Field(default="", max_length=12000)


class VoiceTranscriptRequest(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=80)
    role: str
    content: str = Field(min_length=1, max_length=12000)


def read_setting(key: str, default: str = "") -> str:
    with connection() as db:
        row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else default


def write_setting(key: str, value: str) -> None:
    with connection() as db:
        db.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


@app.get("/api/health")
def health() -> dict:
    try:
        with connection() as db:
            db.execute("SELECT 1")
    except Exception as exc:
        logger.exception("Database health check failed")
        raise HTTPException(status_code=503, detail="Local memory database is unavailable.") from exc
    return {"status": "ok", "memory": "ok", "platform": platform.system()}


@app.get("/api/settings")
def get_settings() -> dict:
    is_macos = platform.system() == "Darwin"
    return {
        "ai_provider": settings.selected_ai_provider,
        "ai_configured": settings.ai_configured,
        "voice_configured": (
            settings.selected_ai_provider == "openai" and bool(settings.openai_api_key)
        ),
        "text_model": settings.selected_ai_model,
        "realtime_model": settings.openai_realtime_model,
        "voice": settings.openai_realtime_voice,
        "automation_enabled": is_macos and read_setting("automation_enabled", "false") == "true",
        "platform": platform.system(),
        "api_key_source": (
            "Gemini API key on backend"
            if settings.selected_ai_provider == "gemini" and settings.gemini_api_key
            else "OpenAI API key on backend"
            if settings.selected_ai_provider == "openai" and settings.openai_api_key
            else "not configured"
        ),
    }


@app.put("/api/settings/automation")
def update_automation_settings(body: AutomationSettings) -> dict:
    if body.enabled and platform.system() != "Darwin":
        raise HTTPException(
            status_code=400,
            detail="Mac automation is available only when the backend runs locally on macOS.",
        )
    write_setting("automation_enabled", "true" if body.enabled else "false")
    return {"automation_enabled": body.enabled}


@app.get("/api/conversations")
def get_conversations() -> List[dict]:
    with connection() as db:
        rows = db.execute(
            """
            SELECT c.id, c.title, c.created_at, c.updated_at,
                   COUNT(m.id) AS message_count
            FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
            GROUP BY c.id ORDER BY c.updated_at DESC, c.id DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/conversations/{conversation_id}")
def get_conversation(conversation_id: str) -> dict:
    with connection() as db:
        conversation = db.execute(
            "SELECT id, title FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        messages = db.execute(
            "SELECT id, role, content, created_at FROM messages "
            "WHERE conversation_id = ? ORDER BY id",
            (conversation_id,),
        ).fetchall()
    return {"conversation": dict(conversation), "messages": [dict(row) for row in messages]}


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: str) -> dict:
    with connection() as db:
        cursor = db.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"deleted": True}


@app.post("/api/chat")
async def chat(body: ChatRequest) -> StreamingResponse:
    if not settings.ai_configured:
        key_name = "GEMINI_API_KEY" if settings.selected_ai_provider == "gemini" else "OPENAI_API_KEY"
        raise HTTPException(
            status_code=503,
            detail=(
                "AI is not configured. Add "
                + key_name
                + " to the backend environment and restart the backend."
            ),
        )

    with connection() as db:
        prior = db.execute(
            "SELECT role, content FROM messages WHERE conversation_id = ? "
            "ORDER BY id DESC LIMIT 20",
            (body.conversation_id,),
        ).fetchall()
        previous = [dict(row) for row in reversed(prior)]

    memory = relevant_context()
    system_message = (
        "You are MiMu AI, a helpful personal assistant. Reply naturally in the user's "
        "language, including Bangla, English, or Banglish. Never claim to have performed "
        "computer actions unless a separate authorized tool actually did so. "
        "Never ask the user to share passwords, API keys, or other secrets."
    )
    if memory:
        system_message += "\nUser-approved personal memory (use only when relevant):\n- " + "\n- ".join(memory)
    messages = [{"role": "system", "content": system_message}] + previous
    messages.append({"role": "user", "content": body.message.strip()})

    async def events():
        chunks: List[str] = []
        try:
            async for chunk in stream_reply(messages):
                chunks.append(chunk)
                yield "data: " + json.dumps({"type": "delta", "content": chunk}) + "\n\n"
        except AIConfigurationError as exc:
            logger.warning("AI configuration changed during a chat request: %s", exc)
            yield "data: " + json.dumps({"type": "error", "detail": str(exc)}) + "\n\n"
            return
        except AIProviderError as exc:
            logger.warning("AI provider request failed: %s", exc)
            yield "data: " + json.dumps({"type": "error", "detail": str(exc)}) + "\n\n"
            return

        reply = "".join(chunks).strip()
        if not reply:
            yield "data: " + json.dumps({"type": "error", "detail": "The AI provider returned an empty response."}) + "\n\n"
            return
        title = body.message.strip().replace("\n", " ")[:64]
        with connection() as db:
            db.execute(
                "INSERT OR IGNORE INTO conversations(id, title) VALUES(?, ?)",
                (body.conversation_id, title),
            )
            db.execute(
                "INSERT INTO messages(conversation_id, role, content) VALUES(?, 'user', ?)",
                (body.conversation_id, body.message.strip()),
            )
            db.execute(
                "INSERT INTO messages(conversation_id, role, content) VALUES(?, 'assistant', ?)",
                (body.conversation_id, reply),
            )
            db.execute(
                "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (body.conversation_id,),
            )
        yield "data: " + json.dumps({"type": "done"}) + "\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/memories")
def list_memories() -> List[dict]:
    with connection() as db:
        rows = db.execute(
            "SELECT id, content, created_at FROM memories ORDER BY id DESC"
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/memories")
def create_memory(body: MemoryRequest) -> dict:
    with connection() as db:
        cursor = db.execute(
            "INSERT INTO memories(content) VALUES(?)", (body.content.strip(),)
        )
        row = db.execute(
            "SELECT id, content, created_at FROM memories WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return dict(row)


@app.delete("/api/memories/{memory_id}")
def delete_memory(memory_id: int) -> dict:
    with connection() as db:
        cursor = db.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Memory not found.")
    return {"deleted": True}


@app.get("/api/skills")
def get_skills() -> List[dict]:
    return SKILLS


@app.get("/api/actions")
def get_action_log() -> List[dict]:
    with connection() as db:
        rows = db.execute(
            "SELECT id, action, target, status, created_at FROM action_log ORDER BY id DESC LIMIT 30"
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/automation/execute")
def run_automation(body: AutomationRequest) -> dict:
    if not body.confirmed:
        raise HTTPException(status_code=400, detail="Explicit confirmation is required.")
    if bool(body.conversation_id) != bool(body.user_message.strip()):
        raise HTTPException(status_code=400, detail="Both conversation ID and user message are required.")
    if read_setting("automation_enabled", "false") != "true":
        raise HTTPException(status_code=403, detail="Enable Mac automation in Settings first.")

    try:
        normalized_target = normalize_action(body.action_type, body.target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        execute_action(body.action_type, normalized_target)
    except (OSError, subprocess.SubprocessError, RuntimeError) as exc:
        with connection() as db:
            db.execute(
                "INSERT INTO action_log(action, target, status) VALUES(?, ?, 'failed')",
                (body.action_type, normalized_target),
            )
        logger.exception("Authorized automation action failed")
        raise HTTPException(status_code=500, detail="The requested macOS action failed.") from exc

    reply = "Opened " + normalized_target + "."
    with connection() as db:
        db.execute(
            "INSERT INTO action_log(action, target, status) VALUES(?, ?, 'completed')",
            (body.action_type, normalized_target),
        )
        if body.conversation_id:
            db.execute(
                "INSERT OR IGNORE INTO conversations(id, title) VALUES(?, ?)",
                (body.conversation_id, body.user_message.strip().replace("\n", " ")[:64]),
            )
            db.execute(
                "INSERT INTO messages(conversation_id, role, content) VALUES(?, 'user', ?)",
                (body.conversation_id, body.user_message.strip()),
            )
            db.execute(
                "INSERT INTO messages(conversation_id, role, content) VALUES(?, 'assistant', ?)",
                (body.conversation_id, reply),
            )
            db.execute(
                "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (body.conversation_id,),
            )
    return {
        "status": "completed",
        "action_type": body.action_type,
        "target": normalized_target,
        "reply": reply,
    }


@app.post("/api/voice/session")
async def create_voice_session() -> dict:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="Voice is not configured. Add OPENAI_API_KEY to the project root .env file.",
        )
    payload = {
        "session": {
            "type": "realtime",
            "model": settings.openai_realtime_model,
            "instructions": (
                "You are MiMu AI, a helpful personal assistant. Reply naturally in the "
                "user's language, including Bangla, English, or Banglish."
            ),
            "audio": {
                "input": {"transcription": {"model": "whisper-1"}},
                "output": {"voice": settings.openai_realtime_voice},
            },
        }
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={"Authorization": "Bearer " + settings.openai_api_key},
                json=payload,
            )
    except httpx.HTTPError as exc:
        logger.warning("Realtime token request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not connect to the realtime provider.") from exc

    if response.is_error:
        logger.warning("Realtime token request failed with status %s", response.status_code)
        raise HTTPException(status_code=502, detail="The realtime provider could not create a voice session.")
    try:
        result = response.json()
        secret = result.get("value") or result["client_secret"]["value"]
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="The realtime provider returned an invalid session.") from exc
    return {"client_secret": secret, "model": settings.openai_realtime_model}


@app.post("/api/voice/transcript")
def save_voice_transcript(body: VoiceTranscriptRequest) -> dict:
    if body.role not in ("user", "assistant"):
        raise HTTPException(status_code=400, detail="Invalid transcript role.")
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Transcript cannot be empty.")
    with connection() as db:
        db.execute(
            "INSERT OR IGNORE INTO conversations(id, title) VALUES(?, 'Voice conversation')",
            (body.conversation_id,),
        )
        db.execute(
            "INSERT INTO messages(conversation_id, role, content) VALUES(?, ?, ?)",
            (body.conversation_id, body.role, content),
        )
        db.execute(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (body.conversation_id,),
        )
    return {"saved": True}


@app.get("/api/diagnostics")
def diagnostics() -> dict:
    with connection() as db:
        db.execute("SELECT 1")
    return {
        "backend": "online",
        "memory": "online",
        "ai": "configured" if settings.openai_api_key else "needs_setup",
        "automation": (
            "unavailable" if platform.system() != "Darwin"
            else "enabled" if read_setting("automation_enabled", "false") == "true"
            else "disabled"
        ),
        "platform": platform.system(),
    }
