#!/usr/bin/env python3
"""
Extract birthday hints from watchlist chats using Anthropic.

Reads:
  - output/contacts.json
  - output/chats/{jkey}.jsonl
Writes:
  - public/data/birthdays.json
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

CONTACTS_PATH = ROOT / "output" / "contacts.json"
CHATS_DIR = ROOT / "output" / "chats"
BIRTHDAYS_PATH = ROOT / "public" / "data" / "birthdays.json"

MAX_CONTEXT_LINES = 80
REQUEST_TIMEOUT_SECONDS = 45
KEYWORD_RE = re.compile(
    r"\b(birthday|bday|born on|born in|dob|date of birth|happy birthday)\b|🎂|🥳",
    re.IGNORECASE,
)

SYSTEM_PROMPT = """You extract birthday facts from chat snippets.
Return strict JSON in this shape:
{
  "date_iso": "YYYY-MM-DD or MM-DD or empty string",
  "confidence": 0.0,
  "evidence": "short quote",
  "reason": "why this is likely a birthday or why unknown"
}
Rules:
- If date is uncertain, set date_iso to empty string.
- confidence must be between 0 and 1.
- evidence should be <= 140 chars.
- Never invent dates.
"""


def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    if not path.exists():
        return rows
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def jkey_for(entry: dict) -> str:
    if entry.get("jkey"):
        return str(entry["jkey"]).strip()
    jid = str(entry.get("jid") or "").strip()
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", jid) or "unknown"


def extract_json_object(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    a = text.find("{")
    b = text.rfind("}")
    if a >= 0 and b > a:
        return json.loads(text[a : b + 1])
    raise ValueError("No JSON object found")


def candidate_window(messages: list[dict], span: int = 5) -> list[dict]:
    hit_indexes = []
    for idx, msg in enumerate(messages):
        text = str(msg.get("text") or "")
        if KEYWORD_RE.search(text):
            hit_indexes.append(idx)
    if not hit_indexes:
        return []
    selected = set()
    for idx in hit_indexes:
        start = max(0, idx - span)
        end = min(len(messages), idx + span + 1)
        selected.update(range(start, end))
    ordered = [messages[i] for i in sorted(selected)]
    return ordered[-MAX_CONTEXT_LINES:]


def format_messages(messages: list[dict]) -> str:
    lines = []
    for msg in messages:
        ts = str(msg.get("timestamp") or "")
        who = "Me" if msg.get("from_me") else str(msg.get("sender") or "Them")
        text = str(msg.get("text") or "")
        lines.append(f"{ts} {who}: {text}")
    return "\n".join(lines)


def sanitize_date(value: str) -> str:
    raw = str(value or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw
    if re.fullmatch(r"\d{2}-\d{2}", raw):
        return raw
    return ""


def to_float(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def main() -> None:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"
    if not api_key:
        print("Set ANTHROPIC_API_KEY in .env", file=sys.stderr, flush=True)
        sys.exit(1)

    try:
        from anthropic import Anthropic
    except ImportError:
        print("Run: pip install -r requirements.txt", file=sys.stderr, flush=True)
        sys.exit(1)

    contacts_payload = load_json(CONTACTS_PATH, {"contacts": []})
    contacts = [c for c in (contacts_payload.get("contacts") or []) if isinstance(c, dict) and c.get("on_watchlist")]
    contacts = [c for c in contacts if not str(c.get("jid") or "").endswith("@g.us")]

    client = Anthropic(api_key=api_key, timeout=REQUEST_TIMEOUT_SECONDS)
    items = []
    total = len(contacts)
    for index, contact in enumerate(contacts, start=1):
        name = str(contact.get("name") or contact.get("jid") or "").strip()
        jid = str(contact.get("jid") or "").strip()
        jkey = jkey_for(contact)
        print(f"[birthdays] {index}/{total} {name}", flush=True)

        chat_path = CHATS_DIR / f"{jkey}.jsonl"
        messages = load_jsonl(chat_path)
        if not messages:
            continue
        snippet = candidate_window(messages)
        if not snippet:
            continue

        prompt = (
            f"Contact: {name}\n"
            f"JID: {jid}\n\n"
            f"Chat snippets that may mention birthdays:\n{format_messages(snippet)}\n"
        )
        try:
            response = client.messages.create(
                model=model,
                max_tokens=300,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            text = "".join(block.text for block in response.content if getattr(block, "type", "") == "text").strip()
            parsed = extract_json_object(text) if text else {}
        except Exception as exc:  # noqa: BLE001
            print(f"[birthdays] warning {name}: {exc}", flush=True)
            continue

        date_value = sanitize_date(parsed.get("date_iso", ""))
        if not date_value:
            continue
        evidence = str(parsed.get("evidence") or "").strip()[:140]
        items.append(
            {
                "jid": jid,
                "name": name,
                "date": date_value,
                "confidence": round(to_float(parsed.get("confidence")), 3),
                "evidence": evidence,
                "jkey": jkey,
            }
        )

    items.sort(key=lambda row: (row.get("date") or "99-99", (row.get("name") or "").lower()))
    BIRTHDAYS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "items": items,
    }
    BIRTHDAYS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(items)} birthday row(s) -> {BIRTHDAYS_PATH.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
