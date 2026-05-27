const BACKEND_URL = "http://127.0.0.1:8765";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json();
}

function query(params) {
  return new URLSearchParams(params).toString();
}

const browserFallback = {
  backendUrl: BACKEND_URL,
  health: () => fetchJson(`${BACKEND_URL}/health`),
  listRepos: () => fetchJson(`${BACKEND_URL}/repos`),
  getFileTree: (repoRoot) => fetchJson(`${BACKEND_URL}/files/tree?${query({ repo_root: repoRoot })}`),
  readFile: ({ repoRoot, path }) => fetchJson(`${BACKEND_URL}/files/read?${query({ repo_root: repoRoot, path })}`),
  getFileInfo: ({ repoRoot, path }) => fetchJson(`${BACKEND_URL}/files/info?${query({ repo_root: repoRoot, path })}`),
  getOpenCodeSettings: () => fetchJson(`${BACKEND_URL}/settings/opencode`),
  updateOpenCodeSettings: (payload) =>
    fetchJson(`${BACKEND_URL}/settings/opencode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  getProvidersSettings: () => fetchJson(`${BACKEND_URL}/settings/providers`),
  updateProvidersSettings: (payload) =>
    fetchJson(`${BACKEND_URL}/settings/providers`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  getTaskRouting: () => fetchJson(`${BACKEND_URL}/settings/routing`),
  updateTaskRouting: (payload) =>
    fetchJson(`${BACKEND_URL}/settings/routing`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  startWorkflowRun: (payload) =>
    fetchJson(`${BACKEND_URL}/workflow-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  getWorkflowRun: (runId) => fetchJson(`${BACKEND_URL}/workflow-runs/${runId}`),
  listSessions: (filters = {}) => {
    const params = {};
    if (filters.repoRoot) params.repo_root = filters.repoRoot;
    if (filters.workflowName) params.workflow_name = filters.workflowName;
    return fetchJson(`${BACKEND_URL}/sessions?${query(params)}`);
  },
  resumeSession: (sessionId) =>
    fetchJson(`${BACKEND_URL}/sessions/${sessionId}/resume`, {
      method: "POST",
    }),
  createTerminalSession: async () => {
    throw new Error("浏览器预览模式不支持内嵌终端，请使用 Electron 窗口。");
  },
  writeTerminal: async () => false,
  resizeTerminal: async () => false,
  openPath: async () => "",
  showItemInFolder: async () => false,
  subscribeRunEvents(runId, onEvent) {
    const source = new EventSource(`${BACKEND_URL}/workflow-runs/${runId}/events`);
    const forward = (event) => onEvent(JSON.parse(event.data));
    [
      "run.started",
      "run.status",
      "run.finished",
      "run.failed",
      "step.started",
      "step.completed",
      "step.failed",
    ].forEach((eventName) => {
      source.addEventListener(eventName, forward);
    });
    return () => source.close();
  },
  onTerminalData: () => () => {},
  onTerminalExit: () => () => {},
};

export function getPaperflowApi() {
  return window.paperflow || browserFallback;
}
