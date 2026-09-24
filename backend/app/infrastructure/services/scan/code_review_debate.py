"""Three-pass code review lane.

Ported from the `debate-review` skill (review-skills-master/skills/debate-review):

1. `code_reviewer`   - the main reviewer reads the code and reports defects.
2. `review_challenger` - a second reviewer tries to knock each finding down, and
   sweeps for gaps the first pass missed.
3. `review_arbiter`  - the main reviewer makes the final call: agreed, contested,
   or withdrawn.

The point of the second pass is precision, not volume. `refute` has the highest
bar: it needs evidence from the supplied code. A refutation with no evidence is
treated as a downgrade. Only `agreed` and `contested` findings reach the client.

This lane exists because the security lane models everything as a
source-to-sink path. Most of what a code reviewer reports - off-by-one, mutable
defaults, leaked handles, races, assignment-in-condition - has no source and no
sink, and the security filters were discarding all of it.
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.exceptions import ExternalAIServiceError

logger = logging.getLogger("codeguard.review")

MAX_REVIEW_FINDINGS = 15


class CodeReviewDebate:
    """Runs the three passes and returns findings anchored to file and line."""

    def __init__(self, detection_agent, logs: list[str] | None = None) -> None:
        self.detection_agent = detection_agent
        self.logs = logs if logs is not None else []

    async def run(
        self,
        *,
        project_name: str,
        source_path: str,
        repository_profile: dict,
        repository_map: dict,
        batches: list[list[dict]],
        preset: str,
        run_arbitration: bool = True,
    ) -> dict:
        if not batches:
            return {"summary": "", "findings": [], "debate_summary": {}, "degraded": False}

        findings: list[dict] = []
        summaries: list[str] = []
        degraded = False

        for index, batch in enumerate(batches, start=1):
            try:
                review = await self.detection_agent.review_code(
                    project_name=project_name,
                    source_path=source_path,
                    repository_profile=repository_profile,
                    repository_map=repository_map,
                    work_items=batch,
                    batch_index=index,
                    total_batches=len(batches),
                    preset=preset,
                )
            except (ExternalAIServiceError, TimeoutError) as exc:
                # A failed review must never be reported as a clean review.
                logger.warning("Code review pass %s failed; skipping the debate lane", index, exc_info=exc)
                self.logs.append("Code review pass was unavailable; report reflects the security lane only.")
                return {"summary": "", "findings": [], "debate_summary": {}, "degraded": True}

            if review.get("summary"):
                summaries.append(str(review["summary"]).strip())
            findings.extend(self._reindex(review.get("findings", []), len(findings)))

        # Anti-false-clean self check. A first pass that returns nothing on non-trivial
        # code is not trusted: the reviewer is re-run with a recall-biased second-look
        # prompt that deliberately hunts for a defect it might have skimmed past. Only a
        # clean result that survives the second look, or a trivial scope, is accepted.
        if not findings and self._batches_are_non_trivial(batches):
            self.logs.append("First pass returned no defect; running a recall-biased second look before accepting clean")
            recheck = await self._run_recheck(
                project_name=project_name,
                source_path=source_path,
                repository_profile=repository_profile,
                repository_map=repository_map,
                batches=batches,
                preset=preset,
            )
            recheck_findings = self._reindex(recheck.get("findings", []), 0, prefix="R")
            if recheck_findings:
                self.logs.append(
                    "Second look raised %s finding(s); sending them to the challenger." % len(recheck_findings)
                )
                findings = recheck_findings[:MAX_REVIEW_FINDINGS]
                if recheck.get("summary"):
                    summaries.append(str(recheck["summary"]).strip())
            else:
                self.logs.append("Second look confirmed the clean verdict.")

        if not findings:
            summary = summaries[0] if summaries else ""
            self.logs.append("Code review found no defect that cleared the bar.")
            return {"summary": summary, "findings": [], "debate_summary": {}, "degraded": False}

        findings = findings[:MAX_REVIEW_FINDINGS]
        self.logs.append(f"Code review pass 1 raised {len(findings)} finding(s); sending them to the challenger.")

        debate: dict[str, Any]
        try:
            debate = await self.detection_agent.challenge_review(
                project_name=project_name,
                source_path=source_path,
                repository_profile=repository_profile,
                repository_map=repository_map,
                findings=findings,
                work_items=[item for batch in batches for item in batch],
                preset=preset,
            )
        except (ExternalAIServiceError, TimeoutError) as exc:
            # Without a challenge there is no debate, so findings stay as the main
            # reviewer wrote them rather than being dropped.
            logger.warning("Challenge pass failed; keeping pass 1 findings unchallenged", exc_info=exc)
            self.logs.append("Challenge pass was unavailable; pass 1 findings were kept as written.")
            return {
                "summary": summaries[0] if summaries else "",
                "findings": findings,
                "debate_summary": {},
                "degraded": True,
            }

        verdicts = debate.get("verdicts", []) or []
        new_findings = self._reindex(debate.get("new_findings", []), len(findings), prefix="D")
        verdict_by_id = {str(item.get("id", "")): item for item in verdicts if isinstance(item, dict)}

        challenged = self._apply_verdicts(findings, verdict_by_id)
        challenged.extend(new_findings)

        refuted_or_downgraded = [
            item
            for item in challenged
            if item.get("review_status") != "agreed"
            or any(
                str(verdict.get("verdict", "")) in {"refute", "downgrade"}
                and str(verdict.get("id", "")) == str(item.get("review_id", ""))
                for verdict in verdicts
            )
        ]

        final_findings: list[dict] = challenged
        if run_arbitration and refuted_or_downgraded:
            self.logs.append(
                f"Challenger disputed {len(refuted_or_downgraded)} finding(s); the main reviewer is making the final call."
            )
            try:
                final = await self.detection_agent.arbitrate_review(
                    project_name=project_name,
                    source_path=source_path,
                    findings=findings,
                    debate={"verdicts": verdicts, "new_findings": self._project(new_findings)},
                    preset=preset,
                )
                arbiter_findings = final.get("findings", []) or []
                if arbiter_findings:
                    final_findings = self._merge_arbitration(challenged, arbiter_findings)
                    if final.get("summary"):
                        summaries.append(str(final["summary"]).strip())
            except (ExternalAIServiceError, TimeoutError) as exc:
                logger.warning("Arbitration pass failed; keeping challenger-adjusted findings", exc_info=exc)
                self.logs.append("Final call pass was unavailable; challenger adjustments were kept.")
                degraded = True

        kept = [item for item in final_findings if item.get("review_status") in {"agreed", "contested"}]
        withdrawn = len(final_findings) - len(kept)

        debate_summary = {
            "pass1_findings": len(findings),
            "challenger_verdicts": len(verdicts),
            "challenger_new_findings": len(new_findings),
            "refuted_or_downgraded": len(refuted_or_downgraded),
            "withdrawn": withdrawn,
            "kept": len(kept),
            "contested": sum(1 for item in kept if item.get("review_status") == "contested"),
        }

        if withdrawn:
            self.logs.append(f"Debate withdrew {withdrawn} finding(s) that did not survive the challenge.")

        return {
            "summary": summaries[-1] if summaries else "",
            "findings": kept,
            "debate_summary": debate_summary,
            "degraded": degraded,
        }

    async def _run_recheck(
        self,
        *,
        project_name: str,
        source_path: str,
        repository_profile: dict,
        repository_map: dict,
        batches: list[list[dict]],
        preset: str,
    ) -> dict:
        """Second-look pass used only when the first pass returned zero findings.

        The whole reviewed surface is re-run with the recall-biased prompt. A
        failure here must not fail the scan: the first pass already said clean, so
        the clean verdict is kept and the report notes the self-check did not run.
        """
        try:
            return await self.detection_agent.review_code(
                project_name=project_name,
                source_path=source_path,
                repository_profile=repository_profile,
                repository_map=repository_map,
                work_items=self._recheck_work_items(batches),
                batch_index=1,
                total_batches=1,
                preset=preset,
                recheck=True,
            )
        except (ExternalAIServiceError, TimeoutError) as exc:
            logger.warning("Second-look review pass failed; keeping the clean verdict", exc_info=exc)
            self.logs.append("Second look was unavailable; the clean verdict was kept as reported.")
            return {"schema": "codeguard.review.findings.v1", "verdict": "approve", "summary": "", "findings": []}

    @staticmethod
    def _batches_are_non_trivial(batches: list[list[dict]], *, min_chars: int = 500) -> bool:
        """A recheck only pays for itself when there is real code to have missed a defect in."""
        total = 0
        for batch in batches:
            for item in batch:
                total += len(str(item.get("snippet", "")))
                if total >= min_chars:
                    return True
        return False

    @staticmethod
    def _recheck_work_items(batches: list[list[dict]], *, char_budget: int = 20000) -> list[dict]:
        """Flatten to a bounded slice so a huge folder never produces an unbounded prompt."""
        flat: list[dict] = []
        used = 0
        for batch in batches:
            for item in batch:
                flat.append(item)
                used += len(str(item.get("snippet", "")))
                if used >= char_budget:
                    return flat
        return flat

    @staticmethod
    def _reindex(findings: list[dict], offset: int, *, prefix: str = "F") -> list[dict]:
        """Give every finding a stable id the challenger and arbiter can answer with."""
        reindexed: list[dict] = []
        for index, item in enumerate(findings, start=1):
            if not isinstance(item, dict):
                continue
            entry = dict(item)
            entry["review_id"] = f"{prefix}{offset + index}"
            reindexed.append(entry)
        return reindexed

    @staticmethod
    def _project(findings: list[dict]) -> list[dict]:
        return [
            {
                "id": item.get("review_id", ""),
                "severity": item.get("severity", "medium"),
                "title": item.get("title", ""),
                "file": item.get("file", ""),
                "line": item.get("line", 1),
                "line_end": item.get("line_end", item.get("line", 1)),
                "claim": item.get("summary", ""),
                "evidence": item.get("evidence", ""),
                "recommendation": item.get("recommendation", ""),
                "confidence": item.get("confidence", 70),
            }
            for item in findings
            if isinstance(item, dict)
        ]

    @staticmethod
    def _apply_verdicts(findings: list[dict], verdict_by_id: dict[str, dict]) -> list[dict]:
        """Apply challenger verdicts without dropping anything.

        A `refute` with no evidence is recorded as a downgrade, not a refutation:
        the bar for refuting is evidence from the code. Dropping here would let a
        bare "I disagree" silence a real defect.
        """
        adjusted: list[dict] = []
        for item in findings:
            entry = dict(item)
            verdict = verdict_by_id.get(str(entry.get("review_id", "")), {})
            verdict_kind = str(verdict.get("verdict", "confirm")).strip().lower()

            if verdict_kind == "refute":
                if str(verdict.get("evidence", "")).strip():
                    entry["review_status"] = "withdrawn"
                    entry["debate_note"] = str(verdict.get("reason", "")).strip() or "Refuted with evidence."
                else:
                    entry["review_status"] = "contested"
                    entry["debate_note"] = (
                        "Challenged without evidence; kept for review. "
                        + str(verdict.get("reason", "")).strip()
                    ).strip()
            elif verdict_kind == "downgrade":
                severity = str(verdict.get("severity", "")).strip().lower()
                if severity in {"critical", "high", "medium", "low"}:
                    entry["severity"] = severity
                confidence = int(verdict.get("confidence", 0) or 0)
                if confidence > 0:
                    entry["confidence"] = min(int(entry.get("confidence", 70)), confidence)
                entry["review_status"] = "agreed"
                entry["debate_note"] = str(verdict.get("reason", "")).strip() or "Downgraded after the challenge."
            else:
                entry["review_status"] = "agreed"
                entry["debate_note"] = str(verdict.get("reason", "")).strip()
            adjusted.append(entry)
        return adjusted

    @staticmethod
    def _merge_arbitration(challenged: list[dict], arbiter_findings: list[dict]) -> list[dict]:
        """Take the arbiter's status and text for every finding it ruled on.

        Findings the arbiter did not mention keep the challenger's adjustment
        rather than disappearing: silence is not a withdrawal.
        """
        by_id = {
            str(item.get("review_id", "")): item
            for item in arbiter_findings
            if isinstance(item, dict)
        }
        merged: list[dict] = []
        for item in challenged:
            entry = dict(item)
            ruling = by_id.get(str(entry.get("review_id", "")))
            if ruling is None:
                merged.append(entry)
                continue
            status = str(ruling.get("review_status", "agreed")).strip().lower()
            entry["review_status"] = status if status in {"agreed", "contested", "withdrawn"} else "agreed"
            if ruling.get("severity"):
                entry["severity"] = ruling["severity"]
            if ruling.get("line"):
                entry["line"] = ruling["line"]
            if ruling.get("line_end"):
                entry["line_end"] = max(int(ruling["line_end"]), int(entry.get("line", 1)))
            for source_key, target_key in (
                ("summary", "summary"),
                ("evidence", "evidence"),
                ("recommendation", "recommendation"),
                ("debate_note", "debate_note"),
            ):
                value = str(ruling.get(source_key, "")).strip()
                if value:
                    entry[target_key] = value
            merged.append(entry)
        return merged
