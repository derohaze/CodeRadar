import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from app.application.dto.scan_contracts import ScanJobResponse, ScanSessionDetailResponse, StartScanRequest
from app.application.ports.scan_job_dispatcher import ScanJobDispatcher
from app.application.use_cases.scan.scan_mapper import map_session_detail
from app.application.use_cases.scan.get_scan_job import GetScanJobUseCase
from app.application.use_cases.session.get_session import GetSessionUseCase
from app.application.use_cases.scan.start_scan import StartScanUseCase
from app.core.exceptions import InvalidSourcePathError, WorkflowConflictError
from app.presentation.api.v1.routes.dependencies import (
    get_scan_job_dispatcher,
    get_scan_job_use_case,
    get_session_use_case,
    get_start_scan_use_case,
)


router = APIRouter()


@router.post("/scans", response_model=ScanSessionDetailResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_scan(
    payload: StartScanRequest,
    start_scan_use_case: StartScanUseCase = Depends(get_start_scan_use_case),
    scan_job_dispatcher: ScanJobDispatcher = Depends(get_scan_job_dispatcher),
):
    try:
        created_session, created_job = await start_scan_use_case.execute(payload)
    except InvalidSourcePathError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except WorkflowConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    try:
        await scan_job_dispatcher.enqueue_scan(created_session.id, created_job.id)
    except Exception as exc:
        await start_scan_use_case.mark_dispatch_failed(
            created_session,
            created_job,
            "CodeGuard could not queue the scan job. Check queue readiness and retry.",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The scan job could not be queued.",
        ) from exc
    return map_session_detail(created_session)


@router.get("/scans/{session_id}", response_model=ScanSessionDetailResponse)
async def get_scan(session_id: str, use_case: GetSessionUseCase = Depends(get_session_use_case)):
    detail = await use_case.execute(session_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan session not found.")
    return detail


@router.get("/scan-jobs/{job_id}", response_model=ScanJobResponse)
async def get_scan_job(job_id: str, use_case: GetScanJobUseCase = Depends(get_scan_job_use_case)):
    job = await use_case.execute(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan job not found.")
    return ScanJobResponse(
        id=job.id,
        session_id=job.session_id,
        type=job.job_type,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        attempts=job.attempts,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


@router.get("/scans/{session_id}/events")
async def stream_scan_events(session_id: str, use_case: GetSessionUseCase = Depends(get_session_use_case)):
    detail = await use_case.execute(session_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan session not found.")

    async def event_generator():
        last_signature = None
        idle_ticks = 0
        while True:
            current = await use_case.execute(session_id)
            if current is None:
                yield "event: scan_failed\ndata: " + json.dumps({"error": "Scan session not found."}) + "\n\n"
                return

            payload = current.model_dump(mode="json")
            session = payload["session"]
            signature = (
                session["updated_at"],
                session["status"],
                session["progress"],
                session.get("phase_progress", 0),
                session["current_phase"],
                session["findings_count"],
                session["candidate_findings_count"],
                tuple(session.get("progress_logs", [])[-2:]),
            )
            if signature != last_signature:
                idle_ticks = 0
                event_name = "scan_progress"
                if session["status"] == "completed":
                    event_name = "scan_completed"
                elif session["status"] == "failed":
                    event_name = "scan_failed"
                yield f"event: {event_name}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"
                last_signature = signature
            else:
                idle_ticks += 1
                # keep-alive comment to prevent proxy timeout without forcing client re-render
                if idle_ticks % 6 == 0:
                    yield ": keep-alive\n\n"

            if session["status"] in {"completed", "failed"}:
                return
            await asyncio.sleep(1.4)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
