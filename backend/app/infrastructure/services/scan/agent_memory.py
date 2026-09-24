from __future__ import annotations
import json
import time
from pathlib import Path
from typing import Any

from app.core.config import get_settings

# Greptile-style local agent memory: per-repo, file-backed, bounded, hallucinations-aware
# Agents remember: past findings, false-positive fingerprints, path evidence that was rejected

_MEMORY_TTL_SECONDS = 7 * 24 * 3600  # 7 days
_MAX_ENTRIES = 200

def _memory_file() -> Path:
    settings = get_settings()
    base = Path(settings.artifacts_dir).expanduser().resolve()
    base.mkdir(parents=True, exist_ok=True)
    return base / "agent-memory.json"

def _load_raw() -> dict:
    p = _memory_file()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}

def _save_raw(data: dict) -> None:
    p = _memory_file()
    try:
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

def remember_scan(source_fingerprint: str, findings: list[dict], feedback: dict | None = None) -> None:
    """Store scan outcome for future grounding — local only, no external leakage"""
    data = _load_raw()
    key = str(source_fingerprint).strip()
    if not key:
        return
    now = time.time()
    # prune old
    for k in list(data.keys()):
        if now - float(data[k].get("_ts", 0)) > _MEMORY_TTL_SECONDS:
            del data[k]
    entry = {
        "_ts": now,
        "findings": findings[:12],
        "feedback": feedback or {},
    }
    data[key] = entry
    # bound total keys
    if len(data) > _MAX_ENTRIES:
        sorted_keys = sorted(data.keys(), key=lambda k: float(data[k].get("_ts", 0)))
        for k in sorted_keys[: len(data) - _MAX_ENTRIES]:
            del data[k]
    _save_raw(data)

def recall_scan(source_fingerprint: str) -> dict | None:
    data = _load_raw()
    return data.get(str(source_fingerprint).strip())

def hallucination_guard(findings: list[dict], source_fingerprint: str) -> list[dict]:
    """Suppress findings that look like repeats of previously rejected false positives"""
    memory = recall_scan(source_fingerprint)
    if not memory:
        return findings
    rejected = set()
    for fp in memory.get("feedback", {}).get("rejected_fingerprints", []):
        rejected.add(str(fp).strip().lower())
    if not rejected:
        return findings
    filtered: list[dict] = []
    for f in findings:
        fp = f"{f.get('file','')}:{f.get('title','')}".strip().lower()
        if fp in rejected:
            continue
        filtered.append(f)
    return filtered

def mark_rejected(source_fingerprint: str, fingerprints: list[str]) -> None:
    data = _load_raw()
    key = str(source_fingerprint).strip()
    entry = data.get(key, {"_ts": time.time(), "findings": [], "feedback": {}})
    fb = entry.get("feedback", {})
    existing = set(str(x).strip().lower() for x in fb.get("rejected_fingerprints", []))
    for fp in fingerprints:
        existing.add(str(fp).strip().lower())
    fb["rejected_fingerprints"] = sorted(existing)[-50:]
    entry["feedback"] = fb
    entry["_ts"] = time.time()
    data[key] = entry
    _save_raw(data)
