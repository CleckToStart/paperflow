from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Callable

import yaml

from paperflow.agents.opencode_runner import OpenCodeRunner
from paperflow.agents.openai_runner import OpenAIRunner
from paperflow.models import StepResult, now_iso
from paperflow.settings import OpenCodeLocator, SettingsManager
from paperflow.state import RepoRegistry, SessionRegistry
from paperflow.workflow import WorkflowContext, resolve_step_scope

EventCallback = Callable[[str, str, str | None, dict[str, Any] | None], None]


class WorkflowExecutor:
    def __init__(
        self,
        root: Path,
        repo_registry: RepoRegistry,
        session_registry: SessionRegistry,
        settings_manager: SettingsManager,
        opencode_locator: OpenCodeLocator,
    ) -> None:
        self.root = root
        self.repo_registry = repo_registry
        self.session_registry = session_registry
        self.settings_manager = settings_manager
        self.opencode_locator = opencode_locator

    def load_workflow(self, path: Path) -> dict[str, Any]:
        return yaml.safe_load(path.read_text(encoding="utf-8"))

    def execute(
        self,
        workflow_path: Path,
        repo_root_override: str | None = None,
        preferred_session_id: str | None = None,
        attach_url_override: str | None = None,
        event_callback: EventCallback | None = None,
    ) -> dict[str, Any]:
        workflow_path = workflow_path.resolve()
        config = self.load_workflow(workflow_path)
        root = workflow_path.parent
        if repo_root_override:
            config["repo_root"] = repo_root_override
        if attach_url_override:
            config.setdefault("opencode", {})["attach_url"] = attach_url_override
        context = WorkflowContext(root=root, workflow=config)

        repo_root = Path(config.get("repo_root", root))
        if not repo_root.is_absolute():
            repo_root = (root / repo_root).resolve()
        self.repo_registry.touch(repo_root, workflow_path, now_iso())

        def emit(event_type: str, message: str, step_name: str | None = None, payload: dict[str, Any] | None = None) -> None:
            if event_callback is not None:
                event_callback(event_type, message, step_name, payload)

        emit(
            "run.started",
            f"Loaded workflow {workflow_path.name}",
            payload={
                "workflow_path": str(workflow_path),
                "repo_root": str(repo_root),
            },
        )

        final_status = "completed"
        failure_error: str | None = None

        for step in config.get("steps", []):
            step_name = step["name"]
            artifacts_dir = root / "artifacts" / step_name
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            emit("step.started", f"Starting step {step_name}", step_name=step_name)
            scope = resolve_step_scope(config, step)

            metadata = {
                "step": step_name,
                "type": step.get("type"),
                "runner": step.get("runner"),
                "scope": scope,
                "started_at": now_iso(),
            }
            try:
                runner = self.create_runner(
                    step=step,
                    config=config,
                    root=root,
                    workflow_name=workflow_path.stem,
                    preferred_session_id=preferred_session_id,
                )
                result = runner.run(step=step, context=context, scope=scope)
                result.metadata = {**metadata, **result.metadata, "finished_at": now_iso()}
                self.persist_result(step=step, result=result, artifacts_dir=artifacts_dir, root=root)
                context.register_step_output(step, result)
                preferred_session_id = result.metadata.get("session_id", preferred_session_id)
                emit(
                    "step.completed",
                    f"Finished step {step_name}",
                    step_name=step_name,
                    payload={
                        "status": result.metadata.get("status", "ok"),
                        "output_path": step.get("output") or step.get("output_md") or step.get("output_json"),
                        "session_id": result.metadata.get("session_id"),
                    },
                )
            except Exception as exc:  # noqa: BLE001
                failure = {
                    **metadata,
                    "status": "failed",
                    "error": str(exc),
                    "finished_at": now_iso(),
                }
                self.write_json(artifacts_dir / "metadata.json", failure)
                self.write_text(artifacts_dir / "stderr.log", f"{exc}\n")
                emit(
                    "step.failed",
                    f"Step {step_name} failed: {exc}",
                    step_name=step_name,
                    payload={"error": str(exc)},
                )
                if step.get("continue_on_error") or config.get("defaults", {}).get("continue_on_error"):
                    continue
                final_status = "failed"
                failure_error = str(exc)
                break

        emit("run.finished", f"Run finished with status={final_status}", payload={"status": final_status, "error": failure_error})
        return {
            "status": final_status,
            "error": failure_error,
            "workflow_path": str(workflow_path),
            "repo_root": str(repo_root),
            "preferred_session_id": preferred_session_id,
            "artifacts_root": str((root / "artifacts").resolve()),
            "output_root": str((root / "output").resolve()),
            "steps": config.get("steps", []),
        }

    def create_runner(
        self,
        step: dict[str, Any],
        config: dict[str, Any],
        root: Path,
        workflow_name: str,
        preferred_session_id: str | None,
    ):
        runner_name = step["runner"]
        if runner_name == "opencode":
            opencode_config = {**config.get("opencode", {})}
            discovery = self.opencode_locator.discover()
            executable_path = discovery["selected_path"]
            if not executable_path:
                raise RuntimeError(
                    "OpenCode executable is not configured or discoverable. Update /settings/opencode first."
                )
            opencode_config["command"] = executable_path
            return OpenCodeRunner(
                root=root,
                config=opencode_config,
                session_registry=self.session_registry,
                workflow_name=workflow_name,
                preferred_session_id=preferred_session_id,
            )
        if runner_name == "openai":
            openai_config = config.get("openai", {})
            return OpenAIRunner(root=root, config=openai_config, settings_manager=self.settings_manager, step=step)
        raise ValueError(f"Unsupported runner: {runner_name}")

    def ensure_parent(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)

    def write_text(self, path: Path, content: str) -> None:
        self.ensure_parent(path)
        path.write_text(content, encoding="utf-8")

    def write_json(self, path: Path, payload: Any) -> None:
        self.ensure_parent(path)
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    def persist_result(self, step: dict[str, Any], result: StepResult, artifacts_dir: Path, root: Path) -> None:
        self.write_text(artifacts_dir / "prompt.txt", result.prompt)
        self.write_text(artifacts_dir / "raw_output.txt", result.raw_output)
        self.write_text(artifacts_dir / "stderr.log", result.stderr)
        self.write_json(artifacts_dir / "metadata.json", result.metadata)
        if result.parsed_output is not None:
            self.write_json(artifacts_dir / "parsed.json", result.parsed_output)

        if output_json := step.get("output_json"):
            if result.parsed_output is None:
                raise RuntimeError(f"Step {step['name']} declared output_json but produced no parsed output.")
            self.write_json(root / output_json, result.parsed_output)

        text_output = result.final_text()
        if output_md := step.get("output_md"):
            self.write_text(root / output_md, text_output)
        if output := step.get("output"):
            self.write_text(root / output, text_output)
