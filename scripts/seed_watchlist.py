#!/usr/bin/env python3
"""
Build canonical contacts/groups datasets from output/index.json.

Outputs:
  output/contacts.json
  output/groups.json

Compatibility:
  - Migrates watchlist flags from legacy watchlist.json if present.
  - Preserves existing contacts.json fields (on_watchlist/category/context).
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "output" / "index.json"
CONTACTS_PATH = ROOT / "output" / "contacts.json"
GROUPS_PATH = ROOT / "output" / "groups.json"
WATCHLIST_PATH = ROOT / "watchlist.json"


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def category_for(name: str) -> str:
    n = (name or "").lower()
    if re.search(r"family|moma|baba|papa|dadi|mom|dad", n):
        return "family"
    return "personal"


def norm_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in {"1", "true", "yes", "y"}
    if isinstance(v, (int, float)):
        return bool(v)
    return False


def normalize_relation(value) -> str:
    raw = re.sub(r"[^a-zA-Z ]+", " ", str(value or "").strip().lower())
    words = [w for w in raw.split() if w]
    if not words:
        return ""
    return " ".join(words[:2])


def normalize_context(context, legacy_relation):
    ctx = context if isinstance(context, dict) else {}
    relation = normalize_relation(ctx.get("relation") or legacy_relation or "")
    home_location = str(ctx.get("home_location") or "").strip()
    age_val = ctx.get("age")
    age = None
    if isinstance(age_val, int):
        age = age_val if 0 < age_val < 130 else None
    elif isinstance(age_val, str) and age_val.strip().isdigit():
        parsed = int(age_val.strip())
        age = parsed if 0 < parsed < 130 else None

    other_raw = str(ctx.get("other") or "").strip()
    other_words = other_raw.split()
    other = " ".join(other_words[:10])
    context_last_updated = str(ctx.get("context_last_updated") or "").strip() or None
    return {
        "relation": relation,
        "home_location": home_location,
        "age": age,
        "other": other,
        "context_last_updated": context_last_updated,
    }


def load_legacy_watchlist() -> dict:
    wl = read_json(WATCHLIST_PATH, {})
    raw = wl.get("chats") if isinstance(wl, dict) else wl
    out = {}
    if not isinstance(raw, list):
        return out
    for row in raw:
        if not isinstance(row, dict):
            continue
        jid = str(row.get("jid") or "").strip()
        if not jid:
            continue
        if jid.endswith("@g.us"):
            continue
        out[jid] = {
            "name": str(row.get("name") or "").strip(),
            "category": str(row.get("category") or "").strip().lower(),
            "on_watchlist": True,
        }
    return out


def map_existing_contacts() -> dict:
    data = read_json(CONTACTS_PATH, {})
    rows = data.get("contacts") if isinstance(data, dict) else None
    out = {}
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        jid = str(row.get("jid") or "").strip()
        if not jid:
            continue
        out[jid] = row
    return out


def is_group_jid(jid: str, typ: str) -> bool:
    if (typ or "").lower() == "group":
        return True
    return jid.endswith("@g.us")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build contacts/groups from output/index.json")
    ap.add_argument("--contacts-out", type=Path, default=CONTACTS_PATH, help="Contacts output JSON path.")
    ap.add_argument("--groups-out", type=Path, default=GROUPS_PATH, help="Groups output JSON path.")
    args = ap.parse_args()

    if not INDEX_PATH.exists():
        print(f"Missing {INDEX_PATH} — run `python3 export.py` first.", file=sys.stderr)
        sys.exit(1)

    index = read_json(INDEX_PATH, [])
    if not isinstance(index, list):
        print(f"Invalid index format in {INDEX_PATH}", file=sys.stderr)
        sys.exit(1)

    legacy_watchlist = load_legacy_watchlist()
    existing_contacts = map_existing_contacts()
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    contacts = []
    groups = []
    seen_contacts = set()
    seen_groups = set()

    for row in index:
        if not isinstance(row, dict):
            continue
        jid = str(row.get("jid") or "").strip()
        if not jid:
            continue
        name = str(row.get("name") or "").strip() or jid
        typ = str(row.get("type") or "").strip().lower()
        jkey = str(row.get("jkey") or "").strip()
        last_message = str(row.get("last_message") or "").strip()
        total_messages = int(row.get("total_messages") or 0)
        if is_group_jid(jid, typ):
            if jid in seen_groups:
                continue
            seen_groups.add(jid)
            groups.append(
                {
                    "jid": jid,
                    "jkey": jkey,
                    "name": name,
                    "last_message": last_message,
                    "total_messages": total_messages,
                    "updated_at": generated_at,
                }
            )
            continue

        if jid in seen_contacts:
            continue
        seen_contacts.add(jid)

        prev = existing_contacts.get(jid, {})
        legacy = legacy_watchlist.get(jid, {})
        category = (
            str(prev.get("category") or "").strip().lower()
            or str(legacy.get("category") or "").strip().lower()
            or category_for(name)
        )
        if category not in {"personal", "family", "startup", "logistics"}:
            category = category_for(name)

        contacts.append(
            {
                "jid": jid,
                "jkey": jkey,
                "name": name,
                "category": category,
                "on_watchlist": norm_bool(prev.get("on_watchlist")) or norm_bool(legacy.get("on_watchlist")),
                "context": normalize_context(prev.get("context"), prev.get("relation")),
                "context_last_pk": int(prev.get("context_last_pk") or prev.get("relation_last_pk") or 0),
                "last_message": last_message,
                "total_messages": total_messages,
                "updated_at": generated_at,
            }
        )

    contact_jids = {c["jid"] for c in contacts}
    group_jids = {g["jid"] for g in groups}
    overlap = sorted(contact_jids.intersection(group_jids))
    if overlap:
        print(f"ERROR: contact/group overlap detected for {len(overlap)} jid(s).", file=sys.stderr)
        sys.exit(1)

    contacts.sort(key=lambda r: (r.get("name") or "", r.get("jid") or ""))
    for row in contacts:
        if str(row.get("jid") or "").endswith("@g.us"):
            row["on_watchlist"] = False
    groups.sort(key=lambda r: (r.get("name") or "", r.get("jid") or ""))

    args.contacts_out.parent.mkdir(parents=True, exist_ok=True)
    args.groups_out.parent.mkdir(parents=True, exist_ok=True)
    args.contacts_out.write_text(
        json.dumps(
            {
                "generated_at": generated_at,
                "contacts": contacts,
                "_meta": {"count": len(contacts), "source": "index+legacy_watchlist_migration"},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    args.groups_out.write_text(
        json.dumps(
            {"generated_at": generated_at, "groups": groups, "_meta": {"count": len(groups), "source": "index"}},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(contacts)} contacts -> {args.contacts_out.relative_to(ROOT)}")
    print(f"Wrote {len(groups)} groups -> {args.groups_out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
