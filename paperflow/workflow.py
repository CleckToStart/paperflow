from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from paperflow.models import StepResult


@dataclass
class WorkflowContext:
    root: Path
    workflow: dict[str, Any]
    step_results: dict[str, StepResult] = field(default_factory=dict)

    def resolve_path(self, relative_path: str) -> Path:
        return (self.root / relative_path).resolve()

    def read_text(self, relative_path: str) -> str:
        path = self.resolve_path(relative_path)
        return path.read_text(encoding="utf-8")

    def register_step_output(self, step: dict[str, Any], result: StepResult) -> None:
        self.step_results[step["name"]] = result

    def collect_inputs(self, step: dict[str, Any]) -> list[dict[str, str]]:
        items: list[dict[str, str]] = []

        workflow_input = self.workflow.get("input")
        if workflow_input and step.get("include_main_input", True):
            items.append({"path": workflow_input, "content": self.read_text(workflow_input)})

        for relative_path in step.get("inputs", []):
            items.append({"path": relative_path, "content": self.read_text(relative_path)})

        return items

    def describe_inputs(self, step: dict[str, Any]) -> str:
        chunks: list[str] = []
        for item in self.collect_inputs(step):
            suffix = Path(item["path"]).suffix.lower()
            content = item["content"]
            if suffix == ".json":
                parsed = json.loads(content)
                pretty = json.dumps(parsed, indent=2, ensure_ascii=False)
                chunks.append(f"===== INPUT: {item['path']} =====\n{pretty}")
            else:
                chunks.append(f"===== INPUT: {item['path']} =====\n{content}")
        return "\n\n".join(chunks)


def resolve_step_scope(workflow: dict[str, Any], step: dict[str, Any]) -> dict[str, list[str]]:
    defaults = workflow.get("defaults", {}).get("scope", {})
    step_scope = step.get("scope", {})
    include = step_scope.get("include", defaults.get("include", []))
    exclude = step_scope.get("exclude", defaults.get("exclude", []))
    return {"include": include, "exclude": exclude}
