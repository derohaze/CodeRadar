"""Compat shim — original file was 1253 lines and locked to one vendor.
Now the engine is provider-agnostic. This shim keeps old imports working.
Use `app.infrastructure.ai.scan_client.ScanAIClient` for new code.
"""
from __future__ import annotations

# Re-export everything from the generic client so tests importing internal helpers still pass
from app.infrastructure.ai.scan_client import (
    RUNTIME_TASK_MODELS,
    ScanAIClient,
    _ProviderTarget,
    _PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL,
    _PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY,
    _map_provider_http_error,
    _should_wait_for_rate_limit_cooldown,
)
import app.infrastructure.ai.scan_client as _scan_client
import asyncio as _asyncio_shim
# expose asyncio for tests that monkeypatch nvidia_client_module.asyncio
import asyncio

asyncio = _asyncio_shim  # type: ignore
# re-export module-level cooldown vars for monkeypatch
_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL = _scan_client._PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL
_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY = _scan_client._PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY

# Back-compat alias — so existing code `from nvidia_security_client import NvidiaSecurityClient` still works
NvidiaSecurityClient = ScanAIClient
ScanClient = ScanAIClient

__all__ = ["NvidiaSecurityClient", "ScanAIClient", "ScanClient", "RUNTIME_TASK_MODELS"]
