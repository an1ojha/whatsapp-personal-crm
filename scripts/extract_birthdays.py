#!/usr/bin/env python3
"""
Extract birthdays from all DM chats.

Pipeline:
1) Scan all DM chats for birthday-related references using regex.
2) For each reference, ask the LLM whose birthday is being discussed and what date.
3) Write public/data/birthdays.json for the Birthday tab.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

CONTACTS_PATH = ROOT / "output" / "contacts.json"
INDEX_PATH = ROOT / "output" / "index.json"
CHATS_DIR = ROOT / "output" / "chats"
BIRTHDAYS_PATH = ROOT / "public" / "data" / "birthdays.json"
GROUP_BIRTHDAYS_PATH = ROOT / "public" / "data" / "group_birthdays.json"
PROMPT_PATH = ROOT / "prompts" / "birthday_extract_system_prompt.txt"
TRACE_PATH = ROOT / "output" / "birthday_llm_trace.jsonl"

MAX_CONTEXT_LINES = 24
REQUEST_TIMEOUT_SECONDS = 45
KEYWORD_RE = re.compile(
    r"\b(birthday+y*|bday|b'day|happy birthday|hpy bday|happ birth|janamdin|many happy returns|dob|date of birth|born on|born in)\b|🎂|🥳",
    re.IGNORECASE,
)
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
BUSINESS_NAME_RE = re.compile(
    r"\b(bank|airtel|jio|vi|vodafone|swiggy|zomato|uber|ola|amazon|flipkart|myntra|paytm|gpay|phonepe|"
    r"support|care|customer|service|official|team|delivery|booking|store|mart|shop|hospital|clinic|"
    r"restaurant|hotel|insurance|finance|securities|ltd|llp|inc|pvt)\b",
    re.IGNORECASE,
)
BUSINESS_CONTEXT_RE = re.compile(
    r"\b(anniversary|offer|sale|discount|coupon|deal|order|booking|invoice|policy|reward points|"
    r"cashback|dear customer|valued customer|we wish you|our team)\b",
    re.IGNORECASE,
)

def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def load_system_prompt() -> str:
    try:
        text = PROMPT_PATH.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"Could not read prompt file: {PROMPT_PATH} ({exc})") from exc
    if not text:
        raise RuntimeError(f"Prompt file is empty: {PROMPT_PATH}")
    return text


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


def format_messages(messages: list[dict]) -> str:
    lines = []
    for msg in messages:
        pk = msg.get("pk")
        ts = str(msg.get("timestamp") or "")
        who = "Me" if msg.get("from_me") else str(msg.get("sender") or "Them")
        text = str(msg.get("text") or "")
        lines.append(f"pk={pk} {ts} {who}: {text}")
    return "\n".join(lines)


def sanitize_date(value: str) -> str:
    raw = str(value or "").strip()
    if re.fullmatch(r"\d{2}-[A-Za-z]{3}", raw):
        dd, mon = raw.split("-")
        mon = mon[:1].upper() + mon[1:].lower()
        if mon in MONTHS:
            return f"{dd}-{mon}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        mm = int(raw[5:7])
        dd = int(raw[8:10])
        if 1 <= mm <= 12 and 1 <= dd <= 31:
            return f"{dd:02d}-{MONTHS[mm - 1]}"
        return ""
    if re.fullmatch(r"\d{2}-\d{2}", raw):
        mm = int(raw[:2])
        dd = int(raw[3:5])
        if 1 <= mm <= 12 and 1 <= dd <= 31:
            return f"{dd:02d}-{MONTHS[mm - 1]}"
        return ""
    return ""


def parse_int_field(value) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value.is_integer():
            return int(value)
        return None
    if isinstance(value, Decimal):
        try:
            if value == value.to_integral_value():
                return int(value)
        except (InvalidOperation, ValueError):
            return None
        return None
    raw = str(value).strip()
    if not raw:
        return None
    raw = re.sub(r"(st|nd|rd|th)$", "", raw.lower())
    if raw.isdigit():
        return int(raw)
    return None


def parse_confidence(value) -> float:
    try:
        raw = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(-1.0, min(1.0, raw))


def timestamp_to_month_day(ts: str) -> str:
    raw = str(ts or "").strip()
    if not raw:
        return ""
    try:
        dt = datetime.fromisoformat(raw[:19])
        return f"{dt.day:02d}-{MONTHS[dt.month - 1]}"
    except ValueError:
        return ""


def split_month_day(ts: str) -> tuple[Optional[int], Optional[int]]:
    raw = str(ts or "").strip()
    if not raw:
        return (None, None)
    try:
        dt = datetime.fromisoformat(raw[:19])
        return (dt.month, dt.day)
    except ValueError:
        return (None, None)


def resolve_birthday_date(parsed: dict, reference_timestamp: str) -> str:
    date_iso = sanitize_date(str(parsed.get("date_iso") or "").strip())
    if date_iso:
        return date_iso

    parsed_day = parse_int_field(parsed.get("birthday_day"))
    parsed_month = parse_int_field(parsed.get("birthday_month"))
    ref_month, ref_day = split_month_day(reference_timestamp)

    month = parsed_month or ref_month
    day = parsed_day or (ref_day if parsed_month else None)
    if month is not None and day is not None and 1 <= month <= 12 and 1 <= day <= 31:
        return f"{day:02d}-{MONTHS[month - 1]}"

    fallback = timestamp_to_month_day(reference_timestamp)
    return fallback


def append_trace(trace: dict) -> None:
    TRACE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with TRACE_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(trace, ensure_ascii=False))
        fh.write("\n")


def build_dm_contacts() -> list[dict]:
    contacts_payload = load_json(CONTACTS_PATH, {"contacts": []})
    contacts = contacts_payload.get("contacts") if isinstance(contacts_payload, dict) else []
    contacts = [row for row in contacts if isinstance(row, dict)]
    by_jid = {}
    for row in contacts:
        jid = str(row.get("jid") or "").strip()
        if not jid or jid.endswith("@g.us"):
            continue
        by_jid[jid] = {
            "jid": jid,
            "name": str(row.get("name") or jid).strip() or jid,
            "jkey": str(row.get("jkey") or "").strip(),
        }

    index_rows = load_json(INDEX_PATH, [])
    for row in index_rows if isinstance(index_rows, list) else []:
        if not isinstance(row, dict):
            continue
        jid = str(row.get("jid") or "").strip()
        if not jid or jid.endswith("@g.us"):
            continue
        typ = str(row.get("type") or "").strip().lower()
        if typ == "group":
            continue
        jkey = str(row.get("jkey") or "").strip()
        if not jkey:
            continue
        current = by_jid.get(jid, {})
        by_jid[jid] = {
            "jid": jid,
            "name": str(current.get("name") or row.get("name") or jid).strip() or jid,
            "jkey": jkey,
        }
    return sorted(by_jid.values(), key=lambda row: (row.get("name") or "").lower())


def build_group_chats() -> list[dict]:
    index_rows = load_json(INDEX_PATH, [])
    chats = []
    seen = set()
    for row in index_rows if isinstance(index_rows, list) else []:
        if not isinstance(row, dict):
            continue
        typ = str(row.get("type") or "").strip().lower()
        jid = str(row.get("jid") or "").strip()
        jkey = str(row.get("jkey") or "").strip()
        if typ != "group" and not jid.endswith("@g.us"):
            continue
        if not jid or not jkey or jid in seen:
            continue
        seen.add(jid)
        chats.append({"jid": jid, "name": str(row.get("name") or jid).strip() or jid, "jkey": jkey})
    return sorted(chats, key=lambda row: (row.get("name") or "").lower())


def collect_reference_candidates(dm_contacts: list[dict]) -> list[dict]:
    refs = []
    total = len(dm_contacts)
    for idx, contact in enumerate(dm_contacts, start=1):
        jid = contact["jid"]
        name = contact["name"]
        jkey = contact.get("jkey") or re.sub(r"[^a-zA-Z0-9._-]+", "_", jid)
        chat_path = CHATS_DIR / f"{jkey}.jsonl"
        messages = load_jsonl(chat_path)
        local_count = 0
        for m_index, msg in enumerate(messages):
            text = str(msg.get("text") or "")
            if not text or not KEYWORD_RE.search(text):
                continue
            refs.append(
                {
                    "jid": jid,
                    "chat_person_name": name,
                    "jkey": jkey,
                    "chat_index": m_index,
                    "pk": msg.get("pk"),
                    "timestamp": str(msg.get("timestamp") or ""),
                    "text": text.strip(),
                }
            )
            local_count += 1
        print(
            f"PROGRESS phase=scan chats_done={idx} chats_total={total} refs_found={len(refs)} chats_left={max(0, total-idx)}",
            flush=True,
        )
        if local_count:
            print(f"[birthdays] {name}: {local_count} reference(s)", flush=True)
    return refs


def context_window(messages: list[dict], center: int, span: int = 3) -> list[dict]:
    start = max(0, center - span)
    end = min(len(messages), center + span + 1)
    return messages[start:end][-MAX_CONTEXT_LINES:]


def parse_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    if isinstance(value, (int, float)):
        return bool(value)
    return False


def dedupe_rows(rows: list[dict]) -> list[dict]:
    by_key = {}
    for row in rows:
        key = (
            str(row.get("chat_person_jid") or ""),
            str(row.get("birthday_person_name") or ""),
            str(row.get("date") or ""),
        )
        current = by_key.get(key)
        if not current:
            by_key[key] = row
            continue
        current_conf = parse_confidence(current.get("confidence"))
        next_conf = parse_confidence(row.get("confidence"))
        if next_conf > current_conf:
            by_key[key] = row
            continue
        if next_conf < current_conf:
            continue
        current_len = len(str(current.get("reference_message") or ""))
        next_len = len(str(row.get("reference_message") or ""))
        if next_len > current_len:
            by_key[key] = row
    deduped = list(by_key.values())
    deduped.sort(key=lambda row: (row.get("date") or "99-99", (row.get("birthday_person_name") or "").lower()))
    return deduped


def dedupe_group_rows(rows: list[dict]) -> list[dict]:
    by_key = {}
    for row in rows:
        key = (
            str(row.get("chat_person_jid") or ""),
            str(row.get("birthday_person_name") or "").lower(),
            str(row.get("date") or ""),
        )
        current = by_key.get(key)
        if not current:
            by_key[key] = row
            continue
        current_conf = parse_confidence(current.get("confidence"))
        next_conf = parse_confidence(row.get("confidence"))
        if next_conf > current_conf:
            by_key[key] = row
            continue
        if next_conf < current_conf:
            continue
        current_len = len(str(current.get("reference_message") or ""))
        next_len = len(str(row.get("reference_message") or ""))
        if next_len > current_len:
            by_key[key] = row
    deduped = list(by_key.values())
    deduped.sort(key=lambda row: ((row.get("chat_person_name") or "").lower(), row.get("date") or "99-99"))
    return deduped


def is_business_chat(ref: dict, snippet: list[dict]) -> bool:
    name = str(ref.get("chat_person_name") or "")
    jid = str(ref.get("jid") or "")
    text_blob = "\n".join(str(msg.get("text") or "") for msg in snippet)
    reference_text = str(ref.get("text") or "")
    looks_like_business_name = bool(BUSINESS_NAME_RE.search(name))
    looks_like_business_jid = "@newsletter" in jid or "@broadcast" in jid
    looks_like_business_context = bool(BUSINESS_CONTEXT_RE.search(reference_text) or BUSINESS_CONTEXT_RE.search(text_blob))
    if looks_like_business_context and ("happy birthday" in text_blob.lower() or "anniversary" in text_blob.lower()):
        return True
    return looks_like_business_name or looks_like_business_jid


def adjudicate_reference(client, model: str, system_prompt: str, ref: dict, messages: list[dict]) -> tuple[Optional[dict], dict]:
    center = int(ref.get("chat_index") or 0)
    snippet = context_window(messages, center, span=6)
    prompt = (
        f"Chat type: {ref.get('chat_type', 'dm')}\n"
        f"Chat contact name: {ref.get('chat_person_name')}\n"
        f"Chat contact jid: {ref.get('jid')}\n"
        f"Birthday reference message:\n{ref.get('text')}\n\n"
        f"Nearby messages:\n{format_messages(snippet)}\n"
    )
    trace = {
        "ts": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "chat_person_jid": str(ref.get("jid") or ""),
        "chat_person_name": str(ref.get("chat_person_name") or "Unknown"),
        "reference_pk": ref.get("pk"),
        "reference_timestamp": str(ref.get("timestamp") or ""),
        "reference_message": str(ref.get("text") or ""),
        "llm_input": prompt,
    }
    response = client.messages.create(
        model=model,
        max_tokens=250,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(block.text for block in response.content if getattr(block, "type", "") == "text").strip()
    parsed = extract_json_object(text) if text else {}
    trace["llm_output_raw_text"] = text
    trace["llm_output_parsed"] = parsed
    if not parse_bool(parsed.get("is_birthday_reference")):
        trace["accepted"] = False
        trace["drop_reason"] = "not_birthday_reference"
        trace["resolved_date"] = ""
        return None, trace

    date_value = resolve_birthday_date(parsed, str(ref.get("timestamp") or ""))
    if not date_value:
        trace["accepted"] = False
        trace["drop_reason"] = "empty_resolved_date"
        trace["resolved_date"] = ""
        return None, trace

    birthday_person_name = str(parsed.get("birthday_person_name") or "").strip() or "Unknown"
    confidence = 0.0 if birthday_person_name.lower() == "unknown" else parse_confidence(parsed.get("confidence"))
    if is_business_chat(ref, snippet):
        confidence = -1.0
    row = {
        "chat_person_jid": str(ref.get("jid") or ""),
        "chat_person_name": str(ref.get("chat_person_name") or "Unknown"),
        "birthday_person_name": birthday_person_name,
        "date": date_value,
        "confidence": confidence,
        "reference_message": str(ref.get("text") or "").strip()[:220],
        "reference_pk": ref.get("pk"),
        "reference_timestamp": str(ref.get("timestamp") or ""),
    }
    trace["accepted"] = True
    trace["drop_reason"] = ""
    trace["resolved_date"] = date_value
    trace["birthday_person_name"] = birthday_person_name
    trace["confidence"] = confidence
    return row, trace


def collect_candidates_for_scope(scope: str) -> list[dict]:
    sources = build_dm_contacts() if scope == "dm" else build_group_chats()
    refs = []
    total = len(sources)
    for idx, chat in enumerate(sources, start=1):
        jid = chat["jid"]
        name = chat["name"]
        jkey = chat.get("jkey") or re.sub(r"[^a-zA-Z0-9._-]+", "_", jid)
        chat_path = CHATS_DIR / f"{jkey}.jsonl"
        messages = load_jsonl(chat_path)
        local_count = 0
        for m_index, msg in enumerate(messages):
            text = str(msg.get("text") or "")
            if not text or not KEYWORD_RE.search(text):
                continue
            refs.append(
                {
                    "jid": jid,
                    "chat_person_name": name,
                    "jkey": jkey,
                    "chat_index": m_index,
                    "pk": msg.get("pk"),
                    "timestamp": str(msg.get("timestamp") or ""),
                    "text": text.strip(),
                    "chat_type": scope,
                }
            )
            local_count += 1
        print(
            f"PROGRESS phase=scan chats_done={idx} chats_total={total} refs_found={len(refs)} chats_left={max(0, total-idx)}",
            flush=True,
        )
        if local_count:
            print(f"[birthdays:{scope}] {name}: {local_count} reference(s)", flush=True)
    return refs


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract birthdays from WhatsApp chats")
    parser.add_argument("--scope", choices=["dm", "group"], default="dm", help="Extraction scope")
    args = parser.parse_args()
    scope = args.scope

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
    try:
        system_prompt = load_system_prompt()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr, flush=True)
        sys.exit(1)

    output_path = BIRTHDAYS_PATH if scope == "dm" else GROUP_BIRTHDAYS_PATH
    trace_path = TRACE_PATH if scope == "dm" else ROOT / "output" / "group_birthday_llm_trace.jsonl"

    chats = build_dm_contacts() if scope == "dm" else build_group_chats()
    if not chats:
        payload = {
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "items": [],
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print("PROGRESS phase=scan chats_done=0 chats_total=0 refs_found=0 chats_left=0", flush=True)
        print("PROGRESS phase=adjudicate refs_done=0 refs_total=0 rows_ready=0", flush=True)
        print(f"Wrote 0 birthday row(s) -> {output_path.relative_to(ROOT)}", flush=True)
        return

    client = Anthropic(api_key=api_key, timeout=REQUEST_TIMEOUT_SECONDS)
    trace_path.parent.mkdir(parents=True, exist_ok=True)
    trace_path.write_text("", encoding="utf-8")
    references = collect_candidates_for_scope(scope)
    refs_total = len(references)
    rows = []
    for idx, ref in enumerate(references, start=1):
        jkey = str(ref.get("jkey") or "")
        chat_path = CHATS_DIR / f"{jkey}.jsonl"
        messages = load_jsonl(chat_path)
        if not messages:
            print(
                f"PROGRESS phase=adjudicate refs_done={idx} refs_total={refs_total} rows_ready={len(rows)}",
                flush=True,
            )
            continue
        try:
            adjudicated, trace = adjudicate_reference(client, model, system_prompt, ref, messages)
            trace["scope"] = scope
            with trace_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(trace, ensure_ascii=False))
                fh.write("\n")
            if adjudicated:
                rows.append(adjudicated)
        except Exception as exc:  # noqa: BLE001
            print(f"[birthdays] warning {ref.get('chat_person_name')}: {exc}", flush=True)
            with trace_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(
                {
                    "ts": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                    "scope": scope,
                    "chat_person_jid": str(ref.get("jid") or ""),
                    "chat_person_name": str(ref.get("chat_person_name") or "Unknown"),
                    "reference_pk": ref.get("pk"),
                    "reference_timestamp": str(ref.get("timestamp") or ""),
                    "reference_message": str(ref.get("text") or ""),
                    "llm_input": "",
                    "llm_output_raw_text": "",
                    "llm_output_parsed": {},
                    "accepted": False,
                    "drop_reason": f"exception:{exc}",
                    "resolved_date": "",
                }, ensure_ascii=False))
                fh.write("\n")
        print(
            f"PROGRESS phase=adjudicate refs_done={idx} refs_total={refs_total} rows_ready={len(rows)}",
            flush=True,
        )

    final_rows = dedupe_rows(rows) if scope == "dm" else dedupe_group_rows(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "_meta": {"trace_file": str(trace_path.relative_to(ROOT))},
        "items": final_rows,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"PROGRESS phase=adjudicate refs_done={refs_total} refs_total={refs_total} rows_ready={len(final_rows)}",
        flush=True,
    )
    print(f"Wrote {len(final_rows)} birthday row(s) -> {output_path.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
