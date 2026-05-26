from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal


@dataclass
class StepResult:
    prompt: str
    raw_output: str
    stderr: str = ""
    parsed_output: dict[str, Any] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def final_text(self) -> str:
        if self.parsed_output is not None:
            return self.parsed_output.get("summary") or self.raw_output
        return self.raw_output


@dataclass
class CodeEvidenceResult:
    status: str
    task: str
    summary: str
    findings: list[str]
    evidence: list[dict[str, Any]]
    commands: list[str]
    configs: list[dict[str, Any]]
    risks: list[str]
    unknowns: list[str]

    @classmethod
    def required_keys(cls) -> list[str]:
        return [
            "status",
            "task",
            "summary",
            "findings",
            "evidence",
            "commands",
            "configs",
            "risks",
            "unknowns",
        ]


@dataclass
class RepoRecord:
    repo_root: str
    last_workflow_path: str | None = None
    last_used_at: str | None = None


@dataclass
class SessionRecord:
    session_id: str
    repo_root: str
    workflow_name: str
    last_step: str | None = None
    last_used_at: str | None = None
    branch: str | None = None
    attach_url: str | None = None
    preferred: bool = False


@dataclass
class TerminalSessionRecord:
    terminal_session_id: str
    repo_root: str
    shell: str
    command: list[str]
    created_at: str
    suggested_session_id: str | None = None
    attach_url: str | None = None


RunStatus = Literal["pending", "running", "completed", "failed"]


@dataclass
class WorkflowRunEvent:
    run_id: str
    sequence: int
    event_type: str
    message: str
    created_at: str
    step_name: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkflowRunRecord:
    run_id: str
    workflow_path: str
    repo_root: str
    workflow_name: str
    status: RunStatus
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    current_step: str | None = None
    output_root: str | None = None
    error: str | None = None
    preferred_session_id: str | None = None
    artifacts_root: str | None = None
    steps: list[dict[str, Any]] = field(default_factory=list)
    events: list[WorkflowRunEvent] = field(default_factory=list)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
