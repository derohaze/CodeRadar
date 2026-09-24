from __future__ import annotations

import asyncio
import time
from typing import Any

from app.application.dto.runtime_settings_contracts import RuntimeSettingsResponse
from app.infrastructure.ai.providers.encryption import decrypt_api_key, mask_api_key
from app.infrastructure.settings.runtime_settings_repository import RuntimeSettingsRepository


class RuntimeSettingsService:
    def __init__(
        self,
        repository: RuntimeSettingsRepository,
        *,
        cache_ttl_seconds: float = 2.0,
    ) -> None:
        self.repository = repository
        self.cache_ttl_seconds = max(0.5, float(cache_ttl_seconds))
        self._cache: RuntimeSettingsResponse | None = None
        self._cache_until = 0.0
        self._lock = asyncio.Lock()

    async def get(self) -> RuntimeSettingsResponse:
        now = time.monotonic()
        if self._cache is not None and now < self._cache_until:
            return self._cache

        async with self._lock:
            now = time.monotonic()
            if self._cache is not None and now < self._cache_until:
                return self._cache
            document = await self.repository.get()
            parsed = self._parse_document(document)
            self._cache = parsed
            self._cache_until = now + self.cache_ttl_seconds
            return parsed

    async def update(self, updates: dict[str, Any]) -> RuntimeSettingsResponse:
        # Keep explicit None for ai_* to allow disconnect/clear
        ai_clear_keys = {"ai_provider", "ai_model", "ai_base_url", "ai_api_key"}
        payload = {}
        for key, value in updates.items():
            if value is not None:
                payload[key] = value
            elif key in ai_clear_keys:
                payload[key] = None
        if not payload:
            return await self.get()

        document = await self.repository.update(payload)
        parsed = self._parse_document(document)
        async with self._lock:
            self._cache = parsed
            self._cache_until = time.monotonic() + self.cache_ttl_seconds
        return parsed

    async def get_ai_client_config(self) -> dict | None:
        """Return the plaintext provider config for the scan AI transport.

        Returns None when the user has not saved a usable provider so callers can
        fall back to the env-configured client. The plain key is decrypted here,
        server-side only, and is never included in any API response.
        """
        document = await self.repository.get()
        provider = str(document.get("ai_provider") or "").strip().lower()
        model = str(document.get("ai_model") or "").strip()
        base_url = str(document.get("ai_base_url") or "").strip()
        encrypted = str(document.get("ai_api_key_encrypted") or "")
        api_key = decrypt_api_key(encrypted) if encrypted else ""
        if not provider or not api_key or not model:
            return None
        return {
            "provider": provider,
            "api_key": api_key,
            "base_url": base_url,
            "model": model,
        }

    @staticmethod
    def _parse_document(document: dict[str, Any]) -> RuntimeSettingsResponse:
        encrypted = str(document.get("ai_api_key_encrypted") or "")
        plain = decrypt_api_key(encrypted) if encrypted else ""
        masked = mask_api_key(plain) if plain else None
        has_key = bool(plain)
        return RuntimeSettingsResponse(
            default_preset=str(document.get("default_preset", "balanced")),
            default_scan_mode=str(document.get("default_scan_mode", "deep")),
            auto_open_results=bool(document.get("auto_open_results", True)),
            remember_sidebar_state=bool(document.get("remember_sidebar_state", True)),
            motion_profile=str(document.get("motion_profile", "fluid")),
            theme=str(document.get("theme", "system")),
            surface_contrast=str(document.get("surface_contrast", "soft")),
            remediation_max_attempts=int(document.get("remediation_max_attempts", 3)),
            remediation_reuse_explanation=bool(document.get("remediation_reuse_explanation", True)),
            ai_provider=document.get("ai_provider"),
            ai_model=document.get("ai_model"),
            ai_base_url=document.get("ai_base_url"),
            ai_api_key_masked=masked,
            ai_has_key=has_key,
            updated_at=document["updated_at"],
        )
