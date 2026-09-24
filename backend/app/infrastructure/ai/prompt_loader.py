from pathlib import Path


PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
ACTIVE_RUNTIME_PROMPTS = frozenset(
    {
        "repository_mapper.md",
        "path_reviewer.md",
        "finding_validator.md",
        "verdict_analyst.md",
        "code_reviewer.md",
        "code_reviewer_recheck.md",
        "review_challenger.md",
        "review_arbiter.md",
        "explain_prompt.md",
        "fix_prompt.md",
        "fix_validator_prompt.md",
        "penetration_tester_prompt.md",
    }
)
PROMPT_PACKS = {
    "repository_mapper.md": (
        "shared_scan_rules.md",
        "shared_framework_focus.md",
        "framework_detector.md",
        "scope_planner.md",
        "graph_builder.md",
        "source_sink_locator.md",
        "risk_prioritizer.md",
        "segment_planner.md",
        "repository_mapper.md",
    ),
    "path_reviewer.md": (
        "shared_scan_rules.md",
        "shared_framework_focus.md",
        "source_sink_locator.md",
        "risk_prioritizer.md",
        "path_reviewer.md",
    ),
    "framework_detector.md": ("shared_framework_focus.md", "framework_detector.md"),
    "finding_validator.md": (
        "shared_scan_rules.md",
        "shared_framework_focus.md",
        "source_sink_locator.md",
        "annotation_builder.md",
        "finding_validator.md",
    ),
    "verdict_analyst.md": (
        "shared_scan_rules.md",
        "score_analyst.md",
        "annotation_builder.md",
        "report_writer.md",
        "verdict_analyst.md",
    ),
    "explain_prompt.md": ("shared_remediation_rules.md", "explain_prompt.md"),
    "fix_prompt.md": ("shared_remediation_rules.md", "fix_prompt.md"),
    "fix_validator_prompt.md": ("shared_remediation_rules.md", "fix_validator_prompt.md"),
    "penetration_tester_prompt.md": (
        "shared_scan_rules.md",
        "shared_framework_focus.md",
        "penetration_tester_prompt.md",
    ),
    # Code review lane: main reviewer -> challenger -> arbiter. Deliberately does
    # NOT include shared_scan_rules.md: that file excludes everything that is not a
    # source-to-sink path, which is why general defects never reached the client.
    "code_reviewer.md": (
        "shared_code_review_bar.md",
        "shared_framework_focus.md",
        "annotation_builder.md",
        "code_reviewer.md",
    ),
    "code_reviewer_recheck.md": (
        "shared_code_review_bar.md",
        "shared_framework_focus.md",
        "code_reviewer_recheck.md",
    ),
    "review_challenger.md": (
        "shared_code_review_bar.md",
        "shared_framework_focus.md",
        "review_challenger.md",
    ),
    "review_arbiter.md": (
        "shared_code_review_bar.md",
        "review_arbiter.md",
    ),
}


def load_prompt(name: str, **replacements: str) -> str:
    template = (PROMPTS_DIR / name).read_text(encoding="utf-8")
    if not replacements:
        return template
    return template.format(**replacements)


def load_prompt_pack(name: str, **replacements: str) -> str:
    parts = PROMPT_PACKS.get(name, (name,))
    return "\n\n".join(load_prompt(part, **replacements).strip() for part in parts if part).strip()
