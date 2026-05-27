import React from "react";

export default function StatusBadge({ status }) {
  const value = status || "idle";
  const labels = {
    ok: "正常",
    completed: "完成",
    running: "运行中",
    pending: "等待中",
    failed: "失败",
    idle: "空闲",
  };
  return <span className={`status-badge status-${value}`}>{labels[value] || value}</span>;
}
