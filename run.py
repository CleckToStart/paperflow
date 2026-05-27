from __future__ import annotations

import argparse
import json
from pathlib import Path

from paperflow.executor import WorkflowExecutor
from paperflow.models import now_iso
from paperflow.settings import OpenCodeLocator, SettingsManager
from paperflow.state import RepoRegistry, SessionRegistry


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the paperflow workflow or API.")
    parser.add_argument("command", nargs="?", choices=["run", "serve"], default="run")
    parser.add_argument("--workflow", default="workflow.yaml", help="Path to the workflow YAML file.")
    parser.add_argument("--repo-root", default=None, help="Override workflow repo_root.")
    parser.add_argument("--session-id", default=None, help="Reuse a preferred opencode session id.")
    parser.add_argument("--attach-url", default=None, help="Attach to an opencode serve endpoint.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    return parser.parse_args()


def run_once(workflow_path: Path, repo_root: str | None, session_id: str | None, attach_url: str | None) -> int:
    root = workflow_path.resolve().parent
    repo_registry = RepoRegistry(root / "state" / "repos.json", default_repo_root=root)
    session_registry = SessionRegistry(root / "state" / "sessions.json")
    settings_manager = SettingsManager(root / "state" / "settings.json")
    opencode_locator = OpenCodeLocator(settings_manager=settings_manager)
    executor = WorkflowExecutor(
        root=root,
        repo_registry=repo_registry,
        session_registry=session_registry,
        settings_manager=settings_manager,
        opencode_locator=opencode_locator,
    )

    def emit(event_type: str, message: str, step_name: str | None = None, payload: dict | None = None) -> None:
        event = {
            "time": now_iso(),
            "event_type": event_type,
            "step_name": step_name,
            "message": message,
            "payload": payload or {},
        }
        print(json.dumps(event, ensure_ascii=False))

    result = executor.execute(
        workflow_path=workflow_path,
        repo_root_override=repo_root,
        preferred_session_id=session_id,
        attach_url_override=attach_url,
        event_callback=emit,
    )
    return 0 if result["status"] == "completed" else 1


def main() -> int:
    args = parse_args()
    if args.command == "serve":
        from paperflow.api_server import app

        import uvicorn

        uvicorn.run(app, host=args.host, port=args.port)
        return 0

    workflow_path = Path(args.workflow)
    return run_once(workflow_path=workflow_path, repo_root=args.repo_root, session_id=args.session_id, attach_url=args.attach_url)


if __name__ == "__main__":
    raise SystemExit(main())
