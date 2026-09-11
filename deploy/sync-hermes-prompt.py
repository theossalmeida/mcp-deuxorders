"""Install SOUL and invalidate saved prompts, preserving conversation history.

Run with the installed Hermes Python environment. Updating SOUL alone does not
refresh ordinary WhatsApp sessions: Hermes restores their saved system prompt.
"""
import json
import os
from pathlib import Path
import shutil
import sys
from datetime import datetime

home = Path(os.environ.get("HERMES_HOME") or Path(os.environ["LOCALAPPDATA"]) / "hermes")
source = Path(__file__).resolve().parent.parent / "HERMES_SOUL.md"
sys.path.insert(0, str(home / "hermes-agent"))
from hermes_state import SessionDB

backup = home / "backups" / ("prompt-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
backup.mkdir(parents=True)
if (home / "SOUL.md").exists():
    shutil.copy2(home / "SOUL.md", backup / "SOUL.md")

index_path = home / "sessions" / "sessions.json"
entries = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
session_ids = {entry["session_id"] for entry in entries.values()
               if isinstance(entry, dict) and entry.get("platform") == "whatsapp" and entry.get("session_id")}
db = SessionDB(home / "state.db")
try:
    snapshots = []
    for sid in session_ids:
        row = db.get_session(sid)
        if row:
            snapshots.append({"session_id": sid, "system_prompt": row.get("system_prompt")})
    (backup / "system-prompts.json").write_text(json.dumps(snapshots, ensure_ascii=False), encoding="utf-8")
    shutil.copy2(source, home / "SOUL.md")
    for snapshot in snapshots:
        db.update_system_prompt(snapshot["session_id"], None)
    print(f"Prompt instalado; cache de {len(snapshots)} conversas invalidado. Historico preservado.")
    print(f"Backup: {backup}")
finally:
    db.close()
