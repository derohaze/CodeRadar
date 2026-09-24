# Greptile-inspired: model-aware context budgets so cheap models don't hallucinate on over-filled prompts
MODEL_CONTEXT_BUDGETS = {
    # default buckets by model family token window
    "gpt-oss-120b": {"context": 128000, "reserve": 12000, "max_output": 4096},
    "gpt-oss-20b": {"context": 64000, "reserve": 8000, "max_output": 4096},
    "deepseek-v4": {"context": 64000, "reserve": 8000, "max_output": 4096},
    "deepseek-v3": {"context": 64000, "reserve": 8000, "max_output": 4096},
    "claude": {"context": 200000, "reserve": 16000, "max_output": 4096},
    "gemini": {"context": 100000, "reserve": 12000, "max_output": 4096},
    "llama": {"context": 32000, "reserve": 6000, "max_output": 4096},
    "default": {"context": 32000, "reserve": 6000, "max_output": 4096},
}

def _budget_for_model(model_id: str) -> dict:
    mid = (model_id or "").lower()
    for key, budget in MODEL_CONTEXT_BUDGETS.items():
        if key in mid:
            return budget
    return MODEL_CONTEXT_BUDGETS["default"]


class ModelRouter:
    def __init__(
        self,
        *,
        small_model: str,
        large_model: str,
        overflow_model: str | None = None,
        scout_model: str | None = None,
        task_overrides: dict[str, str] | None = None,
    ) -> None:
        self.small_model = small_model
        self.large_model = large_model
        self.overflow_model = overflow_model
        self.scout_model = scout_model
        self.task_overrides = {
            str(task_name).strip().lower(): str(model).strip()
            for task_name, model in (task_overrides or {}).items()
            if str(task_name).strip() and str(model).strip()
        }

    def route(self, task_name: str) -> str:
        return self.route_candidates(task_name)[0]

    def route_candidates(self, task_name: str) -> list[str]:
        normalized = task_name.strip().lower()
        override = self.task_overrides.get(normalized)
        if override:
            return self._with_fallbacks(override)

        depth_tasks = {"explain", "fix_validate", "patch_validate", "final_patch", "verdict", "finding_validate"}
        if normalized in depth_tasks:
            return self._with_fallbacks(self.large_model)

        return self._with_fallbacks(self.small_model)

    def token_budget_for(self, task_name: str) -> dict:
        """Return adaptive token budget for task — automatically scales to model window"""
        model = self.route(task_name)
        budget = _budget_for_model(model)
        # Reserve output + safety margin, leave rest for input
        max_input = max(4000, budget["context"] - budget["reserve"] - budget["max_output"])
        # Shrink for small review tasks to keep prompts tight and hallucination-low
        task_scalar = {
            "repository_map": 0.35,
            "path_review": 0.55,
            "finding_validate": 0.35,
            "verdict": 0.25,
            "explain": 0.25,
            # The reviewer needs the code itself in the window, so it gets more
            # room than the summarising passes.
            "code_review": 0.6,
            "review_challenge": 0.4,
            "review_arbitrate": 0.35,
        }.get(task_name.strip().lower().removesuffix("_json_repair"), 0.4)
        return {
            "model": model,
            "context_window": budget["context"],
            "max_input_tokens": int(max_input * task_scalar),
            "max_output_tokens": budget["max_output"],
        }

    def _with_fallbacks(self, primary_model: str) -> list[str]:
        models = [primary_model]
        for candidate in (self.overflow_model, self.scout_model):
            if candidate and candidate not in models:
                models.append(candidate)
        return models
