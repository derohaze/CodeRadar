from app.domain.services.ai_client import SecurityAnalysisAIClient


class DetectionAgent:
    def __init__(self, ai_client: SecurityAnalysisAIClient) -> None:
        self.ai_client = ai_client

    async def map_repository(
        self,
        *,
        project_name: str,
        source_path: str,
        repository_profile: dict,
        repository_artifacts: dict,
        preset: str,
    ) -> dict:
        return await self.ai_client.map_repository(
            project_name=project_name,
            source_path=source_path,
            repository_profile=repository_profile,
            repository_artifacts=repository_artifacts,
            preset=preset,
        )

    async def review_paths(
        self,
        *,
        project_name: str,
        source_path: str,
        repository_profile: dict,
        repository_map: dict,
        work_items: list[dict[str, str]],
        batch_index: int,
        total_batches: int,
        preset: str,
    ) -> dict:
        return await self.ai_client.review_paths(
            project_name=project_name,
            source_path=source_path,
            repository_profile=repository_profile,
            repository_map=repository_map,
            work_items=work_items,
            batch_index=batch_index,
            total_batches=total_batches,
            preset=preset,
        )

    async def validate_findings(
        self,
        *,
        project_name: str,
        source_path: str,
        repository_profile: dict,
        repository_map: dict,
        findings: list[dict],
        preset: str,
    ) -> dict:
        return await self.ai_client.validate_findings(
            project_name=project_name,
            source_path=source_path,
            repository_profile=repository_profile,
            repository_map=repository_map,
            findings=findings,
            preset=preset,
        )

    # --- Code review debate lane -------------------------------------------------
    # Three passes ported from the debate-review skill: a main reviewer finds
    # defects across the whole surface, a challenger tries to knock them down,
    # and the main reviewer makes the final call. Unlike the security lane these
    # passes are not limited to source-to-sink paths.

    async def review_code(
        self,
        *,
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
        return await self.ai_client.review_code(
            project_name=project_name,
            source_path=source_path,
            repository_profile=repository_profile,
            repository_map=repository_map,
            work_items=work_items,
            batch_index=batch_index,
            total_batches=total_batches,
            preset=preset,
            recheck=recheck,
        )

    async def challenge_review(
        self,
        *,
        project_name: str,
        source_path: str,
        repository_profile: dict,
        repository_map: dict,
        findings: list[dict],
        work_items: list[dict],
        preset: str,
    ) -> dict:
        return await self.ai_client.challenge_review(
            project_name=project_name,
            source_path=source_path,
            repository_profile=repository_profile,
            repository_map=repository_map,
            findings=findings,
            work_items=work_items,
            preset=preset,
        )

    async def arbitrate_review(
        self,
        *,
        project_name: str,
        source_path: str,
        findings: list[dict],
        debate: dict,
        preset: str,
    ) -> dict:
        return await self.ai_client.arbitrate_review(
            project_name=project_name,
            source_path=source_path,
            findings=findings,
            debate=debate,
            preset=preset,
        )

    def supports_debate_lane(self) -> bool:
        return all(
            hasattr(self.ai_client, name)
            for name in ("review_code", "challenge_review", "arbitrate_review")
        )
