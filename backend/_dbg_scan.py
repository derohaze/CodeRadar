import asyncio, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / "tests"))
from test_code_review_effectiveness import FLAWED_PYTHON, ScriptedReviewer, _scan_file  # noqa: E402
import app.infrastructure.services.scan.scan_execution_service as ses  # noqa: E402

orig_filter = ses.filter_validated_findings


def traced_filter(findings, source_root, files, traced_paths):
    print(f"  [filter] in={len(findings)}")
    for f in findings:
        print(
            "    -",
            repr(str(f.get("title", ""))[:52]),
            "src=", bool(str(f.get("source_hint", "")).strip()),
            "sink=", bool(str(f.get("sink_hint", "")).strip()),
            "path=", bool(str(f.get("path_hint", "")).strip()),
            "file=", f.get("file"),
            "line=", f.get("line"),
        )
    out = orig_filter(findings, source_root, files, traced_paths)
    print(f"  [filter] out={len(out)}")
    return out


ses.filter_validated_findings = traced_filter

orig_review = ScriptedReviewer.review_paths


async def traced_review(self, *a, **kw):
    r = await orig_review(self, *a, **kw)
    items = kw.get("work_items") if "work_items" in kw else (a[4] if len(a) > 4 else [])
    print(f"  [review_paths] returned {len(r.get('findings', []))} findings; work_items={len(items)}")
    return r


ScriptedReviewer.review_paths = traced_review

orig_val = ScriptedReviewer.validate_findings


async def traced_val(self, *a, **kw):
    r = await orig_val(self, *a, **kw)
    print(f"  [validate_findings] kept {len(r.get('findings', []))}")
    return r


ScriptedReviewer.validate_findings = traced_val


async def main():
    tmp = Path(tempfile.mkdtemp())
    src = tmp / "flawed.py"
    src.write_text(FLAWED_PYTHON, encoding="utf-8")
    print("=== SCAN START ===")
    session, _repo = await _scan_file(src, ScriptedReviewer())
    print("=== SCAN DONE ===")
    print("status:", session.status)
    print("findings:", len(session.findings))
    print("candidates:", len(session.candidate_findings))
    print("annotations:", len(session.annotations))
    print("is_safe:", session.is_safe)
    print("logs:")
    for line in session.progress_logs:
        print("   -", line)


asyncio.run(main())
