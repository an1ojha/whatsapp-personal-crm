#!/usr/bin/env python3
"""
WhatsApp Desktop chat history exporter.
Reads directly from WhatsApp Mac's SQLite database.

New layout (default):
  output/chats/{jid_safe}.jsonl  — one JSON object per line (append-only, includes Z_PK)
  output/state.json              — watermarks { jid: { last_pk, name, ... } }
  output/deltas/{run_id}.json    — messages new in this run (incremental)
  output/index.json              — per-chat index (path under chats/)

Usage:
  python3 export.py                 # incremental when state exists; else full backfill
  python3 export.py --full          # wipe chats jsonl, rebuild from DB
  python3 export.py --chat "Alice"
  python3 export.py --since 2024-01-01
"""

import sqlite3
import json
import sys
import re
import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # export.py can still run before setup installs python-dotenv
    load_dotenv = None

COCOA_OFFSET = 978307200
ROOT = Path(__file__).parent
if load_dotenv:
    load_dotenv(ROOT / ".env")
DEFAULT_DB_PATH = Path.home() / "Library" / "Group Containers" / "group.net.whatsapp.WhatsApp.shared" / "ChatStorage.sqlite"
DB_PATH = Path(os.environ.get("WHATSAPP_DB_PATH") or DEFAULT_DB_PATH).expanduser()
OUTPUT_DIR = ROOT / "output"
CHATS_DIR = OUTPUT_DIR / "chats"
DELTAS_DIR = OUTPUT_DIR / "deltas"
STATE_PATH = OUTPUT_DIR / "state.json"
INDEX_PATH = OUTPUT_DIR / "index.json"

MEDIA_TYPES = {1, 2, 3, 4, 5, 7, 8, 9, 13, 16, 26}

STATE_VERSION = 1


def cocoa_to_dt(ts):
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts + COCOA_OFFSET)
    except (OSError, OverflowError, ValueError):
        return None


def fmt_timestamp(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S") if dt else None


def fmt_human(dt):
    if not dt:
        return "unknown"
    hour = dt.strftime("%I").lstrip("0") or "12"
    minute = dt.strftime("%M")
    ampm = dt.strftime("%p").lower()
    return dt.strftime(f"%b {dt.day}, %Y {hour}:{minute}{ampm}")


def sanitize_filename(s):
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", s)
    return s.strip(". ") or "unknown"


def jid_safe(jid, session_pk):
    if not jid or not str(jid).strip():
        return f"session_{session_pk}"
    j = re.sub(r"[^a-zA-Z0-9._-]+", "_", str(jid).strip())
    return j if j else f"session_{session_pk}"


def extract_phone(jid):
    if jid:
        m = re.match(r"^(\d+)@", jid)
        if m:
            return m.group(1)
    return None


def load_state():
    if not STATE_PATH.exists():
        return {"version": STATE_VERSION, "last_run": None, "chats": {}}
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if "chats" not in data:
            data["chats"] = {}
        data["version"] = data.get("version", STATE_VERSION)
        return data
    except (json.JSONDecodeError, OSError):
        return {"version": STATE_VERSION, "last_run": None, "chats": {}}


def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def message_obj(row, pk, is_group, name, pushname_map):
    dt = cocoa_to_dt(row["ZMESSAGEDATE"])
    from_me = bool(row["ZISFROMME"])
    text = row["ZTEXT"]
    from_jid = row["ZFROMJID"]
    msg_type_num = row["ZMESSAGETYPE"] or 0
    has_media = row["ZMEDIAITEM"] is not None

    if from_me:
        sender = "Me"
    elif is_group:
        sender = pushname_map.get(from_jid) or extract_phone(from_jid) or from_jid or "Unknown"
    else:
        sender = name

    if text is not None:
        msg_type = "text"
    elif has_media or msg_type_num in MEDIA_TYPES:
        msg_type = "media"
    else:
        msg_type = "system"

    return {
        "pk": pk,
        "timestamp": fmt_timestamp(dt),
        "from_me": from_me,
        "sender": sender,
        "text": text,
        "type": msg_type,
    }, dt


def append_jsonl(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def write_jsonl_overwrite(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def stat_jsonl(path):
    """Return (count, first_ts, last_ts) from a jsonl file; all None if missing/empty."""
    if not path.exists() or not path.stat().st_size:
        return 0, None, None
    first_ts = last_ts = None
    n = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            n += 1
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = o.get("timestamp")
            if t:
                if first_ts is None:
                    first_ts = t[:10]
                last_ts = t[:10]
    return n, first_ts, last_ts


def main():
    parser = argparse.ArgumentParser(description="Export WhatsApp Desktop chat history")
    parser.add_argument(
        "preset",
        nargs="*",
        default=[],
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Delete output/chats/*.jsonl and re-export all messages from DB.",
    )
    parser.add_argument(
        "--chat",
        help="Export only chats matching this name (partial, case-insensitive)",
    )
    parser.add_argument(
        "--since",
        metavar="YYYY-MM-DD",
        help="Only include messages on or after this date (Cocoa filter on message date).",
    )
    args = parser.parse_args()

    state = load_state()
    is_full = bool(args.full)
    if not is_full and not STATE_PATH.exists():
        is_full = True
        print("No state file — running full backfill.")

    since_cocoa = None
    if args.since:
        try:
            since_dt = datetime.strptime(args.since, "%Y-%m-%d")
            since_cocoa = since_dt.timestamp() - COCOA_OFFSET
        except ValueError:
            print(f"Error: --since must be YYYY-MM-DD, got: {args.since!r}")
            sys.exit(1)

    if not DB_PATH.exists():
        print(f"Error: WhatsApp database not found at:\n  {DB_PATH}")
        sys.exit(1)

    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    DELTAS_DIR.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute(
        "SELECT ZJID, ZPUSHNAME FROM ZWAPROFILEPUSHNAME WHERE ZPUSHNAME IS NOT NULL AND ZPUSHNAME != ''"
    )
    pushname_map = {r["ZJID"]: r["ZPUSHNAME"] for r in cur.fetchall()}

    cur.execute(
        """
        SELECT Z_PK, ZSESSIONTYPE, ZCONTACTJID, ZPARTNERNAME
        FROM ZWACHATSESSION
        WHERE ZSESSIONTYPE IN (0, 1)
        ORDER BY ZLASTMESSAGEDATE DESC
        """
    )
    sessions = list(cur.fetchall())

    if args.chat:
        needle = args.chat.lower()
        sessions = [
            s
            for s in sessions
            if needle in (s["ZPARTNERNAME"] or "").lower()
            or needle in (s["ZCONTACTJID"] or "").lower()
        ]
        if not sessions:
            print(f"No chats found matching: {args.chat!r}")
            sys.exit(0)

    total = len(sessions)
    print(f"Mode: {'full' if is_full else 'incremental'} — {total} chat sessions\n")

    if is_full:
        state["chats"] = {}
        if CHATS_DIR.exists():
            for p in CHATS_DIR.glob("*.jsonl"):
                try:
                    p.unlink()
                except OSError:
                    pass

    delta_chats = {}
    index = []
    total_msgs = 0
    exported = 0

    for i, s in enumerate(sessions):
        session_pk = s["Z_PK"]
        is_group = s["ZSESSIONTYPE"] == 1
        jid = (s["ZCONTACTJID"] or "").strip() or f"session_{session_pk}"
        name = (s["ZPARTNERNAME"] or "").strip()
        if not name:
            name = extract_phone(jid) or jid
        jkey = jid_safe(jid, session_pk)
        st_c = state["chats"].get(jid, {})
        last_pk = int(st_c.get("last_pk", 0) or 0)
        jsonl_path = CHATS_DIR / f"{jkey}.jsonl"
        if not is_full and last_pk > 0 and not jsonl_path.exists():
            last_pk = 0

        params = [session_pk]
        clauses = []
        if not is_full and last_pk > 0:
            clauses.append("m.Z_PK > ?")
            params.append(last_pk)
        if since_cocoa is not None:
            clauses.append("m.ZMESSAGEDATE >= ?")
            params.append(since_cocoa)
        where_extra = f"AND {' AND '.join(clauses)}" if clauses else ""

        cur.execute(
            f"""
            SELECT
                m.Z_PK,
                m.ZMESSAGEDATE,
                m.ZISFROMME,
                m.ZTEXT,
                m.ZFROMJID,
                m.ZMESSAGETYPE,
                m.ZMEDIAITEM
            FROM ZWAMESSAGE m
            WHERE m.ZCHATSESSION = ?
            {where_extra}
            ORDER BY m.ZMESSAGEDATE ASC, m.Z_PK ASC
            """,
            params,
        )
        rows = cur.fetchall()

        print(f"[{i+1}/{total}] {name}... ({len(rows)} new rows)")

        if not rows and not is_full:
            n, first_t, last_t = stat_jsonl(CHATS_DIR / f"{jkey}.jsonl")
            if n:
                index.append(
                    {
                        "name": name,
                        "type": "group" if is_group else "dm",
                        "jid": jid,
                        "jkey": jkey,
                        "total_messages": n,
                        "first_message": first_t,
                        "last_message": last_t,
                        "file": f"chats/{jkey}.jsonl",
                    }
                )
            continue

        if is_full and rows:
            out_path = CHATS_DIR / f"{jkey}.jsonl"
            batch = []
            max_pk = 0
            for row in rows:
                pk = int(row["Z_PK"])
                max_pk = max(max_pk, pk)
                o, _ = message_obj(row, pk, is_group, name, pushname_map)
                batch.append(o)
            write_jsonl_overwrite(out_path, batch)
            delta_chats[jid] = {"name": name, "jkey": jkey, "messages": batch}
            last_date = None
            if batch:
                last_date = batch[-1]["timestamp"][:10] if batch[-1].get("timestamp") else None
            state["chats"][jid] = {
                "name": name,
                "jkey": jkey,
                "last_pk": max_pk,
                "last_message_date": last_date,
            }
        elif not is_full and rows:
            out_path = CHATS_DIR / f"{jkey}.jsonl"
            batch = []
            max_pk = last_pk
            for row in rows:
                pk = int(row["Z_PK"])
                max_pk = max(max_pk, pk)
                o, _ = message_obj(row, pk, is_group, name, pushname_map)
                batch.append(o)
            append_jsonl(out_path, batch)
            delta_chats[jid] = {"name": name, "jkey": jkey, "messages": batch}
            n, _first, last_t = stat_jsonl(out_path)
            last_date = last_t
            if batch and not last_date and batch[-1].get("timestamp"):
                last_date = batch[-1]["timestamp"][:10]
            state["chats"][jid] = {
                "name": name,
                "jkey": jkey,
                "last_pk": max_pk,
                "last_message_date": last_date,
            }
        else:
            continue

        n, first_t, last_t = stat_jsonl(CHATS_DIR / f"{jkey}.jsonl")
        index.append(
            {
                "name": name,
                "type": "group" if is_group else "dm",
                "jid": jid,
                "jkey": jkey,
                "total_messages": n,
                "first_message": first_t,
                "last_message": last_t,
                "file": f"chats/{jkey}.jsonl",
            }
        )
        total_msgs += len(rows)
        exported += 1

    if not is_full and INDEX_PATH.exists():
        try:
            with open(INDEX_PATH, encoding="utf-8") as f:
                prev = json.load(f)
            if isinstance(prev, list):
                by_j = {e["jid"]: e for e in prev if isinstance(e, dict) and e.get("jid")}
                for e in index:
                    if e.get("jid"):
                        by_j[e["jid"]] = e
                index = list(by_j.values())
        except (json.JSONDecodeError, OSError, TypeError):
            pass

    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    state["last_run"] = run_id
    save_state(state)

    delta_path = DELTAS_DIR / f"{run_id}.json"
    with open(delta_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "run_id": run_id,
                "mode": "full" if is_full else "incremental",
                "chats": delta_chats,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    conn.close()

    print(f"\n{'=' * 50}")
    print(f"Done: {exported} chat(s) with new/rewritten data, {total_msgs:,} message rows this run")
    print(f"Output: {OUTPUT_DIR}")
    print(f"Delta: {delta_path.name}")


if __name__ == "__main__":
    main()
