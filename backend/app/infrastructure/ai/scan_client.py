from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
from dataclasses import dataclass
import logging
import time
from textwrap import shorten

import httpx

from app.core.config import get_settings
from app.core.exceptions import ExternalAIServiceError
from app.domain.services.ai_client import SecurityAnalysisAIClient
from app.infrastructure.ai.client_utils import (
    compact_findings,
    extract_json,
    extract_review_findings,
    extract_review_payload,
    json_for_task_prompt,
    normalize_analysis_brief,
    normalize_debate_verdicts,
    normalize_remediation_payload,
    normalize_priority_path,
    normalize_review_finding,
)
from app.infrastructure.ai.orchestration.model_router import ModelRouter
from app.infrastructure.ai.prompt_loader import load_prompt_pack

logger = logging.getLogger("codeguard.ai")

_RATE_LIMIT_FALLBACK_COOLDOWN_SECONDS = 30.0
_RATE_LIMIT_MAX_COOLDOWN_SECONDS = 60.0

# Wall-clock budget for one AI-backed scan step: a single _chat_json call
# including its token-budget retries, the forced-JSON pass, and the JSON repair
# pass. The transport retries and waits out rate-limit cooldowns inside this
# budget, and ScanExecutionService caps the same step with asyncio.wait_for() at
# this budget plus a small grace. The two must stay in sync: when the outer cap
# is smaller than the transport's own retry schedule, wait_for cancels a retry
# sleep mid-flight and a rate-limited provider is reported as an unavailable
# provider, which fails the review for a failure that would have recovered.
AI_STEP_BUDGET_SECONDS = 75.0
_COOLDOWN_WAIT_TASKS = {"explain", "fix_draft", "fix_retry", "fix_validate", "patch_validate", "final_patch"}
_PROVIDER_REQUEST_LOCK = asyncio.Lock()
_PROVIDER_NEXT_REQUEST_AT_BY_KEY: dict[str, float] = {}
_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL = 0.0
_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY: dict[str, float] = {}

# Task names the scan engine routes through the AI transport. When the user saves
# a single model in Settings, every task must route to it so the chosen model is
# actually used instead of the env-configured defaults.
RUNTIME_TASK_MODELS = (
    "repository_map",
    "path_review",
    "finding_validate",
    "verdict",
    "code_review",
    "review_challenge",
    "review_arbitrate",
    "penetration_test",
    "explain",
    "fix_draft",
    "fix_retry",
    "fix_validate",
    "patch_validate",
    "final_patch",
    "json_repair",
)


@dataclass(frozen=True, slots=True)
class _ProviderTarget:
    provider_name: str
    base_url: str
    api_keys: tuple[str, ...]
    timeout_seconds: float
    model: str
    enable_thinking: bool = False


class ScanAIClient(SecurityAnalysisAIClient):
    def __init__(
        self,
        *,
        provider_name: str | None = None,
        api_keys: tuple[str, ...] | None = None,
        base_url: str | None = None,
        task_models: dict[str, str] | None = None,
        allow_fallbacks: bool = True,
    ) -> None:
        settings = get_settings()
        self.provider_name = (provider_name or "openai").strip().lower()
        # Runtime-configured clients (settings saved in the Settings screen) take
        # precedence over env config so the saved model/key/URL are actually used
        self.api_keys = tuple(api_keys) if api_keys else _resolve_nvidia_api_keys(settings)
        self.base_url = (base_url or settings.nvidia_base_url).rstrip("/")
        # A runtime-configured client must use the model saved by the customer for
        # every scan task. Previously task_models only overrode router entries,
        # while small_model/large_model still pointed at the env default; that
        # made some review passes call an unavailable model and falsely return a
        # clean scan after degrading.
        runtime_default_model = ""
        if task_models:
            runtime_default_model = next(
                (str(model).strip() for model in task_models.values() if str(model).strip()),
                "",
            )
        self.small_model = runtime_default_model or _resolve_nvidia_model(settings, tier="small")
        self.large_model = runtime_default_model or _resolve_nvidia_model(settings, tier="large")
        overrides = _build_task_model_overrides(settings)
        if task_models:
            overrides.update(
                {
                    str(task_name).strip(): str(model).strip()
                    for task_name, model in task_models.items()
                    if str(task_name).strip() and str(model).strip()
                }
            )
        self.model_router = ModelRouter(
            small_model=self.small_model,
            large_model=self.large_model,
            overflow_model=None if not allow_fallbacks else settings.nvidia_overflow_model,
            task_overrides=overrides,
        )
        self.enable_thinking = settings.nvidia_enable_thinking
        self.request_timeout_seconds = settings.nvidia_timeout_seconds
        self.retry_attempts = settings.nvidia_retry_attempts
        self.retry_backoff_seconds = settings.nvidia_retry_backoff_seconds
        self.min_request_interval_seconds = settings.nvidia_min_request_interval_seconds
        self._api_key_cursor = 0
        self._runtime_events: list[str] = []
        self._runtime_metrics: dict[str, int] = {}

    @staticmethod
    def is_configured(settings) -> bool:
        return bool(_resolve_nvidia_api_keys(settings))

    def reset_runtime_state(self) -> None:
        self._runtime_events = []
        self._runtime_metrics = {}

    def drain_runtime_events(self) -> list[str]:
        events = list(self._runtime_events)
        self._runtime_events.clear()
        return events

    def snapshot_runtime_metrics(self, *, reset: bool = False) -> dict | None:
        metrics = dict(self._runtime_metrics)
        if reset:
            self._runtime_metrics = {}
        return metrics or None

    async def map_repository(self, project_name: str, source_path: str, repository_profile: dict, repository_artifacts: dict, preset: str) -> dict:
        parsed = await self._chat_json(
            task_name="repository_map",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": load_prompt_pack("repository_mapper.md")},
                {
                    "role": "user",
                    "content": (
                        f"Project: {project_name}\n"
                        f"Source: {source_path}\n"
                        f"Preset: {preset}\n"
                        f"Repository profile JSON: {json_for_task_prompt('repository_map', 'repository_profile', repository_profile, max_chars=1800)}\n"
                        f"Repository artifacts JSON: {json_for_task_prompt('repository_map', 'repository_artifacts', repository_artifacts, max_chars=2800)}"
                    ),
                },
            ],
        )
        return {
            "review_note": shorten(str(parsed.get("review_note", "")), width=180, placeholder="..."),
            "repository_summary": shorten(str(parsed.get("repository_summary", "")), width=260, placeholder="..."),
            "coverage_note": shorten(str(parsed.get("coverage_note", "")), width=220, placeholder="..."),
            "trust_boundaries": [str(item) for item in parsed.get("trust_boundaries", []) if str(item).strip()][:10],
            "priority_paths": [normalize_priority_path(item) for item in parsed.get("priority_paths", []) if isinstance(item, dict)],
        }

    async def review_paths(self, project_name: str, source_path: str, repository_profile: dict, repository_map: dict, work_items: list[dict[str, str]], batch_index: int, total_batches: int, preset: str) -> dict:
        if not work_items:
            return {"review_note": "No prioritized work items reached the path reviewer.", "repository_summary": "", "findings": []}
        budget = self.model_router.token_budget_for("path_review")
        # Auto-compact work_items to fit model's window â€” prevents truncation hallucination
        compact_chars = min(2600, max(1200, int(budget["max_input_tokens"] * 2.2)))
        parsed = await self._chat_json(
            task_name="path_review",
            max_tokens=min(4096, budget["max_output_tokens"]),
            messages=[
                {"role": "system", "content": load_prompt_pack("path_reviewer.md")},
                {
                    "role": "user",
                    "content": (
                        f"Project: {project_name}\n"
                        f"Source: {source_path}\n"
                        f"Preset: {preset}\n"
                        f"Batch: {batch_index}/{total_batches}\n"
                        f"Repository profile JSON: {json_for_task_prompt('path_review', 'repository_profile', repository_profile, max_chars=min(1200, compact_chars // 2))}\n"
                        f"Repository map JSON: {json_for_task_prompt('path_review', 'repository_map', repository_map, max_chars=min(1800, compact_chars // 1.6))}\n"
                        f"Prioritized work items JSON: {json_for_task_prompt('path_review', 'work_items', work_items, max_chars=compact_chars)}"
                    ),
                },
            ],
        )
        return extract_review_payload(json.dumps(parsed, ensure_ascii=False))

    async def review_code(
        self,
        project_name: str,
        source_path: str,
        repository_profile: dict,
        repository_map: dict,
        work_items: list[dict],
        batch_index: int,
        total_batches: int,
        preset: str,
        recheck: bool = False,
    ) -> dict:
        """Main reviewer pass. Reviews the whole code surface, not only taint paths.

        ``recheck`` selects the second-look prompt used as a self-check when the
        first pass returned no findings on non-trivial code.
        """
        if not work_items:
            return {"schema": "codeguard.review.findings.v1", "verdict": "approve", "summary": "", "findings": []}
        budget = self.model_router.token_budget_for("code_review")
        compact_chars = _code_review_chars(budget["max_input_tokens"])
        parsed = await self._chat_json(
            task_name="code_review",
            max_tokens=min(4096, budget["max_output_tokens"]),
            messages=[
                {"role": "system", "content": load_prompt_pack("code_reviewer_recheck.md" if recheck else "code_reviewer.md")},
                {
                    "role": "user",
                    "content": (
                        f"Project: {project_name}\n"
                        f"Source: {source_path}\n"
                        f"Preset: {preset}\n"
                        f"Batch: {batch_index}/{total_batches}\n"
                        f"Reviewed files: {_review_file_list(work_items)}\n"
                        f"Repository profile JSON: {json_for_task_prompt('code_review', 'repository_profile', repository_profile, max_chars=min(1000, compact_chars // 3))}\n"
                        f"Repository map JSON: {json_for_task_prompt('code_review', 'repository_map', repository_map, max_chars=min(1400, compact_chars // 2))}\n"
                        f"Code blocks JSON (each snippet is prefixed with its real file line numbers): "
                        f"{json_for_task_prompt('code_review', 'work_items', _slim_review_work_items(work_items), max_chars=compact_chars)}"
                    ),
                },
            ],
        )
        return {
            "schema": "codeguard.review.findings.v1",
            "verdict": str(parsed.get("verdict", "needs-attention")).strip().lower(),
            "summary": str(parsed.get("summary", "")).strip(),
            "findings": extract_review_findings(parsed, default_status="agreed"),
        }

    async def challenge_review(
        self,
        project_name: str,
        source_path: str,
        repository_profile: dict,
        repository_map: dict,
        findings: list[dict],
        work_items: list[dict],
        preset: str,
    ) -> dict:
        """Second reviewer pass: try to knock the findings down, and sweep for gaps."""
        if not findings:
            return {"schema": "codeguard.review.debate.v1", "verdicts": [], "new_findings": []}
        budget = self.model_router.token_budget_for("review_challenge")
        compact_chars = _code_review_chars(budget["max_input_tokens"])
        parsed = await self._chat_json(
            task_name="review_challenge",
            max_tokens=min(3072, budget["max_output_tokens"]),
            messages=[
                {"role": "system", "content": load_prompt_pack("review_challenger.md")},
                {
                    "role": "user",
                    "content": (
                        f"Project: {project_name}\n"
                        f"Source: {source_path}\n"
                        f"Preset: {preset}\n"
                        f"Repository profile JSON: {json_for_task_prompt('review_challenge', 'repository_profile', repository_profile, max_chars=min(800, compact_chars // 5))}\n"
                        f"Repository map JSON: {json_for_task_prompt('review_challenge', 'repository_map', repository_map, max_chars=min(1000, compact_chars // 4))}\n"
                        f"Code reviewed JSON: {json_for_task_prompt('review_challenge', 'work_items', _slim_review_work_items(work_items), max_chars=min(compact_chars, 14000))}\n"
                        f"Findings under review JSON: {json_for_task_prompt('review_challenge', 'findings', _review_findings_for_debate(findings), max_chars=min(compact_chars, 6000))}"
                    ),
                },
            ],
        )
        return {
            "schema": "codeguard.review.debate.v1",
            "verdicts": normalize_debate_verdicts(parsed),
            "new_findings": extract_review_findings({"findings": parsed.get("new_findings", [])}, default_status="agreed"),
        }

    async def arbitrate_review(
        self,
        project_name: str,
        source_path: str,
        findings: list[dict],
        debate: dict,
        preset: str,
    ) -> dict:
        """Final call: agreed / contested / withdrawn for every finding."""
        if not findings:
            return {"schema": "codeguard.review.final.v1", "summary": "", "findings": []}
        parsed = await self._chat_json(
            task_name="review_arbitrate",
            max_tokens=3072,
            messages=[
                {"role": "system", "content": load_prompt_pack("review_arbiter.md")},
                {
                    "role": "user",
                    "content": (
                        f"Project: {project_name}\n"
                        f"Source: {source_path}\n"
                        f"Preset: {preset}\n"
                        f"Position A, the original findings JSON: "
                        f"{json_for_task_prompt('review_arbitrate', 'findings', _review_findings_for_debate(findings, include_evidence=True), max_chars=2600)}\n"
                        f"Position B, the challenge JSON: "
                        f"{json_for_task_prompt('review_arbitrate', 'debate', debate, max_chars=2200)}"
                    ),
                },
            ],
        )
        return {
            "schema": "codeguard.review.final.v1",
            "summary": str(parsed.get("summary", "")).strip(),
            "findings": extract_review_findings(parsed, default_status="agreed"),
        }

    async def validate_findings(self, project_name: str, source_path: str, repository_profile: dict, repository_map: dict, findings: list[dict], preset: str) -> dict:
        if not findings:
            return {"review_note": "The validator did not receive any candidate findings.", "safe_summary": "No confirmed high-confidence issue was found in the reviewed scope.", "findings": []}
        parsed = await self._chat_json(
            task_name="finding_validate",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": load_prompt_pack("finding_validator.md")},
                {
                    "role": "user",
                    "content": (
                        f"Project: {project_name}\n"
                        f"Source: {source_path}\n"
                        f"Preset: {preset}\n"
                        f"Repository profile JSON: {json_for_task_prompt('finding_validate', 'repository_profile', repository_profile, max_chars=1200)}\n"
                        f"Repository map JSON: {json_for_task_prompt('finding_validate', 'repository_map', repository_map, max_chars=1800)}\n"
                        f"Potential findings JSON: {json_for_task_prompt('finding_validate', 'findings', compact_findings(findings, limit=18), max_chars=2200)}"
                    ),
                },
            ],
        )
        parsed = extract_review_payload(json.dumps(parsed, ensure_ascii=False))
        return {
            "review_note": parsed["review_note"],
            "safe_summary": shorten(str(parsed.get("safe_summary", "")), width=220, placeholder="..."),
            "findings": parsed["findings"],
        }

    async def summarize_verdict(self, project_name: str, source_path: str, repository_profile: dict, repository_map: dict, findings: list[dict], security_score: int | None, preset: str) -> dict:
        parsed = await self._chat_json(
            task_name="verdict",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": load_prompt_pack("verdict_analyst.md")},
                {
                    "role": "user",
                    "content": (
                        f"Project: {project_name}\n"
                        f"Source: {source_path}\n"
                        f"Preset: {preset}\n"
                        f"Security score: {security_score}\n"
                        f"Repository profile JSON: {json_for_task_prompt('verdict', 'repository_profile', repository_profile, max_chars=1000)}\n"
                        f"Repository map JSON: {json_for_task_prompt('verdict', 'repository_map', repository_map, max_chars=1600)}\n"
                        f"Confirmed findings JSON: {json_for_task_prompt('verdict', 'findings', compact_findings(findings, limit=16), max_chars=1800)}"
                    ),
                },
            ],
        )
        return {
            "review_note": shorten(str(parsed.get("review_note", "")), width=180, placeholder="..."),
            "repository_summary": shorten(str(parsed.get("repository_summary", "")), width=260, placeholder="..."),
            "coverage_summary": shorten(str(parsed.get("coverage_summary", "")), width=220, placeholder="..."),
            "analysis_brief": normalize_analysis_brief(parsed),
        }

    async def run_penetration_test(self, penetration_context: dict) -> dict:
        findings = penetration_context.get("findings", [])
        if not isinstance(findings, list) or not findings:
            return {
                "review_note": "",
                "executive_summary": "",
                "attack_chains": [],
                "reproduction_plan": [],
                "analysis_limitations": [],
                "next_steps": [],
                "benchmark": {
                    "findings_covered": 0,
                    "paths_exercised": 0,
                    "confidence_average": 0,
                    "benchmark_summary": "",
                },
                "finding_overrides": [],
            }

        parsed: dict | None = None
        attempt_profiles = (
            {
                "max_tokens": 4096,
                "findings_limit": 20,
                "repository_map": penetration_context.get("repository_map", {}),
            },
            {
                "max_tokens": 4096,
                "findings_limit": 12,
                "repository_map": _compact_penetration_repository_map(penetration_context.get("repository_map", {})),
            },
        )
        for attempt_index, profile in enumerate(attempt_profiles):
            try:
                parsed = await self._chat_json(
                    task_name="penetration_test",
                    max_tokens=int(profile["max_tokens"]),
                    messages=[
                        {"role": "system", "content": load_prompt_pack("penetration_tester_prompt.md")},
                        {
                            "role": "user",
                            "content": (
                                f"Project: {penetration_context.get('project_name', '')}\n"
                                f"Source: {penetration_context.get('source_path', '')}\n"
                                f"Preset: {penetration_context.get('preset', '')}\n"
                                f"Scan mode: {penetration_context.get('scan_mode', '')}\n"
                                f"Repository profile JSON: {json_for_task_prompt('penetration_test', 'repository_profile', penetration_context.get('repository_profile', {}), max_chars=1400)}\n"
                                f"Repository map JSON: {json_for_task_prompt('penetration_test', 'repository_map', profile['repository_map'], max_chars=2200)}\n"
                                f"Sandbox JSON: {json_for_task_prompt('penetration_test', 'sandbox', penetration_context.get('sandbox', {}), max_chars=1200)}\n"
                                f"Validated findings JSON: {json_for_task_prompt('penetration_test', 'validated_findings', compact_findings(findings, limit=int(profile['findings_limit'])), max_chars=2800)}"
                            ),
                        },
                    ],
                )
                break
            except ExternalAIServiceError as exc:
                if attempt_index >= len(attempt_profiles) - 1 or not exc.retryable:
                    raise
                logger.warning(
                    "Penetration report request failed on attempt %s; retrying with compact context",
                    attempt_index + 1,
                    exc_info=exc,
                )
                await asyncio.sleep(min(1.2 * (attempt_index + 1), 3.0))

        if parsed is None:
            raise ExternalAIServiceError(
                "NVIDIA did not return a penetration report for the current findings.",
                provider=self.provider_name,
                retryable=True,
                failure_kind="runtime",
            )

        benchmark = parsed.get("benchmark", {}) if isinstance(parsed.get("benchmark"), dict) else {}
        finding_overrides = parsed.get("finding_overrides", [])
        normalized_overrides: list[dict] = []
        if isinstance(finding_overrides, list):
            for item in finding_overrides[:24]:
                if not isinstance(item, dict):
                    continue
                normalized_overrides.append(
                    {
                        "file": str(item.get("file", "")).strip(),
                        "line": int(item.get("line", 0) or 0),
                        "title": str(item.get("title", "")).strip(),
                        "attack_input": str(item.get("attack_input", "")).strip(),
                        "attack_execution": str(item.get("attack_execution", "")).strip(),
                        "attack_result": str(item.get("attack_result", "")).strip(),
                        "explanation": str(item.get("explanation", "")).strip(),
                        "audit_log": [str(entry).strip() for entry in item.get("audit_log", []) if str(entry).strip()][:6],
                    }
                )

        default_confidence = _average_finding_confidence(findings)
        findings_covered = _coerce_positive_int(benchmark.get("findings_covered"), fallback=len(findings))
        if findings_covered == 0 and findings:
            findings_covered = len(findings)
        paths_exercised = _coerce_positive_int(benchmark.get("paths_exercised"), fallback=findings_covered)
        if paths_exercised == 0 and findings_covered > 0:
            paths_exercised = findings_covered
        confidence_average = _coerce_percentage(benchmark.get("confidence_average"), fallback=default_confidence)
        if confidence_average == 0 and default_confidence > 0:
            confidence_average = default_confidence
        benchmark_summary = shorten(str(benchmark.get("benchmark_summary", "")).strip(), width=220, placeholder="...")
        if not benchmark_summary:
            benchmark_summary = (
                f"Validated {findings_covered} finding(s) and exercised {paths_exercised} path(s) "
                "in controlled penetration simulation."
            )

        review_note = shorten(str(parsed.get("review_note", "")).strip(), width=180, placeholder="...")
        if not review_note:
            review_note = "Penetration report returned limited structured output; defaults were normalized from validated findings."
        executive_summary = shorten(str(parsed.get("executive_summary", "")).strip(), width=320, placeholder="...")
        if not executive_summary:
            executive_summary = (
                "Controlled penetration simulation completed with normalized fallback fields derived from validated findings."
            )
        attack_chains = [str(item).strip() for item in parsed.get("attack_chains", []) if str(item).strip()][:8]
        if not attack_chains:
            attack_chains = [
                f"{str(item.get('title', 'Finding')).strip()} -> {str(item.get('file', '')).strip()}:{_coerce_positive_int(item.get('line', 0), fallback=0)}"
                for item in findings[:3]
                if str(item.get("file", "")).strip()
            ]
        reproduction_plan = [str(item).strip() for item in parsed.get("reproduction_plan", []) if str(item).strip()][:8]
        if not reproduction_plan:
            reproduction_plan = [
                "Re-run this finding in isolated staging with non-production data and controlled inputs.",
                "Capture request/response traces and verify sink reachability before applying the fix.",
            ]
        analysis_limitations = [str(item).strip() for item in parsed.get("analysis_limitations", []) if str(item).strip()][:8]
        if not analysis_limitations:
            analysis_limitations = [
                "Model output was partially empty; benchmark and context were normalized from validated findings.",
            ]
        next_steps = [str(item).strip() for item in parsed.get("next_steps", []) if str(item).strip()][:8]
        if not next_steps:
            next_steps = [
                "Apply remediation patch and re-run validation to verify closure.",
            ]

        return {
            "review_note": review_note,
            "executive_summary": executive_summary,
            "attack_chains": attack_chains,
            "reproduction_plan": reproduction_plan,
            "analysis_limitations": analysis_limitations,
            "next_steps": next_steps,
            "benchmark": {
                "findings_covered": findings_covered,
                "paths_exercised": paths_exercised,
                "confidence_average": confidence_average,
                "benchmark_summary": benchmark_summary,
            },
            "finding_overrides": normalized_overrides,
        }

    async def explain_finding(self, remediation_context: dict) -> dict:
        parsed = await self._chat_json(
            task_name="explain",
            max_tokens=2048,
            messages=[
                {"role": "system", "content": load_prompt_pack("explain_prompt.md")},
                {"role": "user", "content": f"Remediation context JSON: {json_for_task_prompt('explain', 'remediation_context', remediation_context, max_chars=2600)}"},
            ],
        )
        return {
            "summary": shorten(str(parsed.get("summary", "")), width=240, placeholder="..."),
            "exploit_scenario": shorten(str(parsed.get("exploit_scenario", "")), width=560, placeholder="..."),
            "request_example": str(parsed.get("request_example", "")),
            "payload_example": str(parsed.get("payload_example", "")),
            "attack_steps": [str(item) for item in parsed.get("attack_steps", []) if str(item).strip()][:6],
            "entry_point": shorten(str(parsed.get("entry_point", "")), width=180, placeholder="..."),
            "execution_path": shorten(str(parsed.get("execution_path", "")), width=240, placeholder="..."),
            "sink": shorten(str(parsed.get("sink", "")), width=140, placeholder="..."),
            "impact": shorten(str(parsed.get("impact", "")), width=220, placeholder="..."),
        }

    async def draft_fix_strategies(self, remediation_context: dict, mode: str) -> dict:
        parsed = await self._chat_json(
            task_name="fix_draft",
            max_tokens=3072,
            messages=[
                {"role": "system", "content": load_prompt_pack("fix_prompt.md")},
                {"role": "user", "content": f"Mode: {mode}\nRemediation context JSON: {json_for_task_prompt('fix_draft', 'remediation_context', remediation_context, max_chars=2800)}"},
            ],
        )
        return normalize_remediation_payload(parsed)

    async def validate_remediation(self, remediation_context: dict, remediation_draft: dict, mode: str) -> dict:
        parsed = await self._chat_json(
            task_name="fix_validate",
            max_tokens=3072,
            messages=[
                {"role": "system", "content": load_prompt_pack("fix_validator_prompt.md")},
                {
                    "role": "user",
                    "content": (
                        f"Mode: {mode}\n"
                        f"Remediation context JSON: {json_for_task_prompt('fix_validate', 'remediation_context', remediation_context, max_chars=2200)}\n"
                        f"Draft remediation JSON: {json_for_task_prompt('fix_validate', 'remediation_draft', remediation_draft, max_chars=2200)}"
                    ),
                },
            ],
        )
        return normalize_remediation_payload(
            parsed,
            fallback_review_summary=str(remediation_draft.get("review_summary", "")),
            fallback_recommended_strategy_id=remediation_draft.get("recommended_strategy_id"),
            fallback_strategies=remediation_draft.get("strategies", []),
            fallback_patch=remediation_draft.get("patch", {}),
        )

    async def _chat_json(self, *, task_name: str, max_tokens: int, messages: list[dict], deadline: float | None = None) -> dict:
        token_budgets = [max_tokens]
        expanded_budget = min(max(max_tokens * 2, 1536), 16384)
        if expanded_budget > max_tokens:
            token_budgets.append(expanded_budget)
        raw_responses: list[str] = []

        # One deadline for the whole step: the token-budget retries, the forced
        # JSON pass, and the repair pass all draw from the same budget so a step
        # cannot drift past the cap ScanExecutionService enforces with wait_for.
        step_deadline = deadline if deadline is not None else time.monotonic() + AI_STEP_BUDGET_SECONDS

        for token_budget in token_budgets:
            content = await self._chat_text(
                task_name=task_name,
                max_tokens=token_budget,
                messages=messages,
                expect_json=True,
                deadline=step_deadline,
            )
            if content:
                raw_responses.append(content)
            parsed = extract_json(content)
            if parsed:
                return parsed

        # Some OpenAI-compatible providers ignore response_format and return fenced or prose-wrapped JSON.
        fallback_messages = _force_json_only_messages(messages)
        fallback_budget = min(max(max_tokens * 2, 1536), 16384)
        content = await self._chat_text(
            task_name=task_name,
            max_tokens=fallback_budget,
            messages=fallback_messages,
            expect_json=False,
            deadline=step_deadline,
        )
        if content:
            raw_responses.append(content)
        parsed = extract_json(content)
        if parsed:
            return parsed

        repaired = await self._repair_json_response(task_name=task_name, messages=messages, raw_responses=raw_responses, deadline=step_deadline)
        if repaired:
            return repaired

        raise ExternalAIServiceError(
            "The configured AI provider returned a completion without JSON content for this task.",
            provider=self.provider_name,
            retryable=True,
            failure_kind="output_format",
        )

    async def _chat_text(self, *, task_name: str, max_tokens: int, messages: list[dict], expect_json: bool = False, target: _ProviderTarget | None = None, deadline: float | None = None) -> str:
        target = target or self._target_for_task(task_name)
        wait_for_cooldown = _should_wait_for_rate_limit_cooldown(task_name)
        payload = {
            "model": target.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.02,
            "top_p": 1,
            "stream": False,
        }
        if expect_json:
            payload["response_format"] = {"type": "json_object"}
        # Reasoning tokens can consume the entire output budget before a model
        # emits the JSON result. Code review needs a compact, deterministic
        # structured answer, so disable hidden thinking for every JSON task.
        elif target.enable_thinking:
            payload["chat_template_kwargs"] = {"enable_thinking": True}

        url = _chat_completions_url(target.base_url)
        logger.info(
            "AI request dispatch | task=%s provider=%s model=%s url=%s expect_json=%s max_tokens=%s",
            task_name,
            target.provider_name,
            target.model,
            url,
            expect_json,
            max_tokens,
        )
        last_error: ExternalAIServiceError | None = None
        body: dict | None = None

        task_norm_retry = task_name.strip().lower().removesuffix("_json_repair")
        if task_norm_retry == "path_review":
            total_rounds = 1
        else:
            total_rounds = max(1, int(self.retry_attempts))
        for round_index in range(total_rounds):
            if _step_budget_exhausted(deadline):
                # Out of step budget before this round even started: surface the
                # real provider failure instead of letting the caller cancel us.
                raise last_error or _step_budget_error(target)
            ordered_api_keys = self._ordered_api_keys(target)
            available_api_keys = [api_key for api_key in ordered_api_keys if _api_key_cooldown_seconds(api_key) <= 0]
            if available_api_keys:
                ordered_api_keys = available_api_keys
            elif wait_for_cooldown:
                ordered_api_keys = sorted(ordered_api_keys, key=_api_key_cooldown_seconds)
            elif not wait_for_cooldown:
                raise self._rate_limit_error(target, _target_rate_limit_cooldown_seconds(target))
            for api_key in ordered_api_keys:
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                }
                try:
                    if wait_for_cooldown:
                        await self._wait_for_rate_limit_cooldown(target, task_name=task_name, api_key=api_key, deadline=deadline)
                    await self._wait_for_provider_slot(target, api_key=api_key, check_rate_limit=not wait_for_cooldown, deadline=deadline)
                    async with httpx.AsyncClient(timeout=_attempt_timeout_seconds(target.timeout_seconds, deadline)) as client:
                        response = await client.post(url, json=payload, headers=headers)
                        response.raise_for_status()
                        body = response.json()
                        break
                except httpx.TimeoutException as exc:
                    last_error = ExternalAIServiceError(
                        _provider_timeout_message(target.provider_name),
                        provider=target.provider_name,
                        retryable=True,
                        failure_kind="timeout",
                    )
                    if len(ordered_api_keys) > 1:
                        continue
                    if round_index >= total_rounds - 1:
                        raise last_error from exc
                except httpx.ConnectError as exc:
                    last_error = ExternalAIServiceError(
                        _provider_connection_message(target.provider_name),
                        provider=target.provider_name,
                        retryable=True,
                        failure_kind="connection",
                    )
                    if len(ordered_api_keys) > 1:
                        continue
                    if round_index >= total_rounds - 1:
                        raise last_error from exc
                except httpx.HTTPStatusError as exc:
                    last_error = _map_provider_http_error(target.provider_name, exc.response)
                    self._record_rate_limit_if_needed(last_error, api_key=api_key)
                    if not _should_try_next_key(last_error):
                        raise last_error from exc
                    if (
                        last_error.failure_kind == "rate_limit"
                        and last_error.retry_after_seconds is None
                        and len(ordered_api_keys) <= 1
                        and not wait_for_cooldown
                    ):
                        raise last_error from exc
                    if len(ordered_api_keys) > 1:
                        continue
                    if round_index >= total_rounds - 1:
                        raise last_error from exc
                except httpx.HTTPError as exc:
                    last_error = ExternalAIServiceError(
                        _provider_runtime_message(target.provider_name),
                        provider=target.provider_name,
                        retryable=True,
                        failure_kind="runtime",
                    )
                    if len(ordered_api_keys) > 1:
                        continue
                    if round_index >= total_rounds - 1:
                        raise last_error from exc

            if body is not None:
                break
            if last_error is None:
                break
            if round_index >= total_rounds - 1 or not last_error.retryable:
                raise last_error
            delay_seconds = _retry_delay_seconds(last_error, self.retry_backoff_seconds * (2**round_index))
            if delay_seconds > 0:
                if _step_budget_exhausted(deadline, extra_seconds=delay_seconds):
                    # Sleeping would run past the step budget. Report the real
                    # reason (rate-limit cooldown, provider timeout) now so the
                    # caller can retry the step, instead of being cancelled
                    # while asleep and blamed as an unavailable provider.
                    raise last_error
                await asyncio.sleep(delay_seconds)

        if body is None:
            if last_error is not None:
                raise last_error
            raise ExternalAIServiceError(
                _provider_runtime_message(target.provider_name),
                provider=target.provider_name,
                retryable=True,
                failure_kind="runtime",
            )

        choices = body.get("choices", [])
        if not choices:
            raise ExternalAIServiceError(
                "The configured AI provider returned no completion choices.",
                provider=target.provider_name,
                retryable=True,
                failure_kind="output_format",
            )
        content = _extract_completion_text(body)
        if content:
            return content
        raise ExternalAIServiceError(
            _provider_output_message(target.provider_name),
            provider=target.provider_name,
            retryable=False,
            failure_kind="output_format",
        )

    async def _chat_with_tools(
        self,
        *,
        task_name: str,
        max_tokens: int,
        messages: list[dict],
        tools: list[dict] | None = None,
    ) -> dict:
        target = self._target_for_task(task_name)
        payload: dict[str, object] = {
            "model": target.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.02,
            "top_p": 1,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools

        url = _chat_completions_url(target.base_url)
        last_error: ExternalAIServiceError | None = None
        body: dict | None = None

        total_rounds = max(1, int(self.retry_attempts))
        for round_index in range(total_rounds):
            ordered_api_keys = self._ordered_api_keys(target)
            available_api_keys = [api_key for api_key in ordered_api_keys if _api_key_cooldown_seconds(api_key) <= 0]
            if available_api_keys:
                ordered_api_keys = available_api_keys
            else:
                raise self._rate_limit_error(target, _target_rate_limit_cooldown_seconds(target))
            for api_key in ordered_api_keys:
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                }
                try:
                    await self._wait_for_provider_slot(target, api_key=api_key)
                    async with httpx.AsyncClient(timeout=target.timeout_seconds) as client:
                        response = await client.post(url, json=payload, headers=headers)
                        response.raise_for_status()
                        body = response.json()
                        break
                except httpx.TimeoutException as exc:
                    last_error = ExternalAIServiceError(
                        _provider_timeout_message(target.provider_name),
                        provider=target.provider_name, retryable=True, failure_kind="timeout",
                    )
                    if len(ordered_api_keys) > 1: continue
                    if round_index >= total_rounds - 1: raise last_error from exc
                except httpx.HTTPStatusError as exc:
                    last_error = _map_provider_http_error(target.provider_name, exc.response)
                    self._record_rate_limit_if_needed(last_error, api_key=api_key)
                    if not _should_try_next_key(last_error): raise last_error from exc
                    if last_error.failure_kind == "rate_limit" and last_error.retry_after_seconds is None and len(ordered_api_keys) <= 1: raise last_error from exc
                    if len(ordered_api_keys) > 1: continue
                    if round_index >= total_rounds - 1: raise last_error from exc
                except httpx.HTTPError as exc:
                    last_error = ExternalAIServiceError(
                        _provider_runtime_message(target.provider_name),
                        provider=target.provider_name, retryable=True, failure_kind="runtime",
                    )
                    if len(ordered_api_keys) > 1: continue
                    if round_index >= total_rounds - 1: raise last_error from exc

            if body is not None: break
            if last_error is None: break
            if round_index >= total_rounds - 1 or not last_error.retryable: raise last_error
            delay_seconds = _retry_delay_seconds(last_error, self.retry_backoff_seconds * (2**round_index))
            if delay_seconds > 0:
                await asyncio.sleep(delay_seconds)

        if body is None:
            raise last_error or ExternalAIServiceError(
                _provider_runtime_message(target.provider_name),
                provider=target.provider_name, retryable=True, failure_kind="runtime",
            )

        choices = body.get("choices", [])
        if not choices:
            raise ExternalAIServiceError(
                "AI provider returned no completion choices.",
                provider=target.provider_name, retryable=True, failure_kind="output_format",
            )
        choice = choices[0]
        msg = choice.get("message", {})
        finish_reason = choice.get("finish_reason", "")

        result: dict = {"role": "assistant", "content": msg.get("content", "") or ""}
        tool_calls = msg.get("tool_calls")
        if tool_calls:
            parsed_calls = []
            for tc in tool_calls:
                fn = tc.get("function", {})
                parsed_calls.append({
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": fn.get("name", ""), "arguments": fn.get("arguments", "{}")},
                })
            result["tool_calls"] = parsed_calls
        result["finish_reason"] = finish_reason
        return result

    def _target_for_task(self, task_name: str) -> _ProviderTarget:
        base_timeout = float(self.request_timeout_seconds)
        task_norm = task_name.strip().lower().removesuffix("_json_repair")
        if task_norm == "path_review":
            timeout = min(base_timeout, 30.0)
        elif task_norm == "repository_map":
            timeout = min(base_timeout, 30.0)
        elif task_norm in {"verdict", "finding_validate"}:
            timeout = min(base_timeout, 30.0)
        else:
            timeout = min(base_timeout, 30.0)
        return _ProviderTarget(
            provider_name=self.provider_name,
            base_url=self.base_url,
            api_keys=self.api_keys,
            timeout_seconds=timeout,
            model=self.model_router.route(task_name),
            enable_thinking=self.enable_thinking,
        )

    async def _repair_json_response(self, *, task_name: str, messages: list[dict], raw_responses: list[str], deadline: float | None = None) -> dict:
        if not raw_responses:
            return {}

        repair_target = self._target_for_task("json_repair")
        repair_messages = _build_json_repair_messages(task_name=task_name, messages=messages, raw_response=raw_responses[-1])
        repair_budget = min(max(1024, len(raw_responses[-1]) // 2), 2048)

        content = await self._chat_text(
            task_name=f"{task_name}_json_repair",
            max_tokens=repair_budget,
            messages=repair_messages,
            expect_json=True,
            target=repair_target,
            deadline=deadline,
        )
        return extract_json(content)

    def _ordered_api_keys(self, target: _ProviderTarget) -> list[str]:
        api_keys = list(target.api_keys)
        if len(api_keys) <= 1:
            return api_keys

        cursor = self._api_key_cursor % len(api_keys)
        self._api_key_cursor = (cursor + 1) % len(api_keys)
        return [*api_keys[cursor:], *api_keys[:cursor]]

    def _rate_limit_error(self, target: _ProviderTarget, remaining_seconds: float) -> ExternalAIServiceError:
        remaining_seconds = max(0.0, float(remaining_seconds))
        self._runtime_metrics["rate_limit_short_circuits"] = self._runtime_metrics.get("rate_limit_short_circuits", 0) + 1
        return ExternalAIServiceError(
            f"NVIDIA rate limits are cooling down. Retry in {int(remaining_seconds) + 1} second(s).",
            provider=target.provider_name,
            retryable=True,
            status_code=429,
            failure_kind="rate_limit",
            retry_after_seconds=remaining_seconds,
        )

    def _raise_if_rate_limited(self, target: _ProviderTarget, *, api_key: str | None = None) -> None:
        remaining_seconds = _target_rate_limit_cooldown_seconds(target) if api_key is None else _api_key_cooldown_seconds(api_key)
        if remaining_seconds <= 0:
            return
        raise self._rate_limit_error(target, remaining_seconds)

    def _record_rate_limit_if_needed(self, error: ExternalAIServiceError, *, api_key: str | None = None) -> None:
        global _PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL
        if error.failure_kind != "rate_limit":
            return
        cooldown_seconds = _rate_limit_cooldown_seconds(error)
        cooldown_until = time.monotonic() + cooldown_seconds
        if api_key is None:
            _PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL = max(_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL, cooldown_until)
        else:
            current_until = _PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY.get(api_key, 0.0)
            _PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY[api_key] = max(current_until, cooldown_until)
        self._runtime_metrics["rate_limit_responses"] = self._runtime_metrics.get("rate_limit_responses", 0) + 1
        self._runtime_events.append("AI provider key rate limit cooldown activated; other configured keys may continue handling requests.")

    async def _wait_for_rate_limit_cooldown(self, target: _ProviderTarget, *, task_name: str, api_key: str | None = None, deadline: float | None = None) -> None:
        remaining_seconds = _target_rate_limit_cooldown_seconds(target) if api_key is None else _api_key_cooldown_seconds(api_key)
        if remaining_seconds <= 0:
            return
        wait_seconds = min(remaining_seconds, _RATE_LIMIT_MAX_COOLDOWN_SECONDS)
        if _step_budget_exhausted(deadline, extra_seconds=wait_seconds):
            # Waiting out the cooldown would overrun the step budget. Report the
            # cooldown with its real remaining time so the caller decides whether
            # to retry the step, instead of blocking until it gets cancelled.
            raise self._rate_limit_error(target, remaining_seconds)
        self._runtime_metrics["rate_limit_waits"] = self._runtime_metrics.get("rate_limit_waits", 0) + 1
        logger.info(
            "AI request waiting for provider rate-limit cooldown | task=%s provider=%s wait_seconds=%.2f",
            task_name,
            target.provider_name,
            wait_seconds,
        )
        await asyncio.sleep(wait_seconds)

    async def _wait_for_provider_slot(self, target: _ProviderTarget, *, api_key: str, check_rate_limit: bool = True, deadline: float | None = None) -> None:
        while True:
            async with _PROVIDER_REQUEST_LOCK:
                if check_rate_limit:
                    self._raise_if_rate_limited(target, api_key=api_key)
                now = time.monotonic()
                wait_seconds = _PROVIDER_NEXT_REQUEST_AT_BY_KEY.get(api_key, 0.0) - now
                if wait_seconds <= 0:
                    interval_seconds = max(0.0, float(self.min_request_interval_seconds))
                    _PROVIDER_NEXT_REQUEST_AT_BY_KEY[api_key] = now + interval_seconds
                    return

            if wait_seconds > 0:
                if _step_budget_exhausted(deadline, extra_seconds=wait_seconds):
                    raise _step_budget_error(target)
                logger.info(
                    "AI request throttled | provider=%s wait_seconds=%.2f",
                    target.provider_name,
                    wait_seconds,
                )
                await asyncio.sleep(wait_seconds)


def _remaining_step_seconds(deadline: float | None) -> float | None:
    if deadline is None:
        return None
    return deadline - time.monotonic()


def _step_budget_exhausted(deadline: float | None, extra_seconds: float = 0.0) -> bool:
    """True when the step budget cannot cover another wait of ``extra_seconds``."""
    remaining = _remaining_step_seconds(deadline)
    if remaining is None:
        return False
    return remaining - max(0.0, extra_seconds) <= 0


def _attempt_timeout_seconds(configured_timeout: float, deadline: float | None) -> float:
    """Clamp one HTTP attempt so it cannot outlive the remaining step budget."""
    remaining = _remaining_step_seconds(deadline)
    if remaining is None:
        return configured_timeout
    return max(1.0, min(configured_timeout, remaining))


def _step_budget_error(target: _ProviderTarget) -> ExternalAIServiceError:
    return ExternalAIServiceError(
        _provider_timeout_message(target.provider_name),
        provider=target.provider_name,
        retryable=True,
        failure_kind="timeout",
    )


def _should_wait_for_rate_limit_cooldown(task_name: str) -> bool:
    normalized = task_name.removesuffix("_json_repair")
    return normalized in _COOLDOWN_WAIT_TASKS


def _api_key_cooldown_seconds(api_key: str) -> float:
    key_until = _PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY.get(api_key, 0.0)
    global_until = _PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL
    return max(0.0, max(key_until, global_until) - time.monotonic())


def _target_rate_limit_cooldown_seconds(target: _ProviderTarget) -> float:
    global_remaining = max(0.0, _PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL - time.monotonic())
    key_remaining = [_api_key_cooldown_seconds(api_key) for api_key in target.api_keys]
    if global_remaining > 0:
        return global_remaining
    if key_remaining and all(remaining > 0 for remaining in key_remaining):
        return min(key_remaining)
    return 0.0


def _coerce_message_text(value) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                if item.strip():
                    parts.append(item.strip())
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return "\n".join(parts).strip()
    return ""


def _force_json_only_messages(messages: list[dict]) -> list[dict]:
    forced_messages = list(messages)
    if not forced_messages:
        return forced_messages
    forced_messages[-1] = {
        **forced_messages[-1],
        "content": (
            f"{forced_messages[-1].get('content', '')}\n\n"
            "Return exactly one JSON object and nothing else. "
            "Do not use markdown fences, bullet lists, or explanatory prose. "
            "If a field has no evidence, return an empty string or empty array instead of commentary."
        ),
    }
    return forced_messages


def _build_json_repair_messages(*, task_name: str, messages: list[dict], raw_response: str) -> list[dict]:
    system_prompt = ""
    user_prompt = ""
    if messages:
        system_prompt = _message_content_as_text(messages[0].get("content"))
        user_prompt = _message_content_as_text(messages[-1].get("content"))

    return [
        {
            "role": "system",
            "content": (
                "You repair malformed AI outputs into one strict JSON object. "
                "Preserve only claims grounded in the provided raw output and task instructions. "
                "Return exactly one JSON object and nothing else."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Task: {task_name}\n"
                f"Original system instructions:\n{shorten(system_prompt, width=1800, placeholder='...')}\n\n"
                f"Original request:\n{shorten(user_prompt, width=2200, placeholder='...')}\n\n"
                f"Raw model output to repair:\n{shorten(raw_response, width=3200, placeholder='...')}"
            ),
        },
    ]


def _message_content_as_text(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts).strip()
    return str(value or "")


def _extract_completion_text(body: dict) -> str:
    choices = body.get("choices", [])
    if not isinstance(choices, list) or not choices:
        return ""

    choice = choices[0] if isinstance(choices[0], dict) else {}
    message = choice.get("message", {})
    if not isinstance(message, dict):
        message = {}

    for value in (
        message.get("parsed"),
        message.get("json"),
        body.get("output"),
        body.get("output_text"),
        choice.get("text"),
        message.get("content"),
        message.get("reasoning_content"),
    ):
        text = _coerce_payload_text(value)
        if text:
            return text

    function_call = message.get("function_call")
    if isinstance(function_call, dict):
        arguments = _coerce_payload_text(function_call.get("arguments"))
        if arguments:
            return arguments

    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list):
        for tool_call in tool_calls:
            if not isinstance(tool_call, dict):
                continue
            function = tool_call.get("function")
            if not isinstance(function, dict):
                continue
            arguments = _coerce_payload_text(function.get("arguments"))
            if arguments:
                return arguments

    return ""


def _coerce_payload_text(value) -> str:
    if isinstance(value, dict):
        try:
            return json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError):
            return ""
    return _coerce_message_text(value)


def _extract_provider_message(body: dict | None) -> str:
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()
        detail = body.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
    return "Unknown provider error"


def _short_reason(message: str) -> str:
    # Keep the provider reason readable but trim provider-specific internals like
    # account or function ids that add noise for the user.
    stripped = message.strip().lstrip("'").lstrip('"')
    if not stripped:
        return "the model or function was not found"
    # Drop trailing portion after 'for account' so account ids never surface.
    marker = stripped.lower().find("for account")
    if marker >= 0:
        stripped = stripped[:marker].rstrip(":., '\"")
    return stripped or "the model or function was not found"


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if not value:
        return None

    stripped = value.strip()
    try:
        seconds = float(stripped)
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(stripped)
        except (TypeError, ValueError, IndexError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        seconds = (retry_at - datetime.now(timezone.utc)).total_seconds()

    if seconds <= 0:
        return None
    return min(seconds, _RATE_LIMIT_MAX_COOLDOWN_SECONDS)


def _retry_delay_seconds(error: ExternalAIServiceError | None, fallback_seconds: float) -> float:
    if error is not None and error.retry_after_seconds is not None:
        return min(max(0.0, float(error.retry_after_seconds)), _RATE_LIMIT_MAX_COOLDOWN_SECONDS)
    return min(max(0.0, float(fallback_seconds)), 15.0)


def _rate_limit_cooldown_seconds(error: ExternalAIServiceError) -> float:
    if error.retry_after_seconds is not None:
        return min(max(0.0, float(error.retry_after_seconds)), _RATE_LIMIT_MAX_COOLDOWN_SECONDS)
    return min(_RATE_LIMIT_FALLBACK_COOLDOWN_SECONDS, _RATE_LIMIT_MAX_COOLDOWN_SECONDS)


def _chat_completions_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _resolve_nvidia_model(settings, *, tier: str) -> str:
    if tier == "small":
        return settings.ai_small_model or settings.nvidia_small_model or settings.nvidia_model
    return settings.ai_large_model or settings.nvidia_large_model or settings.nvidia_model


def _resolve_nvidia_api_keys(settings) -> tuple[str, ...]:
    raw_keys = []
    if settings.nvidia_api_keys:
        raw_keys.extend(settings.nvidia_api_keys)
    if settings.nvidia_api_key:
        raw_keys.append(settings.nvidia_api_key)

    normalized: list[str] = []
    seen: set[str] = set()
    for item in raw_keys:
        key = str(item).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    return tuple(normalized)


def _review_file_list(work_items: list[dict]) -> str:
    seen: list[str] = []
    for item in work_items:
        file_path = str(item.get("file", "")).strip()
        if file_path and file_path not in seen:
            seen.append(file_path)
    return ", ".join(seen[:12]) or "unknown"


def _code_review_chars(max_input_tokens: int) -> int:
    # The reviewer needs the real code in the window, not a 4k-char stub. Roughly
    # 4 chars per token, scaled to the model's input budget so a large window is
    # used but a prompt never grows unbounded.
    return min(max(int(max_input_tokens * 2.4), 6000), 32000)


def _slim_review_work_items(work_items: list[dict]) -> list[dict]:
    """Send what a reviewer needs to anchor a finding and nothing else.

    The snippet already carries real file line numbers, so the model can quote
    `file:line` without guessing. `review_focus` and `related_attack_surface`
    are dropped: they bias the reviewer toward taint analysis and away from the
    correctness axes that make up most of a code review.
    """
    slim_items: list[dict] = []
    for item in work_items[:12]:
        slim_items.append(
            {
                "file": str(item.get("file", "")).strip(),
                "start_line": str(item.get("start_line", 1)),
                "end_line": str(item.get("end_line", 1)),
                "snippet": str(item.get("snippet", ""))[:1600],
            }
        )
    return slim_items


def _review_findings_for_debate(findings: list[dict], *, include_evidence: bool = False) -> list[dict]:
    """Project debate-lane findings back onto the prompt contract.

    Keeps the `id` the challenger and arbiter must answer with, and only the
    fields that decide the verdict.
    """
    projected: list[dict] = []
    for index, item in enumerate(findings[:14], start=1):
        entry = {
            "id": str(item.get("review_id", "")).strip() or f"F{index}",
            "severity": str(item.get("severity", "medium")),
            "axis": str(item.get("review_axis", "correctness")),
            "title": str(item.get("title", "")),
            "file": str(item.get("file", "")),
            "line": int(item.get("line", 1)),
            "line_end": int(item.get("line_end", item.get("line", 1))),
            "claim": str(item.get("summary", "")),
            "recommendation": str(item.get("recommendation", "")),
            "confidence": int(item.get("confidence", 70)),
        }
        if include_evidence:
            entry["evidence"] = str(item.get("evidence", ""))
        projected.append(entry)
    return projected


def _compact_penetration_repository_map(repository_map: object) -> dict:
    if not isinstance(repository_map, dict):
        return {}
    compact_map = {
        "review_note": str(repository_map.get("review_note", "")).strip(),
        "coverage_note": str(repository_map.get("coverage_note", "")).strip(),
        "trust_boundaries": [str(item).strip() for item in repository_map.get("trust_boundaries", []) if str(item).strip()][:6],
    }
    priority_paths = repository_map.get("priority_paths", [])
    if isinstance(priority_paths, list):
        compact_map["priority_paths"] = [item for item in priority_paths if isinstance(item, dict)][:6]
    else:
        compact_map["priority_paths"] = []
    return compact_map


def _coerce_positive_int(value: object, *, fallback: int = 0) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return max(0, int(fallback))


def _coerce_percentage(value: object, *, fallback: int = 0) -> int:
    try:
        parsed = int(value or 0)
    except (TypeError, ValueError):
        parsed = int(fallback)
    return max(0, min(100, parsed))


def _average_finding_confidence(findings: list[dict]) -> int:
    confidences: list[int] = []
    for item in findings:
        if not isinstance(item, dict):
            continue
        try:
            confidences.append(max(0, min(100, int(item.get("confidence", 0) or 0))))
        except (TypeError, ValueError):
            continue
    if not confidences:
        return 0
    return int(round(sum(confidences) / len(confidences)))


def _build_task_model_overrides(settings) -> dict[str, str]:
    detection_model = settings.nvidia_detection_model or settings.nvidia_model
    explain_model = settings.nvidia_explain_model or settings.nvidia_large_model or settings.nvidia_model
    fix_model = settings.nvidia_fix_model or settings.nvidia_model
    validation_model = settings.nvidia_validation_model or settings.nvidia_large_model or settings.nvidia_model
    penetration_model = settings.nvidia_penetration_model or settings.nvidia_model

    return {
        "repository_map": detection_model,
        "path_review": detection_model,
        "finding_validate": detection_model,
        "verdict": detection_model,
        "code_review": detection_model,
        "review_challenge": detection_model,
        "review_arbitrate": detection_model,
        "explain": explain_model,
        "fix_draft": fix_model,
        "fix_retry": fix_model,
        "fix_validate": validation_model,
        "patch_validate": validation_model,
        "final_patch": validation_model,
        "json_repair": validation_model,
        "penetration_test": penetration_model,
    }


def _provider_timeout_message(provider_name: str) -> str:
    return f"{provider_name.capitalize() if provider_name.lower() != 'openai' else 'OpenAI'} timed out while processing the request. Retry shortly."


def _provider_connection_message(provider_name: str) -> str:
    return f"CodeGuard could not reach {provider_name.capitalize() if provider_name.lower() != 'openai' else 'OpenAI'}. Check network access and retry."


def _provider_runtime_message(provider_name: str) -> str:
    return f"{provider_name.capitalize() if provider_name.lower() != 'openai' else 'OpenAI'} could not complete the request because of an upstream runtime failure."


def _provider_output_message(provider_name: str) -> str:
    return f"{provider_name.capitalize() if provider_name.lower() != 'openai' else 'OpenAI'} returned a completion without usable content."


def _map_provider_http_error(provider_name: str, response: httpx.Response) -> ExternalAIServiceError:
    try:
        body = response.json()
    except ValueError:
        body = None
    message = _extract_provider_message(body)
    normalized = message.lower()
    status_code = response.status_code
    provider_label = provider_name.capitalize() if provider_name.lower() != "openai" else "OpenAI"

    if status_code == 429:
        retry_after_seconds = _retry_after_seconds(response)
        return ExternalAIServiceError(
            f"{provider_label} rate limits were reached while processing the request. Retry in a moment.",
            provider=provider_name,
            retryable=True,
            status_code=status_code,
            failure_kind="rate_limit",
            retry_after_seconds=retry_after_seconds,
        )
    if status_code == 413 or "request too large" in normalized or "max tokens" in normalized or "context" in normalized:
        return ExternalAIServiceError(
            f"{provider_label} rejected the request size: {message}",
            provider=provider_name,
            retryable=True,
            status_code=status_code,
            failure_kind="payload_too_large",
        )
    if status_code in {502, 503, 504}:
        return ExternalAIServiceError(
            f"{provider_label} returned an upstream gateway error ({status_code}). Retry the request.",
            provider=provider_name,
            retryable=True,
            status_code=status_code,
            failure_kind="gateway",
        )
    if status_code >= 500:
        return ExternalAIServiceError(
            f"{provider_label} returned an unexpected upstream error ({status_code}). Retry the request.",
            provider=provider_name,
            retryable=True,
            status_code=status_code,
            failure_kind="upstream",
        )
    if status_code == 404 or "not found" in normalized or "not found for account" in normalized or "not authorized" in normalized or "does not exist" in normalized:
        return ExternalAIServiceError(
            f"The configured model is not available for this {provider_label} account: {_short_reason(message)}",
            provider=provider_name,
            retryable=False,
            status_code=status_code,
            failure_kind="model_unavailable",
        )
    if status_code in {401, 403} or "unauthorized" in normalized or "authentication" in normalized or "api key" in normalized:
        return ExternalAIServiceError(
            f"The API key was rejected by {provider_label} â€” check that the key is valid for your account",
            provider=provider_name,
            retryable=False,
            status_code=status_code,
            failure_kind="auth",
        )
    return ExternalAIServiceError(
        f"{provider_label} rejected the request because of an invalid configuration",
        provider=provider_name,
        retryable=False,
        status_code=status_code,
        failure_kind="request_rejected",
    )


def _should_try_next_key(error: ExternalAIServiceError) -> bool:
    if error.status_code in {401, 403, 429, 500, 502, 503, 504}:
        return True
    return error.retryable and error.failure_kind in {"timeout", "connection", "runtime", "rate_limit", "gateway", "upstream"}




