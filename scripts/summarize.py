#!/usr/bin/env python3
"""
Per-contact context + per-watchlist rolling summaries via Anthropic.

Reads:
  - output/contacts.json (canonical)
  - watchlist.json (legacy fallback for migration)
  - output/chats/{jkey}.jsonl
  - optional summaries/{jkey}.json
Writes:
  - summaries/{jkey}.json for watchlist contacts
  - output/contacts.json context fields for all contacts

Env:
  ANTHROPIC_API_KEY — required (https://console.anthropic.com/)
  ANTHROPIC_MODEL — optional, default claude-sonnet-4-6
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

SUMMARIES_DIR = ROOT / "summaries"
STATE_PATH = ROOT / "output" / "state.json"
INDEX_PATH = ROOT / "output" / "index.json"
CONTACTS_PATH = ROOT / "output" / "contacts.json"
WATCHLIST_PATH = ROOT / "watchlist.json"
CHATS_DIR = ROOT / "output" / "chats"
PROMPT_PATH = ROOT / "prompts" / "followups_system_prompt.txt"

MAX_DELTA_MSGS = 400
MAX_REBUILD_MSGS = 2500
MAX_CONTEXT_MSGS = 220

CONTEXT_SYSTEM_PROMPT = """You infer durable contact context from a personal chat.
Return JSON only in this shape:
{
  "relation": "1-2 words",
  "home_location": "city name or empty string",
  "age": <integer or null>,
  "other": "max 10 words, freeform useful context"
}
Rules:
- relation: lowercase, 1-2 words only (example: close friend, coworker, family).
- if uncertain on home_location or age, return empty string / null.
- other must be <=10 words and factual.
- prefer durable facts over one-off plans.
"""

def load_system_prompt() -> str:
    try:
        text = PROMPT_PATH.read_text(encoding="utf-8").strip()
    except OSError as e:
        raise RuntimeError(f"Could not read prompt file: {PROMPT_PATH} ({e})") from e
    if not text:
        raise RuntimeError(f"Prompt file is empty: {PROMPT_PATH}")
    return text


def load_jsonl(path: Path) -> list:
    rows = []
    if not path.exists():
        return rows
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def format_messages(msgs: list) -> str:
    lines = []
    for m in msgs:
        pk = m.get("pk")
        ts = m.get("timestamp", "")
        who = "Me" if m.get("from_me") else m.get("sender", "?")
        typ = m.get("type", "text")
        body = m.get("text")
        if typ == "media":
            body = "[media]"
        elif body is None:
            body = ""
        lines.append(f"pk={pk} ts={ts} {who}: {body}")
    return "\n".join(lines)


def extract_json_object(text: str) -> dict:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if m:
        return json.loads(m.group(1))
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    a = text.find("{")
    b = text.rfind("}")
    if a >= 0 and b > a:
        return json.loads(text[a : b + 1])
    raise ValueError("No JSON object in model response")


def normalize_relation(value: str) -> str:
    s = re.sub(r"[^a-zA-Z ]+", " ", str(value or "").strip().lower())
    parts = [p for p in s.split() if p]
    if not parts:
        return ""
    return " ".join(parts[:2])


def normalize_context(raw: dict, existing: dict | None = None) -> dict:
    existing = existing if isinstance(existing, dict) else {}
    raw = raw if isinstance(raw, dict) else {}
    relation = normalize_relation(raw.get("relation") or existing.get("relation") or "")
    home_location = str(raw.get("home_location") or existing.get("home_location") or "").strip()

    age_raw = raw.get("age", existing.get("age"))
    age = None
    if isinstance(age_raw, int):
        age = age_raw if 0 < age_raw < 130 else None
    elif isinstance(age_raw, str) and age_raw.strip().isdigit():
        parsed = int(age_raw.strip())
        age = parsed if 0 < parsed < 130 else None

    other_raw = str(raw.get("other") or existing.get("other") or "").strip()
    other = " ".join(other_raw.split()[:10])

    return {
        "relation": relation,
        "home_location": home_location,
        "age": age,
        "other": other,
        "context_last_updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


def format_context_block(context: dict) -> str:
    c = context if isinstance(context, dict) else {}
    return (
        "CONTACT CONTEXT (soft prior; do not override contradictory fresh evidence):\n"
        f"- relation: {c.get('relation') or ''}\n"
        f"- home_location: {c.get('home_location') or ''}\n"
        f"- age: {c.get('age') if c.get('age') is not None else ''}\n"
        f"- other: {c.get('other') or ''}\n"
        f"- context_last_updated: {c.get('context_last_updated') or ''}\n\n"
    )


def build_jid_map() -> dict:
    out = {}
    if STATE_PATH.exists():
        try:
            st = json.loads(STATE_PATH.read_text(encoding="utf-8"))
            for jid, info in (st.get("chats") or {}).items():
                if isinstance(info, dict) and info.get("jkey"):
                    out[jid] = info["jkey"]
        except (json.JSONDecodeError, OSError):
            pass
    if INDEX_PATH.exists():
        try:
            for row in json.loads(INDEX_PATH.read_text(encoding="utf-8")):
                j = (row or {}).get("jid")
                k = (row or {}).get("jkey")
                if j and k and j not in out:
                    out[j] = k
        except (json.JSONDecodeError, OSError):
            pass
    return out


def jkey_for(jid: str, jid_to_jkey: dict, entry: dict) -> str:
    if (entry or {}).get("jkey"):
        return str(entry["jkey"]).strip()
    if jid in jid_to_jkey:
        return jid_to_jkey[jid]
    s = re.sub(r"[^a-zA-Z0-9._-]+", "_", (jid or "").strip())
    return s or f"jid_{abs(hash((jid or '') + 'salt'))}"


def state_last_message_date(jid: str) -> Optional[str]:
    if not STATE_PATH.exists():
        return None
    try:
        st = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        c = (st.get("chats") or {}).get(jid) or {}
        return (c.get("last_message_date") or None) and str(c.get("last_message_date"))[:10]
    except (json.JSONDecodeError, OSError, TypeError):
        return None


def load_contacts() -> list[dict]:
    if CONTACTS_PATH.exists():
        try:
            data = json.loads(CONTACTS_PATH.read_text(encoding="utf-8"))
            rows = data.get("contacts") if isinstance(data, dict) else None
            contacts = [r for r in (rows or []) if isinstance(r, dict) and r.get("jid")]
            if contacts:
                return contacts
        except (json.JSONDecodeError, OSError):
            pass

    if not WATCHLIST_PATH.exists():
        return []
    try:
        wl = json.loads(WATCHLIST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    raw = wl.get("chats") if isinstance(wl, dict) else wl
    if not isinstance(raw, list):
        return []
    contacts = []
    for row in raw:
        if not isinstance(row, dict) or not row.get("jid"):
            continue
        jid = str(row.get("jid")).strip()
        if not jid or jid.endswith("@g.us"):
            continue
        contacts.append(
            {
                "jid": jid,
                "name": str(row.get("name") or "").strip() or jid,
                "category": str(row.get("category") or "personal").strip().lower(),
                "on_watchlist": True,
                "context": {
                    "relation": "",
                    "home_location": "",
                    "age": None,
                    "other": "",
                    "context_last_updated": None,
                },
                "context_last_pk": 0,
            }
        )
    return contacts


def save_contacts(rows: list[dict]) -> None:
    CONTACTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "contacts": rows,
        "_meta": {"count": len(rows), "source": "summarize"},
    }
    CONTACTS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    system_prompt = load_system_prompt()

    ap = argparse.ArgumentParser(description="LLM relation labels + rolling summaries")
    ap.add_argument(
        "--rebuild",
        action="store_true",
        help="Re-analyze from the last N messages; ignore last_summarized_pk in summary file",
    )
    ap.add_argument("--dry-run", action="store_true", help="Print sizes only; no API call")
    ap.add_argument(
        "--model",
        default=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
        help="Override ANTHROPIC_MODEL for this run",
    )
    ap.add_argument(
        "--chat",
        default="",
        help="Process only chats whose name/JID/jkey contains this text (case-insensitive)",
    )
    ap.add_argument(
        "--jid",
        default="",
        help="Process only this exact JID",
    )
    ap.add_argument(
        "--jkey",
        default="",
        help="Process only this exact jkey",
    )
    args = ap.parse_args()

    contacts = load_contacts()
    if not contacts:
        print("Contacts are empty — run `python3 scripts/seed_watchlist.py` first.")
        return

    jid_to_jkey = build_jid_map()
    chat_filter = (args.chat or "").strip().lower()
    jid_filter = (args.jid or "").strip()
    jkey_filter = (args.jkey or "").strip()
    if chat_filter or jid_filter or jkey_filter:
        filtered = []
        filtered = []
        for entry in contacts:
            jid = str(entry.get("jid") or "").strip()
            name = str(entry.get("name") or "").strip()
            jkey = jkey_for(jid, jid_to_jkey, entry)
            if jid_filter and jid != jid_filter:
                continue
            if jkey_filter and jkey != jkey_filter:
                continue
            if chat_filter:
                hay = f"{name} {jid} {jkey}".lower()
                if chat_filter not in hay:
                    continue
            filtered.append(entry)
        contacts = filtered
        if not contacts:
            print(
                "No contacts matched the provided filters "
                f"(chat='{args.chat}', jid='{args.jid}', jkey='{args.jkey}')."
            )
            return
        print(f"Filtered to {len(contacts)} contact(s).")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key and not args.dry_run:
        print("Set ANTHROPIC_API_KEY in .env (see .env.example).", file=sys.stderr)
        sys.exit(1)

    try:
        from anthropic import Anthropic
    except ImportError:
        print("Run: pip install -r requirements.txt", file=sys.stderr)
        sys.exit(1)

    client = Anthropic(api_key=api_key) if api_key else None
    SUMMARIES_DIR.mkdir(parents=True, exist_ok=True)

    summaries_target = [c for c in contacts if bool(c.get("on_watchlist"))]
    if not summaries_target:
        print("No contacts marked on_watchlist=true. Context fields will still be maintained.")

    for entry in contacts:
        if str(entry.get("jid") or "").endswith("@g.us"):
            entry["on_watchlist"] = False
            continue
        jid = str(entry["jid"]).strip()
        name = (entry.get("name") or "").strip() or jid
        jkey = jkey_for(jid, jid_to_jkey, entry)
        jsonl = CHATS_DIR / f"{jkey}.jsonl"
        if not jsonl.exists():
            print(f"  skip (no export): {name} ({jkey})")
            continue

        all_msgs = load_jsonl(jsonl)
        if not all_msgs:
            print(f"  skip (empty chat): {name}")
            continue

        pks = [int(m.get("pk", 0) or 0) for m in all_msgs if m.get("pk") is not None]
        file_max = max(pks) if pks else 0

        # Context generation runs for all contacts.
        existing_context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        need_context = args.rebuild
        if not existing_context:
            need_context = True
        context_last_pk = int(entry.get("context_last_pk") or entry.get("relation_last_pk") or 0)
        if file_max > context_last_pk:
            need_context = True

        if need_context:
            context_msgs = all_msgs[-MAX_CONTEXT_MSGS:]
            context_prompt = (
                f"Contact name: {name}\n"
                f"JID: {jid}\n"
                f"Category hint: {entry.get('category', 'personal')}\n\n"
                f"Recent chat excerpt:\n{format_messages(context_msgs)}\n"
            )
            if args.dry_run:
                print(f"  {name}: context refresh needed (~{len(context_prompt)//4} input tokens)")
            else:
                assert client is not None
                context_msg = client.messages.create(
                    model=args.model,
                    max_tokens=220,
                    system=CONTEXT_SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": context_prompt}],
                )
                context_text = "".join(b.text for b in context_msg.content if b.type == "text").strip()
                context_json = extract_json_object(context_text)
                entry["context"] = normalize_context(context_json, existing_context)
                entry["context_last_pk"] = file_max
        else:
            entry["context"] = normalize_context(existing_context, existing_context)

        # Follow-up summaries are maintained only for watchlist contacts.
        if not bool(entry.get("on_watchlist")):
            continue

        spath = SUMMARIES_DIR / f"{jkey}.json"
        prev = {}
        if spath.exists():
            try:
                prev = json.loads(spath.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                prev = {}
        last_spk = int(prev.get("last_summarized_pk", 0) or 0)

        if args.rebuild:
            new_msgs = all_msgs[-MAX_REBUILD_MSGS:]
        else:
            new_msgs = [m for m in all_msgs if int(m.get("pk", 0) or 0) > last_spk]
            if not new_msgs:
                print(f"  up to date (summary): {name}")
                continue
            if len(new_msgs) > MAX_DELTA_MSGS:
                new_msgs = new_msgs[-MAX_DELTA_MSGS:]

        prev_sum = (prev.get("rolling_summary") or "")
        if len(prev_sum) > 12000:
            prev_sum = prev_sum[-12000:]
        user_prompt = f"Chat display name: {name}\nJID: {jid}\nCategory hint: {entry.get('category', 'personal')}\n\n"
        user_prompt += format_context_block(entry.get("context") or {})
        if prev_sum and not args.rebuild:
            user_prompt += f"PREVIOUS ROLLING SUMMARY (may be context only; prefer NEW MESSAGES for facts):\n{prev_sum}\n\n"
        user_prompt += (
            "Use context as a soft prior, not a hard rule. Prefer recent message evidence when uncertain.\n\n"
            f"NEW MESSAGES to analyze (primary source):\n{format_messages(new_msgs)}\n"
        )

        if args.dry_run:
            toks = len(user_prompt) // 4
            print(f"  {name}: ~{toks} input tokens, {len(new_msgs)} new messages")
            continue

        assert client is not None
        out_msg = client.messages.create(
            model=args.model,
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = ""
        for block in out_msg.content:
            if block.type == "text":
                text += block.text
        text = text.strip()
        if not text:
            print(f"  ERROR {name}: empty model response", file=sys.stderr)
            sys.exit(1)
        try:
            out = extract_json_object(text)
        except (json.JSONDecodeError, ValueError) as e:
            print(f"  ERROR {name}: bad JSON from model: {e}", file=sys.stderr)
            sys.exit(1)

        out_record = {
            "jid": jid,
            "jkey": jkey,
            "name": name,
            "category": entry.get("category", "personal"),
            "relation": normalize_relation((entry.get("context") or {}).get("relation")),
            "last_summarized_pk": file_max,
            "last_summarized_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "rolling_summary": (out.get("rolling_summary") or "")[:20000],
            "open_threads": out.get("open_threads") or [],
            "followups": out.get("followups") or [],
        }
        if not isinstance(out_record["open_threads"], list):
            out_record["open_threads"] = []
        if not isinstance(out_record["followups"], list):
            out_record["followups"] = []

        lmd = state_last_message_date(jid) or (all_msgs[-1].get("timestamp", "") or "")[:10] or "—"
        out_record["last_message_date"] = lmd

        spath.write_text(json.dumps(out_record, ensure_ascii=False, indent=2), encoding="utf-8")
        nfu = len(out_record["followups"])
        print(f"  {name}: wrote summary ({nfu} follow-up suggestions)")

    # Normalize and persist updated contacts table.
    for entry in contacts:
        entry["context"] = normalize_context(entry.get("context") or {}, entry.get("context") or {})
        entry["context_last_pk"] = int(entry.get("context_last_pk") or entry.get("relation_last_pk") or 0)
        entry.pop("relation", None)
        entry.pop("relation_last_pk", None)
        entry.pop("relation_updated_at", None)
        entry["on_watchlist"] = bool(entry.get("on_watchlist"))
        if entry["category"] not in {"startup", "personal", "family", "logistics"}:
            entry["category"] = "personal"
    contacts.sort(key=lambda r: ((r.get("name") or "").lower(), r.get("jid") or ""))
    if not args.dry_run:
        save_contacts(contacts)
        print(f"Wrote {len(contacts)} contact row(s) -> {CONTACTS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
