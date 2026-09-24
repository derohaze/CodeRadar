from pathlib import Path

from app.domain.entities.scan import FindingEntity
from app.infrastructure.services.repository.repository_analysis import (
    SUPPORTED_EXTENSIONS,
    extract_relevant_excerpt,
    prioritize_files_for_analysis,
    read_text,
    relative_path,
)


BLOCK_TARGET_LINES = 90
BLOCK_MAX_LINES = 150
MAX_SEGMENTED_FILES_FAST = 240
MAX_SEGMENTED_FILES_DEEP = 600
MAX_BLOCKS_PER_FILE_FAST = 32
MAX_BLOCKS_PER_FILE_DEEP = 16


def build_file_segments(files: list[Path], source_root: Path, scan_mode: str = "fast") -> list[dict]:
    segments: list[dict] = []
    max_files = MAX_SEGMENTED_FILES_DEEP if scan_mode == "deep" else MAX_SEGMENTED_FILES_FAST
    for path in prioritize_files_for_analysis(files, max_files):
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue

        file_path = relative_path(path, source_root)
        text = read_text(path)
        blocks = segment_file(file_path, text, scan_mode=scan_mode)
        segments.append(
            {
                "file": file_path,
                "line_count": len(text.splitlines()),
                "block_count": len(blocks),
                "blocks": blocks if scan_mode == "deep" else blocks[:12],
                "focuses": summarize_block_focuses(blocks)[:8],
            }
        )
    return sorted(segments, key=lambda item: (-item["line_count"], item["file"]))


def build_segment_work_items(
    files: list[Path],
    source_root: Path,
    repository_artifacts: dict,
    repository_map: dict,
    file_segments: list[dict],
    target_type: str,
    scan_mode: str = "fast",
) -> list[dict[str, str]]:
    path_lookup = {relative_path(path, source_root): path for path in files if path.suffix.lower() in SUPPORTED_EXTENSIONS}
    hotspot_lookup = {item["file"]: item for item in repository_artifacts["hotspot_files"]}
    segment_lookup = {item["file"]: item for item in file_segments}
    selected_files: list[str] = []

    for item in repository_map.get("priority_paths", []):
        file_path = str(item.get("file", "")).strip()
        if file_path in path_lookup and file_path not in selected_files:
            selected_files.append(file_path)

    for item in repository_artifacts["hotspot_files"]:
        if item["file"] not in selected_files:
            selected_files.append(item["file"])

    if scan_mode == "deep":
        for file_path in sorted(path_lookup):
            if file_path not in selected_files:
                selected_files.append(file_path)

    file_limit = 24 if target_type == "folder" else 1
    if scan_mode == "deep":
        file_limit = len(selected_files) if selected_files else len(path_lookup)
    work_items: list[dict[str, str]] = []
    for file_path in selected_files[:file_limit]:
        path = path_lookup.get(file_path)
        segment_info = segment_lookup.get(file_path)
        hotspot = hotspot_lookup.get(file_path, {})
        if path is None or segment_info is None:
            continue

        blocks = segment_info["blocks"]
        block_limit = len(blocks) if target_type == "file" or scan_mode == "deep" else min(len(blocks), 5)
        for block in blocks[:block_limit]:
            work_items.append(
                {
                    "file": file_path,
                    "signal_score": str(hotspot.get("score", 1)),
                    "rationale": ", ".join(hotspot.get("reasons", [])[:4]) or "security-relevant code path",
                    "imports": ", ".join(hotspot.get("imports", [])[:6]),
                    "related_attack_surface": lookup_attack_surface(file_path, repository_map),
                    "review_focus": lookup_review_focus(file_path, repository_map),
                    "block_id": str(block["block_id"]),
                    "block_kind": str(block["kind"]),
                    "start_line": str(block["start_line"]),
                    "end_line": str(block["end_line"]),
                    "snippet": str(block["snippet"]),
                }
            )

    if not work_items and files:
        path = files[0]
        file_path = relative_path(path, source_root)
        text = read_text(path)
        work_items.append(
            {
                "file": file_path,
                "signal_score": "1",
                "rationale": "selected file context",
                "imports": "",
                "related_attack_surface": "selected scope",
                "review_focus": "review the most security-sensitive flows in this file",
                "block_id": "fallback-1",
                "block_kind": "window",
                "start_line": "1",
                "end_line": str(min(len(text.splitlines()), BLOCK_MAX_LINES)),
                "snippet": extract_relevant_excerpt(text),
            }
        )

    return work_items


def segment_file(file_path: str, text: str, scan_mode: str = "fast") -> list[dict]:
    lines = text.splitlines()
    if not lines:
        return []

    windows: list[dict] = []
    max_blocks = MAX_BLOCKS_PER_FILE_DEEP if scan_mode == "deep" else MAX_BLOCKS_PER_FILE_FAST
    for start in range(0, len(lines), BLOCK_TARGET_LINES):
        end = min(len(lines), start + BLOCK_MAX_LINES)
        snippet = "\n".join(f"{start + line_index + 1}: {line}" for line_index, line in enumerate(lines[start:end]))
        windows.append(
            {
                "block_id": f"{file_path}:{len(windows) + 1}",
                "kind": "window",
                "start_line": start + 1,
                "end_line": end,
                "focuses": detect_focuses("\n".join(lines[start:end])),
                "snippet": snippet or extract_relevant_excerpt(text),
            }
        )
        if len(windows) >= max_blocks:
            break
    return windows


def summarize_block_focuses(blocks: list[dict]) -> list[str]:
    counts: dict[str, int] = {}
    for block in blocks:
        for focus in block.get("focuses", []):
            counts[focus] = counts.get(focus, 0) + 1
    return [item[0] for item in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))]


def detect_focuses(text: str) -> list[str]:
    lowered = text.lower()
    focuses: list[str] = []
    if any(token in lowered for token in ("request", "router", "app.get", "app.post", "query", "params", "body")):
        focuses.append("request flow")
    if any(token in lowered for token in ("jwt", "authorization", "bearer", "session", "token")):
        focuses.append("auth")
    if any(token in lowered for token in ("subprocess", "os.system", "exec(", "eval(")):
        focuses.append("command execution")
    if any(token in lowered for token in ("requests.", "httpx.", "fetch(", "axios.")):
        focuses.append("network")
    if any(token in lowered for token in ("send_file", "fileresponse", "open(", "path.join", "os.path.join")):
        focuses.append("filesystem")
    if any(token in lowered for token in ("execute(", "query(", "$where", "cursor.execute")):
        focuses.append("database")
    if any(token in lowered for token in ("pickle", "yaml.load", "deserialize")):
        focuses.append("deserialization")
    return focuses


def build_coverage_snapshot(
    profile: dict,
    repository_artifacts: dict,
    file_segments: list[dict],
    work_items: list[dict[str, str]],
    findings: list[FindingEntity],
    scan_mode: str = "fast",
    path_units: list[dict] | None = None,
) -> dict:
    # Coverage is measured against every supported indexed file, not only files
    # that produced non-empty segments. A folder review must make omissions visible.
    eligible_files = int(profile.get("file_count", len(file_segments)) or len(file_segments))
    non_reviewable_files = [
        {
            "file": item["file"],
            "reason": "Empty file" if int(item.get("line_count", 0)) == 0 else "No reviewable code block",
        }
        for item in file_segments
        if int(item.get("block_count", 0)) == 0
    ]
    reviewed_file_names = {item["file"] for item in work_items}
    reviewed_file_names.update(item["file"] for item in non_reviewable_files)
    reviewed_files = min(eligible_files, len(reviewed_file_names))
    total_blocks = sum(item["block_count"] for item in file_segments)
    reviewed_blocks = len({item["block_id"] for item in work_items})
    total_lines = sum(item["line_count"] for item in file_segments)
    raw_reviewed_lines = sum(int(item["end_line"]) - int(item["start_line"]) + 1 for item in work_items)
    reviewed_lines = min(raw_reviewed_lines, total_lines)
    total_paths = len(path_units or [])
    traced_paths = total_paths
    file_ratio = reviewed_files / max(eligible_files, 1)
    block_ratio = reviewed_blocks / max(total_blocks, 1)
    path_ratio = traced_paths / max(total_paths, 1) if total_paths else 1.0
    weighted_ratio = (file_ratio * 0.45) + (block_ratio * 0.35) + (path_ratio * 0.20)
    coverage_percent = 100 if eligible_files == 0 else round(min(100, weighted_ratio * 100))
    coverage_summary = (
        f"{'Deep' if scan_mode == 'deep' else 'Fast'} coverage: reviewed {reviewed_files} of {eligible_files} supported files "
        f"({coverage_percent} percent), covering {reviewed_blocks} of {max(total_blocks, 1)} code blocks, "
        f"{reviewed_lines} of {max(total_lines, 1)} lines, and {traced_paths} of {max(total_paths, 1)} traced paths."
    )
    if non_reviewable_files:
        coverage_summary += (
            f" {len(non_reviewable_files)} file(s) were excluded from block review because they had no reviewable code blocks."
        )
    if scan_mode == "deep" and reviewed_files < eligible_files:
        coverage_summary += (
            f" Remaining gap: {max(0, eligible_files - reviewed_files)} files and "
            f"{max(0, total_blocks - reviewed_blocks)} blocks were not fully reviewed yet."
        )
    return {
        "coverage_percent": coverage_percent,
        "coverage_summary": coverage_summary,
        "scan_mode": scan_mode,
        "reviewed_files_count": reviewed_files,
        "eligible_files_count": eligible_files,
        "reviewed_blocks_count": reviewed_blocks,
        "total_blocks_count": total_blocks,
        "reviewed_lines_count": reviewed_lines,
        "total_lines_count": total_lines,
        "traced_paths_count": traced_paths,
        "total_paths_count": total_paths,
        "skipped_files_count": max(0, eligible_files - reviewed_files),
        "excluded_files": non_reviewable_files + [
            {
                "file": str(item.get("file", "")),
                "reason": "Not included in the review work queue",
            }
            for item in file_segments
            if item.get("file") not in reviewed_file_names and int(item.get("block_count", 0)) > 0
        ],
        "high_risk_files_count": len([item for item in repository_artifacts["hotspot_files"] if item["score"] >= 8]),
        "confirmed_findings_count": len(findings),
    }


def score_with_coverage(findings: list[FindingEntity], coverage_snapshot: dict) -> int:
    coverage_percent = int(coverage_snapshot["coverage_percent"])
    if not findings:
        if coverage_percent >= 90:
            return 100
        if coverage_percent >= 75:
            return min(99, 94 + round((coverage_percent - 75) / 3))
        return max(70, min(93, 70 + round(coverage_percent * 0.3)))

    severity_weights = {"critical": 28, "high": 18, "medium": 10, "low": 4}
    penalty = 0.0
    for finding in findings:
        penalty += severity_weights.get(finding.severity, 10) * max(0.6, finding.confidence / 100)

    base_score = round(100 - penalty)
    coverage_bonus = min(6, coverage_percent // 20)
    return max(0, min(100, base_score + coverage_bonus))


def lookup_attack_surface(file_path: str, repository_map: dict) -> str:
    for item in repository_map.get("priority_paths", []):
        if str(item.get("file")) == file_path:
            return str(item.get("attack_surface", "selected scope"))
    return "selected scope"


def lookup_review_focus(file_path: str, repository_map: dict) -> str:
    for item in repository_map.get("priority_paths", []):
        if str(item.get("file")) == file_path:
            return str(item.get("review_focus", "review the strongest trust-boundary risks"))
    return "review the strongest trust-boundary risks"
