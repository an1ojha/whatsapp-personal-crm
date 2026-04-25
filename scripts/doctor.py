#!/usr/bin/env python3
"""Check whether the local Mac setup can run the WhatsApp CRM."""

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = Path.home() / "Library" / "Group Containers" / "group.net.whatsapp.WhatsApp.shared" / "ChatStorage.sqlite"


def read_env() -> dict[str, str]:
    env_path = ROOT / ".env"
    values: dict[str, str] = {}
    if not env_path.exists():
        return values
    for raw in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def status(label: str, ok: bool, detail: str = "") -> bool:
    mark = "ok" if ok else "missing"
    suffix = f" - {detail}" if detail else ""
    print(f"[{mark}] {label}{suffix}")
    return ok


def command_ok(command: str, args: Optional[list[str]] = None) -> bool:
    exe = shutil.which(command)
    if not exe:
        return False
    if not args:
        return True
    try:
        subprocess.run([exe, *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except subprocess.SubprocessError:
        return False


def main() -> int:
    env = read_env()
    db_path = Path(env.get("WHATSAPP_DB_PATH") or os.environ.get("WHATSAPP_DB_PATH") or DEFAULT_DB_PATH).expanduser()

    checks = [
        status("macOS", platform.system() == "Darwin", platform.platform()),
        status("python3", command_ok("python3", ["--version"])),
        status("npm", command_ok("npm", ["--version"])),
        status("sqlite3", command_ok("sqlite3", ["--version"])),
        status("virtualenv", (ROOT / ".venv" / "bin" / "python").exists(), ".venv/bin/python"),
        status("node modules", (ROOT / "node_modules").exists(), "node_modules"),
        status(".env", (ROOT / ".env").exists(), ".env"),
        status("Anthropic key", bool(env.get("ANTHROPIC_API_KEY", "").startswith("sk-ant-")), "ANTHROPIC_API_KEY"),
        status("WhatsApp database", db_path.exists(), str(db_path)),
    ]

    print()
    if all(checks):
        print("Ready. Run `npm run sync`, then `npm run dev`.")
        return 0

    print("Not ready yet. Fix the missing items above, then run `npm run doctor` again.")
    print("If WhatsApp is missing, install WhatsApp Desktop from the Mac App Store and log in once.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
