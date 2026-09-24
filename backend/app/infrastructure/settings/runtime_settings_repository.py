from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.config import get_settings
from app.infrastructure.ai.providers.encryption import decrypt_api_key, encrypt_api_key, mask_api_key
from app.infrastructure.database.collections import RUNTIME_SETTINGS_COLLECTION
from app.infrastructure.database.mongo import get_database


RUNTIME_SETTINGS_DOCUMENT_ID = "global"


class RuntimeSettingsRepository:
    def __init__(self) -> None:
        self.collection = get_database()[RUNTIME_SETTINGS_COLLECTION]

    async def get(self) -> dict[str, Any]:
        document = await self.collection.find_one({"_id": RUNTIME_SETTINGS_DOCUMENT_ID})
        if document is None:
            settings = self._build_default_document()
            await self.collection.update_one(
                {"_id": RUNTIME_SETTINGS_DOCUMENT_ID},
                {
                    "$setOnInsert": settings,
                },
                upsert=True,
            )
            return settings
        return self._normalize_document(document)

    async def update(self, updates: dict[str, Any]) -> dict[str, Any]:
        current = await self.get()
        # Handle provider api_key encryption: plain ai_api_key -> encrypted ai_api_key_encrypted
        if "ai_api_key" in updates:
            plain = updates.pop("ai_api_key")
            if plain is not None and str(plain).strip():
                updates["ai_api_key_encrypted"] = encrypt_api_key(str(plain).strip())
            else:
                # Clear key if empty string or None (disconnect)
                updates["ai_api_key_encrypted"] = ""
        # Handle explicit disconnect: ai_provider/model/base_url = None or "" -> clear to None
        for field in ("ai_provider", "ai_model", "ai_base_url"):
            if field in updates and (updates[field] is None or updates[field] == ""):
                updates[field] = None
        # Normalize None base_url/model to allow clearing
        next_document = {
            **current,
            **updates,
            "updated_at": datetime.now(UTC),
        }
        await self.collection.update_one(
            {"_id": RUNTIME_SETTINGS_DOCUMENT_ID},
            {
                "$set": {
                    key: value
                    for key, value in next_document.items()
                    if key not in ("_id", "created_at")
                },
                "$setOnInsert": {"created_at": current.get("created_at", datetime.now(UTC))},
            },
            upsert=True,
        )
        return next_document

    def _build_default_document(self) -> dict[str, Any]:
        settings = get_settings()
        now = datetime.now(UTC)
        return {
            "_id": RUNTIME_SETTINGS_DOCUMENT_ID,
            "default_preset": "balanced",
            "default_scan_mode": "deep",
            "auto_open_results": True,
            "remember_sidebar_state": True,
            "motion_profile": "fluid",
            "theme": "system",
            "surface_contrast": "soft",
            "remediation_max_attempts": 3,
            "remediation_reuse_explanation": True,
            "ai_provider": None,
            "ai_model": None,
            "ai_base_url": None,
            "ai_api_key_encrypted": "",
            "created_at": now,
            "updated_at": now,
        }

    def _normalize_document(self, document: dict[str, Any]) -> dict[str, Any]:
        normalized = self._build_default_document()
        normalized.update({
            key: value
            for key, value in document.items()
            if key in normalized
        })
        normalized["_id"] = RUNTIME_SETTINGS_DOCUMENT_ID
        return normalized
