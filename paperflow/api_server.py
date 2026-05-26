from __future__ import annotations

import asyncio
import threading
import uuid
from dataclasses import asdict
from pathlib import Path
from queue import Queue
from typing import AsyncIterator

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from sse_starlette.sse import EventSourceResponse

from paperflow.api_models import (
    HealthResponse,
    RepoInfo,
    RepoListResponse,
    SessionListResponse,
    SessionRecordResponse,
    SessionResumeResponse,
    TerminalSessionCreateRequest,
    TerminalSessionRecordResponse,
    WorkflowRunCreateRequest,
    WorkflowRunDetail,
    WorkflowRunEventPayload,
    WorkflowRunSummary,
)
from paperflow.executor import WorkflowExecutor
from paperflow.models import TerminalSessionRecord, WorkflowRunEvent, WorkflowRunRecord, now_iso
from paperflow.state import RepoRegistry, SessionRegistry


class RunManager:
    def __init__(self, root: Path, executor: WorkflowExecutor) -> None:
        self.root = root
        self.executor = executor
        self.runs: dict[str, WorkflowRunRecord] = {}
        self.terminals: dict[str, TerminalSessionRecord] = {}
        self.event_queues: dict[str, list[Queue[WorkflowRunEvent | None]]] = {}
        self.lock = threading.Lock()

    def start_run(self, request: WorkflowRunCreateRequest) -> WorkflowRunRecord:
        workflow_path = (self.root / request.workflow_path).resolve()
        if not workflow_path.exists():
            raise FileNotFoundError(f"Workflow file not found: {workflow_path}")
        run_id = uuid.uuid4().hex
        repo_root = str((self.root / ".").resolve() if request.repo_root is None else Path(request.repo_root).resolve())
        record = WorkflowRunRecord(
            run_id=run_id,
            workflow_path=str(workflow_path),
            repo_root=repo_root,
            workflow_name=workflow_path.stem,
            status="pending",
            created_at=now_iso(),
            preferred_session_id=request.resume_session_id,
        )
        with self.lock:
            self.runs[run_id] = record
            self.event_queues[run_id] = []
        thread = threading.Thread(target=self._execute_run, args=(run_id, request), daemon=True)
        thread.start()
        return record

    def _execute_run(self, run_id: str, request: WorkflowRunCreateRequest) -> None:
        record = self.runs[run_id]
        record.status = "running"
        record.started_at = now_iso()
        self._emit(run_id, "run.status", "Workflow run is now running", payload={"status": "running"})

        try:
            result = self.executor.execute(
                workflow_path=Path(request.workflow_path) if Path(request.workflow_path).is_absolute() else self.root / request.workflow_path,
                repo_root_override=request.repo_root,
                preferred_session_id=request.resume_session_id,
                attach_url_override=request.attach_url,
                event_callback=lambda event_type, message, step_name=None, payload=None: self._handle_executor_event(
                    run_id, event_type, message, step_name, payload
                ),
            )
            record.status = result["status"]
            record.finished_at = now_iso()
            record.output_root = result["output_root"]
            record.artifacts_root = result["artifacts_root"]
            record.error = result["error"]
            record.preferred_session_id = result["preferred_session_id"]
            record.steps = result["steps"]
        except Exception as exc:  # noqa: BLE001
            record.status = "failed"
            record.finished_at = now_iso()
            record.error = str(exc)
            self._emit(run_id, "run.failed", f"Workflow run failed: {exc}", payload={"error": str(exc)})
        finally:
            self._emit(run_id, "run.status", f"Workflow run ended with status={record.status}", payload={"status": record.status})
            self._close_queues(run_id)

    def _handle_executor_event(
        self,
        run_id: str,
        event_type: str,
        message: str,
        step_name: str | None,
        payload: dict | None,
    ) -> None:
        record = self.runs[run_id]
        if event_type.startswith("step."):
            record.current_step = step_name
        self._emit(run_id, event_type, message, step_name=step_name, payload=payload or {})

    def _emit(
        self,
        run_id: str,
        event_type: str,
        message: str,
        step_name: str | None = None,
        payload: dict | None = None,
    ) -> None:
        with self.lock:
            record = self.runs[run_id]
            sequence = len(record.events) + 1
            event = WorkflowRunEvent(
                run_id=run_id,
                sequence=sequence,
                event_type=event_type,
                message=message,
                created_at=now_iso(),
                step_name=step_name,
                payload=payload or {},
            )
            record.events.append(event)
            for queue in self.event_queues.get(run_id, []):
                queue.put(event)

    def _close_queues(self, run_id: str) -> None:
        with self.lock:
            queues = self.event_queues.get(run_id, [])
            for queue in queues:
                queue.put(None)

    def get_run(self, run_id: str) -> WorkflowRunRecord:
        record = self.runs.get(run_id)
        if record is None:
            raise KeyError(run_id)
        return record

    def subscribe(self, run_id: str) -> Queue[WorkflowRunEvent | None]:
        queue: Queue[WorkflowRunEvent | None] = Queue()
        with self.lock:
            record = self.get_run(run_id)
            for event in record.events:
                queue.put(event)
            self.event_queues.setdefault(run_id, []).append(queue)
        return queue

    def create_terminal_session(self, request: TerminalSessionCreateRequest) -> TerminalSessionRecord:
        repo_root = str(Path(request.repo_root).resolve())
        shell = "powershell.exe"
        command = request.command or ["opencode"]
        if "--dir" not in command:
            command = [*command, "--dir", repo_root]
        if request.attach_url and "--attach" not in command:
            command = [*command, "--attach", request.attach_url]
        if request.session_id and "--session" not in command:
            command = [*command, "--session", request.session_id]
        record = TerminalSessionRecord(
            terminal_session_id=uuid.uuid4().hex,
            repo_root=repo_root,
            shell=shell,
            command=command,
            created_at=now_iso(),
            suggested_session_id=request.session_id,
            attach_url=request.attach_url,
        )
        self.terminals[record.terminal_session_id] = record
        self.executor.repo_registry.touch(Path(repo_root), None, record.created_at)
        return record


ROOT = Path(__file__).resolve().parent.parent
STATE_ROOT = ROOT / "state"
repo_registry = RepoRegistry(STATE_ROOT / "repos.json", default_repo_root=ROOT)
session_registry = SessionRegistry(STATE_ROOT / "sessions.json")
executor = WorkflowExecutor(root=ROOT, repo_registry=repo_registry, session_registry=session_registry)
run_manager = RunManager(root=ROOT, executor=executor)
app = FastAPI(title="paperflow API", version="0.1.0")


def record_to_summary(record: WorkflowRunRecord) -> WorkflowRunSummary:
    return WorkflowRunSummary(
        run_id=record.run_id,
        workflow_path=record.workflow_path,
        repo_root=record.repo_root,
        workflow_name=record.workflow_name,
        status=record.status,
        created_at=record.created_at,
        started_at=record.started_at,
        finished_at=record.finished_at,
        current_step=record.current_step,
        output_root=record.output_root,
        error=record.error,
        preferred_session_id=record.preferred_session_id,
        artifacts_root=record.artifacts_root,
    )


def record_to_detail(record: WorkflowRunRecord) -> WorkflowRunDetail:
    return WorkflowRunDetail(
        **record_to_summary(record).model_dump(),
        steps=record.steps,
        events=[WorkflowRunEventPayload(**asdict(event)) for event in record.events],
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", backend_root=str(ROOT), state_root=str(STATE_ROOT))


@app.get("/repos", response_model=RepoListResponse)
def list_repos() -> RepoListResponse:
    items: list[RepoInfo] = []
    for record in repo_registry.list():
        repo_root = Path(record.repo_root)
        items.append(
            RepoInfo(
                repo_root=record.repo_root,
                last_workflow_path=record.last_workflow_path,
                last_used_at=record.last_used_at,
                has_opencode_config=(repo_root / "opencode.json").exists(),
                has_opencode_memory=(repo_root / "OpenCode.md").exists(),
            )
        )
    return RepoListResponse(items=items, default_workflow_path=str((ROOT / "workflow.yaml").resolve()))


@app.post("/workflow-runs", response_model=WorkflowRunSummary)
def create_workflow_run(request: WorkflowRunCreateRequest) -> WorkflowRunSummary:
    try:
        record = run_manager.start_run(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return record_to_summary(record)


@app.get("/workflow-runs/{run_id}", response_model=WorkflowRunDetail)
def get_workflow_run(run_id: str) -> WorkflowRunDetail:
    try:
        return record_to_detail(run_manager.get_run(run_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}") from exc


@app.get("/workflow-runs/{run_id}/events")
async def stream_workflow_events(run_id: str):
    try:
        queue = run_manager.subscribe(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}") from exc

    async def generator() -> AsyncIterator[dict[str, str]]:
        while True:
            event = await asyncio.to_thread(queue.get)
            if event is None:
                break
            payload = WorkflowRunEventPayload(**asdict(event))
            yield {
                "event": payload.event_type,
                "data": payload.model_dump_json(),
            }

    return EventSourceResponse(generator())


@app.get("/sessions", response_model=SessionListResponse)
def list_sessions(
    repo_root: str | None = Query(default=None),
    workflow_name: str | None = Query(default=None),
) -> SessionListResponse:
    records = session_registry.list(repo_root=repo_root, workflow_name=workflow_name)
    return SessionListResponse(items=[SessionRecordResponse(**asdict(item)) for item in records])


@app.post("/sessions/{session_id}/resume", response_model=SessionResumeResponse)
def resume_session(session_id: str) -> SessionResumeResponse:
    try:
        record = session_registry.mark_preferred(session_id, now_iso())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return SessionResumeResponse(session=SessionRecordResponse(**asdict(record)))


@app.post("/terminal-sessions", response_model=TerminalSessionRecordResponse)
def create_terminal_session(request: TerminalSessionCreateRequest) -> TerminalSessionRecordResponse:
    record = run_manager.create_terminal_session(request)
    return TerminalSessionRecordResponse(**asdict(record))


def main() -> None:
    uvicorn.run(
        "paperflow.api_server:app",
        host="127.0.0.1",
        port=8765,
        reload=False,
    )


if __name__ == "__main__":
    main()
