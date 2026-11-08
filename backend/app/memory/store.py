from typing import List

from app.core.database import connection


def list_memories() -> List[dict]:
    with connection() as db:
        rows = db.execute(
            "SELECT id, content, created_at FROM memories ORDER BY id DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def relevant_context(limit: int = 8) -> List[str]:
    with connection() as db:
        rows = db.execute(
            "SELECT content FROM memories ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [str(row["content"]) for row in rows]
