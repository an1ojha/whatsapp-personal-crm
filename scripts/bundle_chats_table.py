#!/usr/bin/env python3
"""
Build public/data/chats_table.json for the Chats QA table.
Also publishes contacts/groups datasets for the People table.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "output" / "index.json"
OUT_PATH = ROOT / "public" / "data" / "chats_table.json"
CONTACTS_SRC = ROOT / "output" / "contacts.json"
GROUPS_SRC = ROOT / "output" / "groups.json"
CONTACTS_OUT = ROOT / "public" / "data" / "contacts.json"
GROUPS_OUT = ROOT / "public" / "data" / "groups.json"
WATCHLIST_OUT = ROOT / "public" / "data" / "watchlist.json"


def read_first_last_jsonl(path: Path):
    first = None
    last = None
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if first is None:
                first = line
            last = line
    return first, last


def to_last_message_preview(name: str, is_group: bool, msg: dict) -> str:
    text = msg.get("text")
    msg_type = msg.get("type")
    sender = (msg.get("sender") or "").strip() or name
    from_me = bool(msg.get("from_me"))

    if msg_type == "media":
        body = "[media]"
    elif text is None:
        body = "[empty]"
    else:
        body = str(text).replace("\n", " ").strip()
        if not body:
            body = "[empty]"

    body = body[:200] + ("…" if len(body) > 200 else "")

    if from_me:
        return f"Me: {body}"
    if is_group:
        return f"{sender}: {body}"
    return f"{name}: {body}"


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    if not INDEX_PATH.exists():
        OUT_PATH.write_text(
            json.dumps({"generated_at": None, "chats": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print("No output/index.json found. Wrote empty chats table.")
        return

    try:
        index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"Failed to read index: {e}", file=sys.stderr)
        sys.exit(1)

    rows = []
    for entry in index if isinstance(index, list) else []:
        if not isinstance(entry, dict):
            continue
        rel = (entry.get("file") or "").strip()
        if not rel:
            continue
        path = ROOT / "output" / rel.replace("\\", "/")
        if not path.exists():
            continue
        try:
            first_line, last_line = read_first_last_jsonl(path)
        except OSError:
            continue
        if not first_line or not last_line:
            continue

        try:
            first_msg = json.loads(first_line)
            last_msg = json.loads(last_line)
        except json.JSONDecodeError:
            continue

        name = (entry.get("name") or "").strip() or (entry.get("jid") or "Unknown")
        is_group = entry.get("type") == "group"
        earliest = (first_msg.get("timestamp") or "")[:10] or None
        latest = (last_msg.get("timestamp") or "")[:10] or None

        rows.append(
            {
                "name": name,
                "jid": entry.get("jid") or "",
                "type": entry.get("type") or "dm",
                "lastMessage": to_last_message_preview(name, is_group, last_msg),
                "earliestMessageDate": earliest,
                "latestMessageDate": latest,
                "totalMessages": int(entry.get("total_messages") or 0),
            }
        )

    rows.sort(key=lambda r: ((r.get("latestMessageDate") or ""), r.get("name") or ""), reverse=True)
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    OUT_PATH.write_text(
        json.dumps({"generated_at": generated_at, "chats": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {len(rows)} chat row(s) -> {OUT_PATH.relative_to(ROOT)}")

    contacts_payload = {"generated_at": generated_at, "contacts": []}
    groups_payload = {"generated_at": generated_at, "groups": []}
    if CONTACTS_SRC.exists():
        try:
            data = json.loads(CONTACTS_SRC.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                contacts_payload = data
        except (OSError, json.JSONDecodeError) as e:
            print(f"Could not read contacts source: {e}", file=sys.stderr)
    if GROUPS_SRC.exists():
        try:
            data = json.loads(GROUPS_SRC.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                groups_payload = data
        except (OSError, json.JSONDecodeError) as e:
            print(f"Could not read groups source: {e}", file=sys.stderr)

    CONTACTS_OUT.write_text(json.dumps(contacts_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    GROUPS_OUT.write_text(json.dumps(groups_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Published contacts -> {CONTACTS_OUT.relative_to(ROOT)}")
    print(f"Published groups -> {GROUPS_OUT.relative_to(ROOT)}")

    # Temporary compatibility: keep old watchlist endpoint for any stale consumers.
    contacts = contacts_payload.get("contacts") if isinstance(contacts_payload, dict) else []
    legacy_rows = []
    for c in contacts if isinstance(contacts, list) else []:
        if not isinstance(c, dict):
            continue
        if not bool(c.get("on_watchlist")):
            continue
        legacy_rows.append(
            {
                "jid": c.get("jid") or "",
                "name": c.get("name") or "",
                "category": c.get("category") or "personal",
            }
        )
    WATCHLIST_OUT.write_text(
        json.dumps({"chats": legacy_rows, "_meta": {"generated": generated_at, "source": "contacts"}}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote compatibility watchlist -> {WATCHLIST_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
