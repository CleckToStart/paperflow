import React from "react";
import { Settings2 } from "lucide-react";
import StatusBadge from "./StatusBadge";

export default function TopBar({ health, selectedRepo, workflowPath, onSettings }) {
  const repoName = selectedRepo?.split(/[\\/]/).filter(Boolean).pop() || "未选择项目";
  const workflowName = workflowPath?.split(/[\\/]/).pop() || "未选择工作流";

  return (
    <header className="top-bar">
      <div className="top-title">
        <strong>{repoName}</strong>
        <span>{workflowName}</span>
      </div>
      <div className="top-meta">
        <div className="top-chip">
          <span>后端</span>
          <StatusBadge status={health?.status} />
        </div>
        <div className="top-chip wide" title={health?.opencode_selected_path || ""}>
          <span>OpenCode</span>
          <strong>{health?.opencode_selected_path ? "已绑定" : "未绑定"}</strong>
        </div>
        <button className="icon-text-button" onClick={onSettings}>
          <Settings2 size={16} />
          <span>设置</span>
        </button>
      </div>
    </header>
  );
}
