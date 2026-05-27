from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


EXCLUDED_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "dist",
    "build",
    "__pycache__",
    "artifacts",
    "output",
}

TEXT_EXTENSIONS = {
    ".cfg",
    ".css",
    ".csv",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsx",
    ".log",
    ".md",
    ".py",
    ".rst",
    ".tex",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}


@dataclass
class FileReadResult:
    path: str
    name: str
    kind: str
    size: int
    readable: bool
    reason: str
    content: str = ""


class FileBrowser:
    def __init__(self, max_depth: int = 8, max_nodes: int = 3000, max_read_bytes: int = 1024 * 1024) -> None:
        self.max_depth = max_depth
        self.max_nodes = max_nodes
        self.max_read_bytes = max_read_bytes

    def tree(self, repo_root: str) -> dict:
        root = self._resolve_repo_root(repo_root)
        counter = {"count": 0, "truncated": False}
        node = self._build_node(root, root, depth=0, counter=counter)
        return {
            "repo_root": str(root),
            "root": node,
            "truncated": counter["truncated"],
            "max_depth": self.max_depth,
            "max_nodes": self.max_nodes,
        }

    def read(self, repo_root: str, relative_path: str) -> FileReadResult:
        root = self._resolve_repo_root(repo_root)
        path = self._resolve_child(root, relative_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {relative_path}")
        if not path.is_file():
            raise IsADirectoryError(f"Path is not a file: {relative_path}")

        size = path.stat().st_size
        rel = self._relative(root, path)
        result = FileReadResult(path=rel, name=path.name, kind=self._kind(path), size=size, readable=False, reason="")
        if size > self.max_read_bytes:
            result.reason = "too_large"
            return result
        if not self._looks_text(path):
            result.reason = "binary"
            return result
        try:
            result.content = path.read_text(encoding="utf-8")
            result.readable = True
            result.reason = "ok"
            return result
        except UnicodeDecodeError:
            result.reason = "decode_error"
            return result

    def info(self, repo_root: str, relative_path: str) -> dict:
        root = self._resolve_repo_root(repo_root)
        path = self._resolve_child(root, relative_path)
        if not path.exists():
            raise FileNotFoundError(f"Path not found: {relative_path}")
        stat = path.stat()
        return {
            "repo_root": str(root),
            "path": self._relative(root, path),
            "name": path.name,
            "kind": "directory" if path.is_dir() else self._kind(path),
            "size": stat.st_size,
            "is_directory": path.is_dir(),
            "is_file": path.is_file(),
            "modified_at": stat.st_mtime,
        }

    def _build_node(self, root: Path, path: Path, depth: int, counter: dict) -> dict:
        counter["count"] += 1
        if counter["count"] > self.max_nodes:
            counter["truncated"] = True
            return self._node(root, path, children=[])

        if not path.is_dir() or depth >= self.max_depth:
            return self._node(root, path, children=[])

        children = []
        try:
            entries = sorted(path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
        except OSError:
            entries = []
        for child in entries:
            if counter["count"] >= self.max_nodes:
                counter["truncated"] = True
                break
            if child.is_dir() and child.name in EXCLUDED_DIRS:
                continue
            children.append(self._build_node(root, child, depth + 1, counter))
        return self._node(root, path, children=children)

    def _node(self, root: Path, path: Path, children: list[dict]) -> dict:
        is_dir = path.is_dir()
        return {
            "name": path.name,
            "path": self._relative(root, path),
            "kind": "directory" if is_dir else self._kind(path),
            "size": path.stat().st_size if path.exists() and path.is_file() else 0,
            "children": children,
        }

    def _resolve_repo_root(self, repo_root: str) -> Path:
        root = Path(repo_root).resolve()
        if not root.exists() or not root.is_dir():
            raise FileNotFoundError(f"Repository root not found: {repo_root}")
        return root

    def _resolve_child(self, root: Path, relative_path: str) -> Path:
        child = (root / relative_path).resolve()
        if not child.is_relative_to(root):
            raise PermissionError("Path escapes repository root.")
        return child

    def _relative(self, root: Path, path: Path) -> str:
        if path == root:
            return ""
        return str(path.relative_to(root)).replace("\\", "/")

    def _kind(self, path: Path) -> str:
        suffix = path.suffix.lower().lstrip(".")
        return suffix or "file"

    def _looks_text(self, path: Path) -> bool:
        if path.suffix.lower() in TEXT_EXTENSIONS:
            return True
        try:
            sample = path.read_bytes()[:2048]
        except OSError:
            return False
        return b"\x00" not in sample
