export function emptyProvider() {
  return {
    provider_id: "",
    label: "",
    base_url: "",
    api_key: "",
    default_model: "",
    small_model: "",
    headers: {},
    enabled: true,
  };
}

export function prettyTime(value) {
  if (!value) return "暂无";
  return new Date(value).toLocaleString("zh-CN");
}

export function eventTypeLabel(eventType) {
  const map = {
    "run.started": "流程开始",
    "run.status": "流程状态",
    "run.finished": "流程结束",
    "run.failed": "流程失败",
    "step.started": "步骤开始",
    "step.completed": "步骤完成",
    "step.failed": "步骤失败",
  };
  return map[eventType] || eventType;
}

export function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
