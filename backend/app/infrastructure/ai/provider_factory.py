from __future__ import annotations

from app.core.config import get_settings
from app.core.exceptions import ExternalAIServiceError
from app.domain.services.ai_client import SecurityAnalysisAIClient
from app.infrastructure.ai.scan_client import RUNTIME_TASK_MODELS, ScanAIClient
# Keep old import working for compat
from app.infrastructure.ai.nvidia_security_client import NvidiaSecurityClient  # noqa: F401
from app.infrastructure.ai.providers.registry import get_provider
from app.infrastructure.services.runtime_safety_policy import ensure_allowed_outbound_url

# All OpenAI-compatible providers can drive the scan engine via ScanAIClient.
# Anthropic/Gemini use different wire formats — they are for future typed adapters.
_SUPPORTED_SCAN_PROVIDERS = {"nvidia", "security", "openai", "deepseek", "grok", "custom"}


def build_ai_client() -> SecurityAnalysisAIClient:
    settings = get_settings()
    provider_order = [item.strip().lower() for item in settings.ai_provider_order if item.strip()]
    for provider in provider_order or ["security"]:
        client = _build_provider(provider, settings)
        if client is not None:
            return client
    raise RuntimeError("No supported AI transport is configured. Set NVIDIA_API_KEY or API key in Settings → Providers.")


def _build_provider(provider: str, settings) -> SecurityAnalysisAIClient | None:
    # Generic OpenAI-compatible path — ScanAIClient works for any provider, not just Nvidia
    if provider in _SUPPORTED_SCAN_PROVIDERS and ScanAIClient.is_configured(settings):
        # provider_name is derived from env or explicit provider; ScanAIClient will resolve model/base_url from settings
        return ScanAIClient(provider_name=provider)
    # Fallback: nvidia env check
    if provider in {"nvidia", "security"} and ScanAIClient.is_configured(settings):
        return ScanAIClient(provider_name=provider)
    return None


def build_ai_client_from_runtime_config(config: dict) -> SecurityAnalysisAIClient:
    """Build the scan AI client from settings saved in the Settings screen.

    The saved model, base URL, and API key take precedence over env config so the
    scan actually uses what the user configured. Unsupported providers raise so the
    failure is honest and fast instead of silently running on env defaults.
    """
    provider = str(config["provider"]).strip().lower()
    if provider not in _SUPPORTED_SCAN_PROVIDERS:
        raise ExternalAIServiceError(
            f"The {provider} provider is not wired into the scan engine yet — configure NVIDIA or another OpenAI-compatible provider in Settings",
            provider=provider,
            retryable=False,
            failure_kind="configuration",
        )
    settings = get_settings()
    base_url = str(config.get("base_url") or "").strip()
    if not base_url:
        if provider in {"nvidia", "security"}:
            base_url = settings.nvidia_base_url
        else:
            try:
                base_url = get_provider(provider).default_base_url or ""
            except ValueError:
                base_url = ""
    if not base_url:
        raise ExternalAIServiceError(
            f"No base URL is configured for {provider} — open Settings → Providers and save a base URL",
            provider=provider,
            retryable=False,
            failure_kind="configuration",
        )
    try:
        ensure_allowed_outbound_url(base_url, provider=provider)
    except RuntimeError as exc:
        raise ExternalAIServiceError(
            f"The saved {provider} base URL is not allowed — it must use https and a public, non-private host",
            provider=provider,
            retryable=False,
            failure_kind="configuration",
        ) from exc
    api_key = str(config["api_key"]).strip()
    model = str(config["model"]).strip()
    return ScanAIClient(
        provider_name=provider,
        api_keys=(api_key,),
        base_url=base_url,
        task_models={task_name: model for task_name in RUNTIME_TASK_MODELS},
        allow_fallbacks=False,
    )
