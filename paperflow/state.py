from __future__ import annotations

import json
import subprocess
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Any

from paperflow.models import RepoRecord, SessionRecord


class JsonStateStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self, default: Any) -> Any:
        with self.lock:
            if not self.path.exists():
                return default
            return json.loads(self.path.read_text(encoding="utf-8"))

    def save(self, payload: Any) -> None:
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


class RepoRegistry:
    def __init__(self, path: Path, default_repo_root: Path | None = None) -> None:
        self.store = JsonStateStore(path)
        self.default_repo_root = default_repo_root

    def list(self) -> list[RepoRecord]:
        payload = self.store.load(default={"repos": []})
        records = [RepoRecord(**item) for item in payload.get("repos", [])]
        if self.default_repo_root:
            default_root = normalize_repo_root(self.default_repo_root)
            if all(normalize_repo_root(record.repo_root) != default_root for record in records):
                records.insert(0, RepoRecord(repo_root=default_root))
        return records

    def touch(self, repo_root: Path, workflow_path: Path | None, when: str) -> RepoRecord:
        records = self.list()
        repo_value = normalize_repo_root(repo_root)
        workflow_value = str(workflow_path.resolve()) if workflow_path else None
        updated = RepoRecord(repo_root=repo_value, last_workflow_path=workflow_value, last_used_at=when)
        merged = [record for record in records if normalize_repo_root(record.repo_root) != repo_value]
        merged.insert(0, updated)
        self.store.save({"repos": [asdict(record) for record in merged[:20]]})
        return updated


class SessionRegistry:
    def __init__(self, path: Path) -> None:
        self.store = JsonStateStore(path)

    def list(self, repo_root: str | None = None, workflow_name: str | None = None) -> list[SessionRecord]:
        payload = self.store.load(default={"sessions": []})
        records = [SessionRecord(**item) for item in payload.get("sessions", [])]
        if repo_root is not None:
            normalized = normalize_repo_root(repo_root)
            records = [record for record in records if normalize_repo_root(record.repo_root) == normalized]
        if workflow_name is not None:
            records = [record for record in records if record.workflow_name == workflow_name]
        records.sort(key=lambda item: item.last_used_at or "", reverse=True)
        return records

    def get_preferred(self, repo_root: str, workflow_name: str) -> SessionRecord | None:
        records = self.list(repo_root=repo_root, workflow_name=workflow_name)
        preferred = [record for record in records if record.preferred]
        if preferred:
            return preferred[0]
        return records[0] if records else None

    def upsert(self, record: SessionRecord) -> SessionRecord:
        payload = self.store.load(default={"sessions": []})
        records = [SessionRecord(**item) for item in payload.get("sessions", [])]
        if record.preferred:
            for item in records:
                if normalize_repo_root(item.repo_root) == normalize_repo_root(record.repo_root) and item.workflow_name == record.workflow_name:
                    item.preferred = False
        replaced = False
        for index, item in enumerate(records):
            if item.session_id == record.session_id:
                records[index] = record
                replaced = True
                break
        if not replaced:
            records.append(record)
        self.store.save({"sessions": [asdict(item) for item in records]})
        return record

    def mark_preferred(self, session_id: str, when: str) -> SessionRecord:
        payload = self.store.load(default={"sessions": []})
        records = [SessionRecord(**item) for item in payload.get("sessions", [])]
        match: SessionRecord | None = None
        for item in records:
            if item.session_id == session_id:
                match = item
                item.preferred = True
                item.last_used_at = when
            elif match and normalize_repo_root(item.repo_root) == normalize_repo_root(match.repo_root) and item.workflow_name == match.workflow_name:
                item.preferred = False
        if match is None:
            raise KeyError(f"Session not found: {session_id}")
        self.store.save({"sessions": [asdict(item) for item in records]})
        return match


def detect_git_branch(repo_root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=5,
            check=False,
        )
    except OSError:
        return None
    branch = result.stdout.strip()
    return branch or None


def normalize_repo_root(value: str | Path) -> str:
    return str(Path(value).resolve()).lower()
