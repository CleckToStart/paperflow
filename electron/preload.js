const { contextBridge, ipcRenderer } = require("electron");

const BACKEND_URL = "http://127.0.0.1:8765";

contextBridge.exposeInMainWorld("paperflow", {
  backendUrl: BACKEND_URL,
  health: () => ipcRenderer.invoke("paperflow:health"),
  listRepos: () => ipcRenderer.invoke("paperflow:listRepos"),
  getFileTree: (repoRoot) => ipcRenderer.invoke("paperflow:getFileTree", repoRoot),
  readFile: (payload) => ipcRenderer.invoke("paperflow:readFile", payload),
  getFileInfo: (payload) => ipcRenderer.invoke("paperflow:getFileInfo", payload),
  getOpenCodeSettings: () => ipcRenderer.invoke("paperflow:getOpenCodeSettings"),
  updateOpenCodeSettings: (payload) => ipcRenderer.invoke("paperflow:updateOpenCodeSettings", payload),
  getProvidersSettings: () => ipcRenderer.invoke("paperflow:getProvidersSettings"),
  updateProvidersSettings: (payload) => ipcRenderer.invoke("paperflow:updateProvidersSettings", payload),
  getTaskRouting: () => ipcRenderer.invoke("paperflow:getTaskRouting"),
  updateTaskRouting: (payload) => ipcRenderer.invoke("paperflow:updateTaskRouting", payload),
  startWorkflowRun: (payload) => ipcRenderer.invoke("paperflow:startWorkflowRun", payload),
  getWorkflowRun: (runId) => ipcRenderer.invoke("paperflow:getWorkflowRun", runId),
  listSessions: (filters) => ipcRenderer.invoke("paperflow:listSessions", filters),
  resumeSession: (sessionId) => ipcRenderer.invoke("paperflow:resumeSession", sessionId),
  createTerminalSession: (payload) => ipcRenderer.invoke("paperflow:createTerminalSession", payload),
  writeTerminal: (terminalSessionId, data) => ipcRenderer.invoke("paperflow:writeTerminal", terminalSessionId, data),
  resizeTerminal: (terminalSessionId, cols, rows) =>
    ipcRenderer.invoke("paperflow:resizeTerminal", terminalSessionId, cols, rows),
  openPath: (targetPath) => ipcRenderer.invoke("paperflow:openPath", targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke("paperflow:showItemInFolder", targetPath),
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
  onTerminalData(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("paperflow:terminalData", listener);
    return () => ipcRenderer.removeListener("paperflow:terminalData", listener);
  },
  onTerminalExit(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("paperflow:terminalExit", listener);
    return () => ipcRenderer.removeListener("paperflow:terminalExit", listener);
  },
});
