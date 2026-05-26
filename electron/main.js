const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const pty = require("node-pty");

const BACKEND_URL = "http://127.0.0.1:8765";
const PYTHON_PATH = path.join(__dirname, "..", ".venv", "Scripts", "python.exe");
const BACKEND_CWD = path.join(__dirname, "..");
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow = null;
let backendProcess = null;
const terminals = new Map();

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function isBackendHealthy() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureBackend() {
  if (await isBackendHealthy()) {
    return;
  }
  if (!fs.existsSync(PYTHON_PATH)) {
    throw new Error(`Python venv not found: ${PYTHON_PATH}`);
  }
  backendProcess = spawn(
    PYTHON_PATH,
    ["run.py", "serve", "--host", "127.0.0.1", "--port", "8765"],
    {
      cwd: BACKEND_CWD,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await isBackendHealthy()) {
      return;
    }
  }
  throw new Error("Backend failed to start within timeout.");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1280,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"));
  }
}

function disposeTerminal(terminalSessionId) {
  const terminal = terminals.get(terminalSessionId);
  if (terminal) {
    terminal.kill();
    terminals.delete(terminalSessionId);
  }
}

function shellExecutable() {
  return process.env.COMSPEC || "powershell.exe";
}

async function registerHandlers() {
  ipcMain.handle("paperflow:health", async () => fetchJson(`${BACKEND_URL}/health`));
  ipcMain.handle("paperflow:listRepos", async () => fetchJson(`${BACKEND_URL}/repos`));
  ipcMain.handle("paperflow:startWorkflowRun", async (_event, payload) =>
    fetchJson(`${BACKEND_URL}/workflow-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  ipcMain.handle("paperflow:getWorkflowRun", async (_event, runId) =>
    fetchJson(`${BACKEND_URL}/workflow-runs/${runId}`),
  );
  ipcMain.handle("paperflow:listSessions", async (_event, filters = {}) => {
    const query = new URLSearchParams();
    if (filters.repoRoot) query.set("repo_root", filters.repoRoot);
    if (filters.workflowName) query.set("workflow_name", filters.workflowName);
    return fetchJson(`${BACKEND_URL}/sessions?${query.toString()}`);
  });
  ipcMain.handle("paperflow:resumeSession", async (_event, sessionId) =>
    fetchJson(`${BACKEND_URL}/sessions/${sessionId}/resume`, {
      method: "POST",
    }),
  );
  ipcMain.handle("paperflow:createTerminalSession", async (_event, payload) => {
    const record = await fetchJson(`${BACKEND_URL}/terminal-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const executable = shellExecutable();
    const args = ["/k"];
    if (record.command.length > 0) {
      args.push(record.command.join(" "));
    }
    const terminal = pty.spawn(executable, args, {
      name: "xterm-color",
      cols: 120,
      rows: 40,
      cwd: record.repo_root,
      env: process.env,
    });
    terminals.set(record.terminal_session_id, terminal);
    terminal.onData((data) => {
      mainWindow?.webContents.send("paperflow:terminalData", {
        terminalSessionId: record.terminal_session_id,
        data,
      });
    });
    terminal.onExit(() => {
      mainWindow?.webContents.send("paperflow:terminalExit", {
        terminalSessionId: record.terminal_session_id,
      });
      terminals.delete(record.terminal_session_id);
    });
    return record;
  });
  ipcMain.handle("paperflow:writeTerminal", async (_event, terminalSessionId, data) => {
    const terminal = terminals.get(terminalSessionId);
    if (!terminal) {
      throw new Error(`Terminal session not found: ${terminalSessionId}`);
    }
    terminal.write(data);
    return true;
  });
  ipcMain.handle("paperflow:resizeTerminal", async (_event, terminalSessionId, cols, rows) => {
    const terminal = terminals.get(terminalSessionId);
    if (!terminal) {
      throw new Error(`Terminal session not found: ${terminalSessionId}`);
    }
    terminal.resize(cols, rows);
    return true;
  });
  ipcMain.handle("paperflow:openPath", async (_event, targetPath) => shell.openPath(targetPath));
}

app.whenReady().then(async () => {
  await ensureBackend();
  await registerHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  for (const terminalSessionId of terminals.keys()) {
    disposeTerminal(terminalSessionId);
  }
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});
