from __future__ import annotations

import time

import httpx
import pytest

from app.core.exceptions import ExternalAIServiceError
import app.infrastructure.ai.nvidia_security_client as nvidia_client_module
import app.infrastructure.ai.scan_client as scan_client_module
from app.infrastructure.ai.nvidia_security_client import (
    NvidiaSecurityClient,
    _ProviderTarget,
    _map_provider_http_error,
    _should_wait_for_rate_limit_cooldown,
)
from app.infrastructure.ai.scan_client import AI_STEP_BUDGET_SECONDS, ScanAIClient


def test_rate_limit_error_preserves_retry_after_seconds() -> None:
    response = httpx.Response(
        429,
        headers={"Retry-After": "12"},
        json={"error": {"message": "quota exceeded"}},
        request=httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions"),
    )

    error = _map_provider_http_error("nvidia", response)

    assert error.failure_kind == "rate_limit"
    assert error.retryable is True
    assert error.status_code == 429
    assert error.retry_after_seconds == 12


def test_rate_limit_cooldown_short_circuits_later_scan_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nvidia_client_module, "_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL", 0.0)
    monkeypatch.setattr(nvidia_client_module, "_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY", {})
    client = object.__new__(NvidiaSecurityClient)
    client._runtime_events = []
    client._runtime_metrics = {}
    api_key = "test-key"

    client._record_rate_limit_if_needed(
        ExternalAIServiceError(
            "rate limited",
            provider="nvidia",
            retryable=True,
            status_code=429,
            failure_kind="rate_limit",
            retry_after_seconds=10,
        ),
        api_key=api_key,
    )

    target = _ProviderTarget(
        provider_name="nvidia",
        base_url="https://integrate.api.nvidia.com/v1",
        api_keys=(api_key,),
        timeout_seconds=30.0,
        model="test-model",
    )

    with pytest.raises(ExternalAIServiceError) as exc_info:
        client._raise_if_rate_limited(target)

    assert exc_info.value.failure_kind == "rate_limit"
    assert exc_info.value.status_code == 429
    assert client.snapshot_runtime_metrics()["rate_limit_short_circuits"] == 1


def test_key_specific_rate_limit_keeps_second_key_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nvidia_client_module, "_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL", 0.0)
    monkeypatch.setattr(nvidia_client_module, "_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY", {})
    client = object.__new__(NvidiaSecurityClient)
    client._runtime_events = []
    client._runtime_metrics = {}
    limited_key = "test-key-a"
    available_key = "test-key-b"
    target = _ProviderTarget(
        provider_name="nvidia",
        base_url="https://integrate.api.nvidia.com/v1",
        api_keys=(limited_key, available_key),
        timeout_seconds=30.0,
        model="test-model",
    )

    client._record_rate_limit_if_needed(
        ExternalAIServiceError(
            "rate limited",
            provider="nvidia",
            retryable=True,
            status_code=429,
            failure_kind="rate_limit",
            retry_after_seconds=10,
        ),
        api_key=limited_key,
    )

    with pytest.raises(ExternalAIServiceError):
        client._raise_if_rate_limited(target, api_key=limited_key)

    client._raise_if_rate_limited(target, api_key=available_key)
    client._raise_if_rate_limited(target)


def test_remediation_tasks_are_allowed_to_wait_for_cooldown() -> None:
    assert _should_wait_for_rate_limit_cooldown("explain")
    assert _should_wait_for_rate_limit_cooldown("fix_draft")
    assert _should_wait_for_rate_limit_cooldown("fix_validate_json_repair")
    assert not _should_wait_for_rate_limit_cooldown("repository_map")
    assert not _should_wait_for_rate_limit_cooldown("path_review")


@pytest.mark.asyncio
async def test_remediation_cooldown_wait_does_not_short_circuit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nvidia_client_module, "_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL", 0.0)
    monkeypatch.setattr(nvidia_client_module, "_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY", {})
    client = object.__new__(NvidiaSecurityClient)
    client._runtime_events = []
    client._runtime_metrics = {}
    api_key = "test-key"
    target = _ProviderTarget(
        provider_name="nvidia",
        base_url="https://integrate.api.nvidia.com/v1",
        api_keys=(api_key,),
        timeout_seconds=30.0,
        model="test-model",
    )
    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)
        nvidia_client_module._PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY[api_key] = time.monotonic() - 1

    nvidia_client_module._PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY[api_key] = time.monotonic() + 10
    monkeypatch.setattr(nvidia_client_module.asyncio, "sleep", fake_sleep)

    await client._wait_for_rate_limit_cooldown(target, task_name="fix_draft", api_key=api_key)

    assert sleep_calls
    assert 0 < sleep_calls[0] <= 10
    assert client.snapshot_runtime_metrics()["rate_limit_waits"] == 1


def _rate_limited_response(retry_after_seconds: int) -> httpx.Response:
    return httpx.Response(
        429,
        headers={"Retry-After": str(retry_after_seconds)},
        json={"error": {"message": "quota exceeded"}},
        request=httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions"),
    )


def _completion_response(content: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": content}}]},
        request=httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions"),
    )


def _chat_target() -> _ProviderTarget:
    return _ProviderTarget(
        provider_name="nvidia",
        base_url="https://integrate.api.nvidia.com/v1",
        api_keys=("test-key",),
        timeout_seconds=30.0,
        model="test-model",
    )


def _make_chat_client() -> ScanAIClient:
    client = object.__new__(ScanAIClient)
    client._api_key_cursor = 0
    client.retry_attempts = 2
    client.retry_backoff_seconds = 1.0
    client.min_request_interval_seconds = 0.0
    client._runtime_events = []
    client._runtime_metrics = {}
    return client


def _patch_chat_post(monkeypatch: pytest.MonkeyPatch, responses: list[httpx.Response]) -> None:
    """Serve the scripted responses in order; the last one repeats."""

    def factory(*_args, **_kwargs):
        class _ScriptedClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_exc_info):
                return False

            async def post(self, _url, json=None, headers=None):
                return responses.pop(0) if len(responses) > 1 else responses[0]

        return _ScriptedClient()

    monkeypatch.setattr(scan_client_module.httpx, "AsyncClient", factory)


def _reset_transport_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scan_client_module, "_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL", 0.0)
    monkeypatch.setattr(scan_client_module, "_PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY", {})
    monkeypatch.setattr(scan_client_module, "_PROVIDER_NEXT_REQUEST_AT_BY_KEY", {})


@pytest.mark.asyncio
async def test_retry_sleep_never_runs_past_the_step_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression: a scan step is capped with asyncio.wait_for() at the transport
    budget. A rate-limit cooldown sleep that cannot fit inside that budget must
    surface the real provider error instead of being cancelled while asleep, which
    used to be reported as an unavailable provider and failed the whole review."""
    _reset_transport_state(monkeypatch)
    _patch_chat_post(monkeypatch, [_rate_limited_response(30)])
    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)

    monkeypatch.setattr(scan_client_module.asyncio, "sleep", fake_sleep)

    with pytest.raises(ExternalAIServiceError) as exc_info:
        await _make_chat_client()._chat_text(
            task_name="repository_map",
            max_tokens=256,
            messages=[{"role": "user", "content": "map the repository"}],
            expect_json=True,
            target=_chat_target(),
            deadline=time.monotonic() + 2.0,
        )

    assert exc_info.value.failure_kind == "rate_limit"
    assert exc_info.value.retry_after_seconds == 30
    assert sleep_calls == []


@pytest.mark.asyncio
async def test_retry_inside_the_step_deadline_still_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    """The deadline bounds the retry schedule, it does not disable retries."""
    _reset_transport_state(monkeypatch)
    _patch_chat_post(monkeypatch, [_rate_limited_response(1), _completion_response('{"ok": true}')])
    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)
        # Sleeping really does elapse in production; clear the cooldown the 429 set
        # so the retry round is allowed to reach the provider again.
        scan_client_module._PROVIDER_RATE_LIMIT_COOLDOWN_UNTIL_BY_KEY["test-key"] = time.monotonic() - 1

    monkeypatch.setattr(scan_client_module.asyncio, "sleep", fake_sleep)

    content = await _make_chat_client()._chat_text(
        task_name="repository_map",
        max_tokens=256,
        messages=[{"role": "user", "content": "map the repository"}],
        expect_json=True,
        target=_chat_target(),
        deadline=time.monotonic() + 30.0,
    )

    assert content == '{"ok": true}'
    assert sleep_calls == [1.0]


def test_scan_step_cap_leaves_room_for_the_transport_budget() -> None:
    """The scan-side wait_for() cap must stay above the transport deadline, or it
    cancels a retry mid-flight instead of letting the transport report the cause."""
    from app.infrastructure.services.scan.scan_execution_service import AI_STEP_TIMEOUT_SECONDS

    assert AI_STEP_TIMEOUT_SECONDS > AI_STEP_BUDGET_SECONDS
