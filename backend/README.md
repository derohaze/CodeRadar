# CodeGuard Backend Runtime

The backend is split by runtime responsibility. There is no API gateway in the local development path.

| Runtime | Service | Port | Responsibility |
|---|---|---:|---|
| Python | `python-api` | 9000 | FastAPI contracts, scan orchestration, AI routing, MongoDB/Redis coordination, remediation workflows |
| Rust | `rust-indexer` | 7100 | Native bounded repository indexing and hotspot pre-analysis when the binary is built |

## Start All Backend Services

```powershell
cd backend
python main.py
```

`backend/main.py` starts Python directly. Rust starts when `backend/rust-indexer` has a built binary. If Rust is not built, Python falls back to its existing analyzer and records `rust_indexer.available=false` in runtime metrics.

## Build Rust Indexer

```powershell
cd backend/rust-indexer
cargo build --release
```

If Cargo is installed, `RUST_INDEXER_AUTO_BUILD=true` lets `backend/main.py` build the Rust sidecar during startup when the binary is missing.

## Direct API Access

Frontend security API calls should target Python directly:

```text
http://127.0.0.1:9000/api/v1
```

## Code Layout

```text
backend/
  app/                         Python API, scan orchestration, persistence coordination
  rust-indexer/src/
    indexer/                   Native repository traversal, signal extraction, hotspot ranking
    cli.rs                     Command-line contract
    http.rs                    Local health server
    json.rs                    Stable JSON contract for Python integration
```
