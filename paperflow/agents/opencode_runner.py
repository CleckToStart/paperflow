from __future__ import annotations

import json
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any

from paperflow.models import CodeEvidenceResult, StepResult
from paperflow.models import SessionRecord, now_iso
from paperflow.state import SessionRegistry, detect_git_branch
from paperflow.workflow import WorkflowContext


JSON_BLOCK_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)


class OpenCodeRunner:
    def __init__(
        self,
        root: Path,
        config: dict[str, Any],
        session_registry: SessionRegistry | None = None,
        workflow_name: str | None = None,
        preferred_session_id: str | None = None,
    ) -> None:
        self.root = root
        self.command = config.get("command", "opencode")
        self.args = config.get("args", [])
        self.prompt_via_stdin = config.get("prompt_via_stdin", True)
        self.prompt_arg = config.get("prompt_arg")
        self.timeout_seconds = int(config.get("timeout_seconds", 600))
        self.attach_url = config.get("attach_url")
        self.dir_mode = config.get("dir_mode", "step_repo_root")
        self.session_mode = config.get("session_mode", "per_project")
        self.fork_on_run = bool(config.get("fork_on_run", False))
        self.session_registry = session_registry
        self.workflow_name = workflow_name or "workflow"
        self.preferred_session_id = preferred_session_id

    def run(self, step: dict[str, Any], context: WorkflowContext, scope: dict[str, list[str]]) -> StepResult:
        repo_root = self._resolve_repo_root(step, context)
        matched_files = self._resolve_scope_matches(repo_root, scope)
        prompt = self._build_prompt(step=step, context=context, scope=scope, repo_root=repo_root)
        session_record = self._resolve_session_record(repo_root=repo_root, attach_url=step.get("attach_url") or self.attach_url)
        command = self._build_command(prompt, repo_root=repo_root, session_record=session_record)
        completed = self._run_subprocess(command, prompt, repo_root)
        if completed.returncode != 0:
            raise RuntimeError(
                f"OpenCode exited with code {completed.returncode}. stderr: {completed.stderr.strip() or '<empty>'}"
            )
        parsed = self._parse_json_output(completed.stdout)
        self._validate_code_evidence(parsed, step["name"])
        session_record = self._persist_session_record(
            parsed=parsed,
            repo_root=repo_root,
            step_name=step["name"],
            session_record=session_record,
        )
        metadata = {
            "status": parsed.get("status", "ok"),
            "command": command,
            "exit_code": completed.returncode,
            "repo_root": str(repo_root),
            "matched_files": matched_files,
            "session_id": session_record.session_id if session_record else None,
        }
        return StepResult(
            prompt=prompt,
            raw_output=completed.stdout,
            stderr=completed.stderr,
            parsed_output=parsed,
            metadata=metadata,
        )

    def _resolve_repo_root(self, step: dict[str, Any], context: WorkflowContext) -> Path:
        configured = step.get("repo_root") or context.workflow.get("repo_root")
        if not configured:
            raise ValueError(f"Step {step['name']} requires repo_root.")
        repo_root = Path(configured)
        if not repo_root.is_absolute():
            repo_root = (context.root / repo_root).resolve()
        if not repo_root.exists():
            raise FileNotFoundError(f"repo_root does not exist: {repo_root}")
        return repo_root

    def _build_prompt(
        self,
        step: dict[str, Any],
        context: WorkflowContext,
        scope: dict[str, list[str]],
        repo_root: Path,
    ) -> str:
        prompt_body = context.read_text(step["prompt"])
        include = "\n".join(f"- {pattern}" for pattern in scope["include"]) or "- <none>"
        exclude = "\n".join(f"- {pattern}" for pattern in scope["exclude"]) or "- <none>"
        extra_inputs = context.describe_inputs(step)
        schema = {
            "status": "ok | partial | failed",
            "task": "string",
            "summary": "100-300字事实摘要",
            "findings": ["只写代码中可证实的事实"],
            "evidence": [
                {
                    "file": "相对 repo_root 的路径",
                    "symbol": "函数/类/配置键/脚本名；未知可填 empty string",
                    "lines": "如 10-28；未知可填 empty string",
                    "reason": "为什么这段内容支持对应结论",
                }
            ],
            "commands": ["可复现实验或运行命令"],
            "configs": [{"name": "配置名", "value": "配置值", "reason": "用途说明"}],
            "risks": ["实现与写作可能不一致的风险"],
            "unknowns": ["代码中无法确认的点"],
        }
        return f"""你是代码取证代理。你的任务是阅读仓库并返回严格的 JSON，不要返回 Markdown 解释。

规则：
1. 只陈述代码或配置中能直接证实的事实。
2. 禁止编造未出现的实现细节。
3. 禁止用推测代替证据。
4. 任何关键结论都必须在 evidence 中给出文件定位。
5. 如果无法确认，写入 unknowns。
6. 最终输出必须是单个 JSON 对象。

任务名：{step['name']}
仓库根目录：{repo_root}

允许读取范围（白名单）：
{include}

排除范围：
{exclude}

输出 JSON schema：
{json.dumps(schema, indent=2, ensure_ascii=False)}

===== 任务说明 =====
{prompt_body}

===== 上游输入 =====
{extra_inputs or "<none>"}
"""

    def _resolve_session_record(self, repo_root: Path, attach_url: str | None) -> SessionRecord | None:
        if self.session_mode == "none":
            return None
        if self.session_registry is None:
            return None
        repo_value = str(repo_root.resolve())
        existing = None
        if self.preferred_session_id:
            matches = [item for item in self.session_registry.list(repo_root=repo_value, workflow_name=self.workflow_name) if item.session_id == self.preferred_session_id]
            existing = matches[0] if matches else None
        if existing is None:
            existing = self.session_registry.get_preferred(repo_root=repo_value, workflow_name=self.workflow_name)
        if existing is None:
            existing = SessionRecord(
                session_id=self.preferred_session_id or uuid.uuid4().hex,
                repo_root=repo_value,
                workflow_name=self.workflow_name,
                last_used_at=now_iso(),
                attach_url=attach_url,
                branch=detect_git_branch(repo_root),
                preferred=True,
            )
        return existing

    def _resolve_scope_matches(self, repo_root: Path, scope: dict[str, list[str]]) -> list[str]:
        include_patterns = scope.get("include", [])
        if not include_patterns:
            raise ValueError("Scope include is empty.")

        matches: set[str] = set()
        for pattern in include_patterns:
            for path in repo_root.glob(pattern):
                if path.is_file():
                    matches.add(str(path.relative_to(repo_root)).replace("\\", "/"))
                elif path.is_dir():
                    for nested in path.rglob("*"):
                        if nested.is_file():
                            matches.add(str(nested.relative_to(repo_root)).replace("\\", "/"))

        excluded: set[str] = set()
        for pattern in scope.get("exclude", []):
            for path in repo_root.glob(pattern):
                if path.is_file():
                    excluded.add(str(path.relative_to(repo_root)).replace("\\", "/"))
                elif path.is_dir():
                    for nested in path.rglob("*"):
                        if nested.is_file():
                            excluded.add(str(nested.relative_to(repo_root)).replace("\\", "/"))

        final_matches = sorted(matches - excluded)
        if not final_matches:
            raise ValueError("Scope include patterns matched no files after exclusions.")
        return final_matches

    def _build_command(self, prompt: str, repo_root: Path, session_record: SessionRecord | None) -> list[str]:
        command = [self.command, *self.args]
        if self.dir_mode == "step_repo_root":
            command.extend(["--dir", str(repo_root)])
        attach_url = session_record.attach_url if session_record and session_record.attach_url else self.attach_url
        if attach_url:
            command.extend(["--attach", attach_url])
        if session_record is not None:
            command.extend(["--session", session_record.session_id])
        if self.fork_on_run:
            command.append("--fork")
        if not self.prompt_via_stdin:
            if not self.prompt_arg:
                raise ValueError("prompt_arg is required when prompt_via_stdin=false.")
            command.extend([self.prompt_arg, prompt])
        return command

    def _run_subprocess(self, command: list[str], prompt: str, repo_root: Path) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                command,
                input=prompt if self.prompt_via_stdin else None,
                capture_output=True,
                text=True,
                encoding="utf-8",
                cwd=repo_root,
                timeout=self.timeout_seconds,
                check=False,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"OpenCode command not found: {self.command}. Configure workflow 'opencode.command'."
            ) from exc

    def _parse_json_output(self, raw_output: str) -> dict[str, Any]:
        text = raw_output.strip()
        if not text:
            raise ValueError("OpenCode returned empty output.")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = JSON_BLOCK_RE.search(text)
            if not match:
                raise ValueError("OpenCode output is not valid JSON.") from None
            return json.loads(match.group(1))

    def _validate_code_evidence(self, payload: dict[str, Any], task_name: str) -> None:
        missing = [key for key in CodeEvidenceResult.required_keys() if key not in payload]
        if missing:
            raise ValueError(f"Step {task_name} missing JSON keys: {', '.join(missing)}")

    def _persist_session_record(
        self,
        parsed: dict[str, Any],
        repo_root: Path,
        step_name: str,
        session_record: SessionRecord | None,
    ) -> SessionRecord | None:
        if self.session_registry is None or self.session_mode == "none":
            return session_record
        current = session_record or SessionRecord(
            session_id=self.preferred_session_id or uuid.uuid4().hex,
            repo_root=str(repo_root.resolve()),
            workflow_name=self.workflow_name,
            preferred=True,
        )
        persisted = SessionRecord(
            session_id=parsed.get("session_id") or current.session_id,
            repo_root=str(repo_root.resolve()),
            workflow_name=self.workflow_name,
            last_step=step_name,
            last_used_at=now_iso(),
            branch=current.branch or detect_git_branch(repo_root),
            attach_url=current.attach_url or self.attach_url,
            preferred=True,
        )
        self.session_registry.upsert(persisted)
        return persisted
