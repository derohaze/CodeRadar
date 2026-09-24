from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    app_name: str = Field(default="CodeGuard", alias="APP_NAME")
    app_env: str = Field(default="development", alias="APP_ENV")
    app_host: str = Field(default="127.0.0.1", alias="APP_HOST")
    app_port: int = Field(default=9000, alias="APP_PORT")
    api_workers: int = Field(default=1, alias="API_WORKERS")
    app_cors_origins: list[str] | str = Field(default="http://localhost:8080", alias="APP_CORS_ORIGINS")
    ai_provider_order: list[str] | str = Field(default="nvidia", alias="AI_PROVIDER_ORDER")
    ai_small_provider: str | None = Field(default=None, alias="AI_SMALL_PROVIDER")
    ai_small_model: str | None = Field(default=None, alias="AI_SMALL_MODEL")
    ai_large_provider: str | None = Field(default=None, alias="AI_LARGE_PROVIDER")
    ai_large_model: str | None = Field(default=None, alias="AI_LARGE_MODEL")

    nvidia_api_key: str | None = Field(default=None, alias="NVIDIA_API_KEY")
    nvidia_api_keys: list[str] | str | None = Field(default=None, alias="NVIDIA_API_KEYS")
    nvidia_base_url: str = Field(default="https://integrate.api.nvidia.com/v1", alias="NVIDIA_BASE_URL")
    nvidia_model: str = Field(default="openai/gpt-oss-120b", alias="NVIDIA_MODEL")
    nvidia_small_model: str | None = Field(default=None, alias="NVIDIA_SMALL_MODEL")
    nvidia_large_model: str | None = Field(default=None, alias="NVIDIA_LARGE_MODEL")
    nvidia_overflow_model: str | None = Field(default=None, alias="NVIDIA_OVERFLOW_MODEL")
    nvidia_timeout_seconds: float = Field(default=120.0, ge=30.0, le=600.0, alias="NVIDIA_TIMEOUT_SECONDS")
    nvidia_retry_attempts: int = Field(default=2, ge=1, le=6, alias="NVIDIA_RETRY_ATTEMPTS")
    nvidia_retry_backoff_seconds: float = Field(default=1.0, ge=0.0, le=30.0, alias="NVIDIA_RETRY_BACKOFF_SECONDS")
    nvidia_min_request_interval_seconds: float = Field(default=2.0, ge=0.0, le=60.0, alias="NVIDIA_MIN_REQUEST_INTERVAL_SECONDS")
    nvidia_enable_thinking: bool = Field(default=True, alias="NVIDIA_ENABLE_THINKING")
    nvidia_detection_model: str | None = Field(default=None, alias="NVIDIA_DETECTION_MODEL")
    nvidia_explain_model: str | None = Field(default=None, alias="NVIDIA_EXPLAIN_MODEL")
    nvidia_fix_model: str | None = Field(default=None, alias="NVIDIA_FIX_MODEL")
    nvidia_validation_model: str | None = Field(default=None, alias="NVIDIA_VALIDATION_MODEL")
    nvidia_penetration_model: str | None = Field(default=None, alias="NVIDIA_PENETRATION_MODEL")

    mongodb_uri: str = Field(alias="MONGODB_URI")
    mongodb_fallback_uri: str | None = Field(default=None, alias="MONGODB_FALLBACK_URI")
    mongodb_database: str = Field(default="CodeGuard", alias="MONGODB_DATABASE")
    mongodb_max_pool_size: int = Field(default=30, alias="MONGODB_MAX_POOL_SIZE")
    mongodb_min_pool_size: int = Field(default=5, alias="MONGODB_MIN_POOL_SIZE")
    mongodb_server_selection_timeout_ms: int = Field(default=3000, alias="MONGODB_SERVER_SELECTION_TIMEOUT_MS")
    queue_backend: str = Field(default="in_process", alias="QUEUE_BACKEND")
    auto_start_queue_worker: bool = Field(default=True, alias="AUTO_START_QUEUE_WORKER")
    scan_lock_backend: str = Field(default="auto", alias="SCAN_LOCK_BACKEND")
    redis_url: str | None = Field(default=None, alias="REDIS_URL")
    scan_queue_name: str = Field(default="codeguard:queue:scan", alias="SCAN_QUEUE_NAME")
    ai_queue_name: str = Field(default="codeguard:queue:ai", alias="AI_QUEUE_NAME")
    verify_queue_name: str = Field(default="codeguard:queue:verify", alias="VERIFY_QUEUE_NAME")
    report_queue_name: str = Field(default="codeguard:queue:report", alias="REPORT_QUEUE_NAME")
    scan_job_timeout_seconds: int = Field(default=1800, alias="SCAN_JOB_TIMEOUT_SECONDS")
    worker_concurrency: int = Field(default=4, alias="WORKER_CONCURRENCY")
    worker_max_jobs: int = Field(default=4, alias="WORKER_MAX_JOBS")
    global_concurrent_scans_limit: int = Field(default=4, alias="GLOBAL_CONCURRENT_SCANS_LIMIT")
    session_scan_lock_ttl_seconds: int = Field(default=1800, alias="SESSION_SCAN_LOCK_TTL_SECONDS")
    source_scan_lock_ttl_seconds: int = Field(default=1800, alias="SOURCE_SCAN_LOCK_TTL_SECONDS")
    penetration_sandbox_enabled: bool = Field(default=True, alias="PENETRATION_SANDBOX_ENABLED")
    penetration_sandbox_max_files: int = Field(default=120, ge=10, le=2000, alias="PENETRATION_SANDBOX_MAX_FILES")
    penetration_sandbox_max_total_mb: int = Field(default=50, ge=5, le=4096, alias="PENETRATION_SANDBOX_MAX_TOTAL_MB")
    api_reload_enabled: bool = Field(default=False, alias="API_RELOAD_ENABLED")
    rust_indexer_enabled: bool = Field(default=True, alias="RUST_INDEXER_ENABLED")
    rust_indexer_host: str = Field(default="127.0.0.1", alias="RUST_INDEXER_HOST")
    rust_indexer_port: int = Field(default=7100, ge=1, le=65535, alias="RUST_INDEXER_PORT")
    rust_indexer_binary: str | None = Field(default=None, alias="RUST_INDEXER_BINARY")
    rust_indexer_auto_build: bool = Field(default=True, alias="RUST_INDEXER_AUTO_BUILD")
    rust_indexer_max_files: int = Field(default=12000, ge=1, le=100000, alias="RUST_INDEXER_MAX_FILES")
    rust_indexer_analyze_timeout_seconds: float = Field(default=8.0, ge=1.0, le=120.0, alias="RUST_INDEXER_ANALYZE_TIMEOUT_SECONDS")
    artifacts_dir: str = Field(
        default=str(Path(__file__).resolve().parents[2] / "artifacts"),
        alias="ARTIFACTS_DIR",
    )

    @field_validator("app_cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: list[str] | str):
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("ai_provider_order", mode="before")
    @classmethod
    def parse_provider_order(cls, value: list[str] | str):
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("nvidia_api_keys", mode="before")
    @classmethod
    def parse_nvidia_api_keys(cls, value: list[str] | str | None):
        if value is None:
            return None
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]

        parts: list[str] = []
        for line in str(value).replace("\r", "\n").split("\n"):
            parts.extend(item.strip() for item in line.split(","))
        parsed = [item for item in parts if item]
        return parsed or None

    @field_validator("ai_small_provider", "ai_large_provider", mode="before")
    @classmethod
    def normalize_ai_provider_name(cls, value: str | None):
        if value is None:
            return None
        normalized = str(value).strip().lower()
        return normalized or None

    @field_validator("queue_backend", mode="before")
    @classmethod
    def normalize_queue_backend(cls, value: str):
        normalized = str(value).strip().lower()
        if normalized not in {"in_process", "arq"}:
            raise ValueError("QUEUE_BACKEND must be either 'in_process' or 'arq'.")
        return normalized

    @field_validator("scan_lock_backend", mode="before")
    @classmethod
    def normalize_scan_lock_backend(cls, value: str):
        normalized = str(value).strip().lower()
        if normalized not in {"auto", "in_memory", "redis"}:
            raise ValueError("SCAN_LOCK_BACKEND must be 'auto', 'in_memory', or 'redis'.")
        return normalized


@lru_cache
def get_settings() -> Settings:
    return Settings()
