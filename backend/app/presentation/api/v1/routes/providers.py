from fastapi import APIRouter, Depends, HTTPException

from app.application.dto.runtime_settings_contracts import ProviderInfo, ProviderModelsResponse, ProviderTestRequest, ProviderTestResponse
from app.infrastructure.ai.providers.registry import get_provider, list_providers
from app.infrastructure.settings.runtime_settings_service import RuntimeSettingsService
from app.presentation.api.v1.routes.dependencies import get_runtime_settings_service

router = APIRouter()


@router.get("/settings/providers", response_model=list[ProviderInfo])
async def list_all_providers() -> list[ProviderInfo]:
    return [ProviderInfo(**p) for p in list_providers()]


async def _resolve_api_key(payload: ProviderTestRequest, settings_service: RuntimeSettingsService) -> str:
    if payload.api_key and payload.api_key.strip():
        return payload.api_key.strip()
    # Fallback to stored key if provider matches active and key exists
    config = await settings_service.get_ai_client_config()
    if config and config.get("provider") == payload.provider.strip().lower() and config.get("api_key"):
        return str(config["api_key"]).strip()
    # Also try raw document base_url fallback for List models
    raise HTTPException(status_code=400, detail="API key is required — enter your key or save the provider first")


@router.post("/settings/providers/test", response_model=ProviderTestResponse)
async def test_provider(payload: ProviderTestRequest, settings_service: RuntimeSettingsService = Depends(get_runtime_settings_service)) -> ProviderTestResponse:
    try:
        provider = get_provider(payload.provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    api_key = await _resolve_api_key(payload, settings_service)
    # Use stored base_url if payload base_url empty and provider is active
    base_url = payload.base_url
    if not base_url or not str(base_url).strip():
        try:
            cfg = await settings_service.get_ai_client_config()
            if cfg and cfg.get("provider") == payload.provider.strip().lower():
                base_url = cfg.get("base_url") or base_url
        except Exception:
            pass

    result = await provider.test_connection(
        api_key=api_key,
        base_url=base_url,
        model=payload.model,
    )
    return ProviderTestResponse(**result)


@router.post("/settings/providers/models", response_model=ProviderModelsResponse)
async def list_provider_models(payload: ProviderTestRequest, settings_service: RuntimeSettingsService = Depends(get_runtime_settings_service)) -> ProviderModelsResponse:
    try:
        provider = get_provider(payload.provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    api_key = await _resolve_api_key(payload, settings_service)
    base_url = payload.base_url
    if not base_url or not str(base_url).strip():
        try:
            cfg = await settings_service.get_ai_client_config()
            if cfg and cfg.get("provider") == payload.provider.strip().lower():
                base_url = cfg.get("base_url") or base_url
        except Exception:
            pass

    try:
        models = await provider.list_models(api_key=api_key, base_url=base_url)
    except Exception as e:
        msg = str(e)[:500]
        raise HTTPException(status_code=400, detail=f"Failed to list models: {msg}")

    return ProviderModelsResponse(models=models)
