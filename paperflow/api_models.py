from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    backend_root: str
    state_root: str


class RepoInfo(BaseModel):
    repo_root: str
    last_workflow_path: str | None = None
    last_used_at: str | None = None
    has_opencode_config: bool
    has_opencode_memory: bool


class RepoListResponse(BaseModel):
    items: list[RepoInfo]
    default_workflow_path: str


class WorkflowRunCreateRequest(BaseModel):
    workflow_path: str = Field(default="workflow.yaml")
    repo_root: str | None = None
    resume_session_id: str | None = None
    attach_url: str | None = None


class WorkflowRunEventPayload(BaseModel):
    run_id: str
    sequence: int
    event_type: str
    message: str
    created_at: str
    step_name: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class WorkflowRunSummary(BaseModel):
    run_id: str
    workflow_path: str
    repo_root: str
    workflow_name: str
    status: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    current_step: str | None = None
    output_root: str | None = None
    error: str | None = None
    preferred_session_id: str | None = None
    artifacts_root: str | None = None


class WorkflowRunDetail(WorkflowRunSummary):
    steps: list[dict[str, Any]] = Field(default_factory=list)
    events: list[WorkflowRunEventPayload] = Field(default_factory=list)


class SessionRecordResponse(BaseModel):
    session_id: str
    repo_root: str
    workflow_name: str
    last_step: str | None = None
    last_used_at: str | None = None
    branch: str | None = None
    attach_url: str | None = None
    preferred: bool = False


class SessionListResponse(BaseModel):
    items: list[SessionRecordResponse]


class SessionResumeResponse(BaseModel):
    session: SessionRecordResponse


class TerminalSessionCreateRequest(BaseModel):
    repo_root: str
    attach_url: str | None = None
    session_id: str | None = None
    command: list[str] = Field(default_factory=list)


class TerminalSessionRecordResponse(BaseModel):
    terminal_session_id: str
    repo_root: str
    shell: str
    command: list[str]
    created_at: str
    suggested_session_id: str | None = None
    attach_url: str | None = None
