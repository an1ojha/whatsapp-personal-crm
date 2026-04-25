#!/usr/bin/env python3
"""
Flatten summaries/*.json into public/data/followups.json and public/data/summaries_index.json
"""

import json
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUMMARIES_DIR = ROOT / "summaries"
OUT_FU = ROOT / "public" / "data" / "followups.json"
OUT_IDX = ROOT / "public" / "data" / "summaries_index.json"
FOLLOWUP_STATE_PATH = ROOT / "output" / "followup_state.json"
CONTACTS_PATH = ROOT / "output" / "contacts.json"

URG_ORDER = {"today": 0, "tomorrow": 1, "week": 2, "next": 3}
FOLLOWUP_MAX_DAYS = 30


def main() -> None:
    items = []
    index_rows = []
    followup_state = {}
    watchlist_jids = set()
    try:
        contacts_payload = json.loads(CONTACTS_PATH.read_text(encoding="utf-8")) if CONTACTS_PATH.exists() else {}
    except (OSError, json.JSONDecodeError):
        contacts_payload = {}
    contacts = contacts_payload.get("contacts") if isinstance(contacts_payload, dict) else []
    for c in contacts if isinstance(contacts, list) else []:
        if not isinstance(c, dict):
            continue
        jid = str(c.get("jid") or "").strip()
        if not jid or jid.endswith("@g.us"):
            continue
        if bool(c.get("on_watchlist")):
            watchlist_jids.add(jid)
    if FOLLOWUP_STATE_PATH.exists():
        try:
            raw = json.loads(FOLLOWUP_STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                followup_state = raw.get("items") if isinstance(raw.get("items"), dict) else {}
        except (OSError, json.JSONDecodeError):
            followup_state = {}
    if not SUMMARIES_DIR.exists():
        SUMMARIES_DIR.mkdir(parents=True, exist_ok=True)

    for path in sorted(SUMMARIES_DIR.glob("*.json")):
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        name = (rec.get("name") or "").strip() or rec.get("jid", "unknown")
        jkey = rec.get("jkey") or path.stem
        jid = rec.get("jid", "")
        if str(jid).endswith("@g.us"):
            continue
        if jid and jid not in watchlist_jids:
            continue
        last_at = rec.get("last_summarized_at") or ""
        index_rows.append(
            {
                "jid": jid,
                "jkey": jkey,
                "name": name,
                "last_summarized_at": last_at,
                "summary_line": (rec.get("rolling_summary") or "")[:240],
            }
        )
        lmd = rec.get("last_message_date") or ""
        lmd_parsed = None
        if lmd and str(lmd) not in ("—", "-"):
            try:
                lmd_parsed = datetime.strptime(str(lmd)[:10], "%Y-%m-%d").date()
            except ValueError:
                lmd_parsed = None
        if lmd_parsed and (date.today() - lmd_parsed) > timedelta(days=FOLLOWUP_MAX_DAYS):
            continue
        for i, fu in enumerate(rec.get("followups") or []):
            if not isinstance(fu, dict):
                continue
            urg = (fu.get("urgency") or "week").lower()
            if urg not in URG_ORDER:
                urg = "week"
            cat = (fu.get("category") or "personal").lower()
            item = {
                "id": f"{jkey}_{i}",
                "name": name,
                "jid": jid,
                "jkey": jkey,
                "urgency": urg,
                "topic": fu.get("topic") or "",
                "category": cat if cat in ("startup", "personal", "family", "logistics") else "personal",
                "lastActive": fu.get("lastActive") or lmd or "—",
                "evidence_pk": fu.get("evidence_pk"),
                "evidence_timestamp": fu.get("evidence_timestamp"),
                "evidence_quote": fu.get("evidence_quote") or "",
                "confidence": fu.get("confidence"),
            }
            state = followup_state.get(item["id"]) if isinstance(followup_state, dict) else None
            status = (state or {}).get("status") if isinstance(state, dict) else None
            if status in {"done", "useless", "feedback"}:
                continue
            items.append(item)

    items.sort(key=lambda x: (URG_ORDER.get(x["urgency"], 9), x["name"], x["id"]))

    from datetime import timezone

    gen = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    OUT_FU.parent.mkdir(parents=True, exist_ok=True)
    OUT_FU.write_text(
        json.dumps({"generated_at": gen, "items": items}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    OUT_IDX.write_text(
        json.dumps({"generated_at": gen, "chats": index_rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {len(items)} follow-up item(s) -> {OUT_FU.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
