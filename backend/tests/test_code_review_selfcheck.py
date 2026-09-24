from __future__ import annotations

from typing import Any

import pytest

from app.infrastructure.services.scan.code_review_debate import CodeReviewDebate, MAX_REVIEW_FINDINGS
from app.infrastructure.ai.scan_client import ScanAIClient


def _work_item(file: str, snippet: str, start_line: int = 1, end_line: int | None = None) -> dict:
    return {
        "file": file,
        "start_line": start_line,
        "end_line": end_line or (start_line + snippet.count("\n")),
        "snippet": snippet,
        "block_id": f"{file}:{start_line}",
        "block_kind": "function",
        "rationale": "Scripted block",
    }


_LONG_SNIPPET = (
    "def process(payload):\n"
    "    # {n} lines of real code a reviewer must read to find the off-by-one at the end\n"
    + "\n".join(f"    # filler line {index}" for index in range(1, 40))
    + "\n    for index in range(len(payload) + 1):\n        total += payload[index]\n    return total\n"
)


class FakeDetectionAgent:
    def __init__(self, *, main_findings: list[dict] | None = None, recheck_findings: list[dict] | None = None) -> None:
        self.main_findings = main_findings or []
        self.recheck_findings = recheck_findings or []
        self.calls: list[dict[str, Any]] = []
        self.recheck_called = False

    async def review_code(self, **kwargs):
        self.calls.append({"recheck": bool(kwargs.get("recheck")), "work_items": kwargs.get("work_items", [])})
        if kwargs.get("recheck"):
            self.recheck_called = True
            return _review_payload(self.recheck_findings, "Second look raised a defect.")
        return _review_payload(self.main_findings, "First pass reported clean.")

    async def challenge_review(self, *, findings: list[dict], **kwargs):
        return {
            "schema": "codeguard.review.debate.v1",
            "verdicts": [
                {"id": finding["review_id"], "verdict": "confirm", "reason": "Trigger and wrong result are grounded.", "evidence": finding.get("evidence", "")}
                for finding in findings
            ],
            "new_findings": [],
        }

    async def arbitrate_review(self, *, findings: list[dict], **kwargs):
        return {
            "schema": "codeguard.review.final.v1",
            "summary": "Confirmed after the challenge.",
            "findings": [{**finding, "review_status": "agreed", "debate_note": "Confirmed."} for finding in findings],
        }


def _review_payload(findings: list[dict], summary: str) -> dict:
    return {
        "schema": "codeguard.review.findings.v1",
        "verdict": "needs-attention" if findings else "approve",
        "summary": summary,
        "findings": findings,
    }


def _off_by_one_finding() -> dict:
    return {
        "id": "R1",
        "severity": "medium",
        "axis": "correctness",
        "title": "Off-by-one: loop runs one index past the end",
        "file": "process.py",
        "line": 44,
        "line_end": 45,
        "claim": "range(len(payload) + 1) reads one element past the list end.",
        "evidence": "line 44: for index in range(len(payload) + 1) followed by payload[index]",
        "recommendation": "for value in payload: total += value",
        "confidence": 88,
        "source_hint": "",
        "sink_hint": "",
        "path_hint": "",
    }


@pytest.mark.asyncio
async def test_recheck_runs_when_first_pass_returns_nothing_on_non_trivial_code():
    agent = FakeDetectionAgent(main_findings=[], recheck_findings=[_off_by_one_finding()])
    debate = CodeReviewDebate(agent, logs=[])
    batches = [[_work_item("process.py", _LONG_SNIPPET)]]

    result = await debate.run(
        project_name="p",
        source_path="process.py",
        repository_profile={"file_count": 1},
        repository_map={},
        batches=batches,
        preset="balanced",
        run_arbitration=True,
    )

    assert agent.recheck_called, "the second-look recheck was never invoked after a clean first pass"
    assert result["findings"], "a defect the second-look caught was dropped"
    assert result["findings"][0]["title"] == "Off-by-one: loop runs one index past the end"
    assert result["findings"][0]["review_status"] == "agreed"


@pytest.mark.asyncio
async def test_recheck_is_skipped_for_trivial_scope():
    agent = FakeDetectionAgent(main_findings=[], recheck_findings=[_off_by_one_finding()])
    debate = CodeReviewDebate(agent, logs=[])
    batches = [[_work_item("clean.py", "def add(a, b):\n    return a + b\n")]]

    result = await debate.run(
        project_name="p",
        source_path="clean.py",
        repository_profile={"file_count": 1},
        repository_map={},
        batches=batches,
        preset="balanced",
        run_arbitration=False,
    )

    assert not agent.recheck_called, "trivial scope must not pay for a second-look pass"
    assert result["findings"] == []


@pytest.mark.asyncio
async def test_review_code_sends_full_snippet_not_a_260_char_stub():
    """The reviewer must see the code it is asked to pass judgment on."""

    class CapturingClient(ScanAIClient):
        def __init__(self, *args, **kwargs) -> None:
            super().__init__(*args, **kwargs)
            self.captured_messages: list[dict] | None = None

        async def _chat_json(self, *, task_name: str, max_tokens: int, messages: list[dict]) -> dict:
            self.captured_messages = messages
            return {"schema": "codeguard.review.findings.v1", "verdict": "approve", "summary": "", "findings": []}

    client = CapturingClient()
    snippet = (
        "def process(payload):\n"
        + "\n".join(f"    # line {index}" for index in range(1, 40))
        + "\n    return [item for item in payload if item > SIGNAL_END_MARKER]\n"
    )
    result = await client.review_code(
        project_name="p",
        source_path="process.py",
        repository_profile={"file_count": 1},
        repository_map={},
        work_items=[_work_item("process.py", snippet)],
        batch_index=1,
        total_batches=1,
        preset="balanced",
    )

    assert client.captured_messages is not None
    user_content = client.captured_messages[-1]["content"]
    assert "SIGNAL_END_MARKER" in user_content, "the reviewer received a truncated snippet that cannot see the tail of the code"
    assert len(user_content) > 600, "the code blocks reached the reviewer without being clamped to a ~260-char stub"


@pytest.mark.asyncio
async def test_recheck_failure_keeps_clean_verdict():
    class FailingRecheckAgent(FakeDetectionAgent):
        async def review_code(self, **kwargs):
            if kwargs.get("recheck"):
                raise TimeoutError("second look timed out")
            return _review_payload([], "First pass reported clean.")

    agent = FailingRecheckAgent()
    debate = CodeReviewDebate(agent, logs=[])
    result = await debate.run(
        project_name="p",
        source_path="process.py",
        repository_profile={"file_count": 1},
        repository_map={},
        batches=[[_work_item("process.py", _LONG_SNIPPET)]],
        preset="balanced",
        run_arbitration=True,
    )

    assert result["findings"] == []
    assert result["degraded"] is False
    assert any("Second look was unavailable" in line for line in debate.logs)


@pytest.mark.asyncio
async def test_first_pass_findings_are_not_rechecked():
    agent = FakeDetectionAgent(main_findings=[_off_by_one_finding()], recheck_findings=[])
    debate = CodeReviewDebate(agent, logs=[])
    result = await debate.run(
        project_name="p",
        source_path="process.py",
        repository_profile={"file_count": 1},
        repository_map={},
        batches=[[_work_item("process.py", _LONG_SNIPPET)]],
        preset="balanced",
        run_arbitration=True,
    )

    assert not agent.recheck_called, "a first pass that already found defects must not trigger the second look"
    assert result["findings"], "first-pass findings were dropped"
