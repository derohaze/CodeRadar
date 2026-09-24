from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RuntimeSettingsResponse(BaseModel):
    default_preset: Literal["safe", "balanced", "aggressive"]
    default_scan_mode: Literal["fast", "deep"]
    auto_open_results: bool
    remember_sidebar_state: bool
    motion_profile: Literal["fluid", "reduced", "instant"]
    theme: Literal["light", "dark", "system"]
    surface_contrast: Literal["soft", "standard"]
    remediation_max_attempts: int = Field(ge=1, le=5)
    remediation_reuse_explanation: bool
    ai_provider: str | None = Field(default=None, description="Active provider id")
    ai_model: str | None = Field(default=None, description="Selected model id")
    ai_base_url: str | None = Field(default=None, description="Custom base URL")
    ai_api_key_masked: str | None = Field(default=None, description="Masked API key")
    ai_has_key: bool = Field(default=False, description="Whether API key is stored")
    updated_at: datetime


class UpdateRuntimeSettingsRequest(BaseModel):
    default_preset: Literal["safe", "balanced", "aggressive"] | None = None
    default_scan_mode: Literal["fast", "deep"] | None = None
    auto_open_results: bool | None = None
    remember_sidebar_state: bool | None = None
    motion_profile: Literal["fluid", "reduced", "instant"] | None = None
    theme: Literal["light", "dark", "system"] | None = None
    surface_contrast: Literal["soft", "standard"] | None = None
    remediation_max_attempts: int | None = Field(default=None, ge=1, le=5)
    remediation_reuse_explanation: bool | None = None
    ai_provider: str | None = Field(default=None, description="Provider id: openai, anthropic, deepseek, gemini, grok, nvidia, custom")
    ai_api_key: str | None = Field(default=None, description="Plain API key to encrypt and store")
    ai_base_url: str | None = Field(default=None, description="Base URL for custom provider")
    ai_model: str | None = Field(default=None, description="Selected model id")


# Provider-specific contracts
class ProviderInfo(BaseModel):
    id: str
    name: str
    default_base_url: str | None = None
    docs_url: str | None = None


class ProviderTestRequest(BaseModel):
    provider: str = Field(description="Provider id")
    api_key: str | None = Field(default=None, description="API key to test — if empty, server will try stored key for same provider")
    base_url: str | None = Field(default=None, description="Custom base URL")
    model: str | None = Field(default=None, description="Model to test with")


class ProviderTestResponse(BaseModel):
    ok: bool
    message: str
    latency_ms: int | None = None


class ProviderModelsRequest(BaseModel):
    provider: str
    api_key: str
    base_url: str | None = None


class ProviderModelsResponse(BaseModel):
    models: list[dict]
