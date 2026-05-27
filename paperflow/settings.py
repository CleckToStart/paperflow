from __future__ import annotations

import os
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from paperflow.models import now_iso
from paperflow.state import JsonStateStore


DEFAULT_TASK_ROUTING = {
    "writing": {"provider_id": "", "model": ""},
    "review": {"provider_id": "", "model": ""},
    "summary": {"provider_id": "", "model": ""},
}


@dataclass
class ProviderConfig:
    provider_id: str
    label: str
    base_url: str
    api_key: str
    default_model: str
    small_model: str = ""
    headers: dict[str, str] = field(default_factory=dict)
    enabled: bool = True


@dataclass
class SettingsPayload:
    opencode_executable_path: str = ""
    opencode_last_checked_at: str | None = None
    providers: list[ProviderConfig] = field(default_factory=list)
    task_routing: dict[str, dict[str, str]] = field(
        default_factory=lambda: {key: value.copy() for key, value in DEFAULT_TASK_ROUTING.items()}
    )


class SettingsManager:
    def __init__(self, path: Path) -> None:
        self.store = JsonStateStore(path)

    def load(self) -> SettingsPayload:
        payload = self.store.load(default={})
        providers = [ProviderConfig(**item) for item in payload.get("providers", [])]
        task_routing = payload.get("task_routing") or {key: value.copy() for key, value in DEFAULT_TASK_ROUTING.items()}
        merged_routing = {key: value.copy() for key, value in DEFAULT_TASK_ROUTING.items()}
        for key, value in task_routing.items():
            merged_routing[key] = {
                "provider_id": value.get("provider_id", ""),
                "model": value.get("model", ""),
            }
        return SettingsPayload(
            opencode_executable_path=payload.get("opencode_executable_path", ""),
            opencode_last_checked_at=payload.get("opencode_last_checked_at"),
            providers=providers,
            task_routing=merged_routing,
        )

    def save(self, settings: SettingsPayload) -> SettingsPayload:
        self.store.save(
            {
                "opencode_executable_path": settings.opencode_executable_path,
                "opencode_last_checked_at": settings.opencode_last_checked_at,
                "providers": [asdict(item) for item in settings.providers],
                "task_routing": settings.task_routing,
            }
        )
        return settings

    def update_opencode_path(self, path: str) -> SettingsPayload:
        settings = self.load()
        settings.opencode_executable_path = path.strip()
        settings.opencode_last_checked_at = now_iso()
        return self.save(settings)

    def update_providers(self, providers: list[ProviderConfig]) -> SettingsPayload:
        settings = self.load()
        settings.providers = providers
        return self.save(settings)

    def update_task_routing(self, task_routing: dict[str, dict[str, str]]) -> SettingsPayload:
        settings = self.load()
        merged = {key: value.copy() for key, value in DEFAULT_TASK_ROUTING.items()}
        for key, value in task_routing.items():
            merged[key] = {
                "provider_id": value.get("provider_id", ""),
                "model": value.get("model", ""),
            }
        settings.task_routing = merged
        return self.save(settings)

    def get_provider(self, provider_id: str) -> ProviderConfig | None:
        settings = self.load()
        for provider in settings.providers:
            if provider.provider_id == provider_id and provider.enabled:
                return provider
        return None

    def resolve_task_config(self, task_name: str) -> tuple[ProviderConfig | None, str | None]:
        settings = self.load()
        route = settings.task_routing.get(task_name, {})
        provider_id = route.get("provider_id", "")
        model = route.get("model", "")
        provider = self.get_provider(provider_id) if provider_id else None
        if provider is None:
            return None, None
        return provider, model or provider.default_model


class OpenCodeLocator:
    def __init__(self, settings_manager: SettingsManager) -> None:
        self.settings_manager = settings_manager

    def discover(self) -> dict[str, Any]:
        settings = self.settings_manager.load()
        configured = settings.opencode_executable_path.strip()
        candidates: list[dict[str, str]] = []
        seen: set[str] = set()

        def add_candidate(path: str, source: str) -> None:
            normalized = str(Path(path).resolve())
            if normalized.lower() in seen:
                return
            seen.add(normalized.lower())
            candidates.append(
                {
                    "path": normalized,
                    "source": source,
                    "exists": Path(normalized).exists(),
                }
            )

        if configured:
            add_candidate(configured, "configured")

        for name in ["opencode", "opencode.exe", "opencode.cmd"]:
            found = shutil.which(name)
            if found:
                add_candidate(found, "path")

        common_paths = [
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "OpenCode" / "opencode.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "OpenCode" / "opencode.exe",
            Path(os.environ.get("ProgramFiles", "")) / "OpenCode" / "opencode.exe",
            Path(os.environ.get("ProgramFiles(x86)", "")) / "OpenCode" / "opencode.exe",
            Path.home() / "AppData" / "Local" / "Programs" / "OpenCode" / "opencode.exe",
            Path.home() / "scoop" / "shims" / "opencode.exe",
        ]
        for path in common_paths:
            if path.is_absolute():
                add_candidate(str(path), "common")

        valid = [item for item in candidates if item["exists"]]
        selected = None
        if configured and Path(configured).exists():
            selected = str(Path(configured).resolve())
        elif valid:
            selected = valid[0]["path"]

        return {
            "selected_path": selected or "",
            "configured_path": configured,
            "candidates": candidates,
            "last_checked_at": now_iso(),
        }
