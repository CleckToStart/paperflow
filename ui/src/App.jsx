import React, { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

function StatusPill({ status }) {
  return <span className={`status-pill status-${status || "idle"}`}>{status || "idle"}</span>;
}

function prettyTime(value) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

export default function App() {
  const terminalContainerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [health, setHealth] = useState(null);
  const [repos, setRepos] = useState([]);
  const [workflowPath, setWorkflowPath] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [currentRun, setCurrentRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [terminalSessionId, setTerminalSessionId] = useState("");
  const [terminalReady, setTerminalReady] = useState(false);

  const currentWorkflowName = useMemo(() => {
    if (!workflowPath) return "";
    const filename = workflowPath.split(/[\\/]/).pop() || "";
    return filename.replace(/\.[^.]+$/, "");
  }, [workflowPath]);

  useEffect(() => {
    async function bootstrap() {
      const [healthResponse, reposResponse] = await Promise.all([
        window.paperflow.health(),
        window.paperflow.listRepos(),
      ]);
      setHealth(healthResponse);
      setRepos(reposResponse.items);
      setWorkflowPath(reposResponse.default_workflow_path);
      setSelectedRepo(reposResponse.items[0]?.repo_root || healthResponse.backend_root);
    }
    bootstrap().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedRepo || !currentWorkflowName) return;
    window.paperflow
      .listSessions({ repoRoot: selectedRepo, workflowName: currentWorkflowName })
      .then((response) => {
        setSessions(response.items);
        const preferred = response.items.find((item) => item.preferred);
        setSelectedSessionId(preferred?.session_id || response.items[0]?.session_id || "");
      })
      .catch(console.error);
  }, [selectedRepo, currentWorkflowName]);

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "Consolas, Monaco, monospace",
      fontSize: 13,
      theme: {
        background: "#111111",
        foreground: "#f3f0e8",
        cursor: "#ffcc66",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setTerminalReady(true);

    const disposeData = window.paperflow.onTerminalData(({ terminalSessionId: incomingId, data }) => {
      if (incomingId === terminalSessionId || !terminalSessionId) {
        terminal.write(data);
      }
    });
    const disposeExit = window.paperflow.onTerminalExit(({ terminalSessionId: incomingId }) => {
      if (incomingId === terminalSessionId) {
        terminal.writeln("\r\n[terminal exited]");
      }
    });

    terminal.onData((data) => {
      if (terminalSessionId) {
        window.paperflow.writeTerminal(terminalSessionId, data).catch(console.error);
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      if (terminalSessionId) {
        window.paperflow.resizeTerminal(terminalSessionId, terminal.cols, terminal.rows).catch(console.error);
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      disposeData();
      disposeExit();
      window.removeEventListener("resize", handleResize);
      terminal.dispose();
    };
  }, [terminalSessionId]);

  async function handleStartRun() {
    const run = await window.paperflow.startWorkflowRun({
      workflow_path: workflowPath,
      repo_root: selectedRepo,
      resume_session_id: selectedSessionId || null,
    });
    setCurrentRun(run);
    setEvents([]);
    const unsubscribe = window.paperflow.subscribeRunEvents(run.run_id, async (event) => {
      setEvents((prev) => [...prev, event]);
      if (event.event_type === "run.status") {
        const detail = await window.paperflow.getWorkflowRun(run.run_id);
        setCurrentRun(detail);
      }
    });
    setTimeout(() => {
      unsubscribe();
    }, 1000 * 60 * 30);
  }

  async function handleOpenTerminal() {
    if (!selectedRepo) return;
    const record = await window.paperflow.createTerminalSession({
      repo_root: selectedRepo,
      session_id: selectedSessionId || null,
      command: ["opencode"],
    });
    setTerminalSessionId(record.terminal_session_id);
    terminalRef.current?.clear();
    terminalRef.current?.writeln(`[terminal ${record.terminal_session_id}] cwd=${record.repo_root}`);
    fitAddonRef.current?.fit();
    window.paperflow
      .resizeTerminal(record.terminal_session_id, terminalRef.current?.cols || 120, terminalRef.current?.rows || 40)
      .catch(console.error);
  }

  async function openArtifacts(pathValue) {
    if (!pathValue) return;
    await window.paperflow.openPath(pathValue);
  }

  return (
    <div className="app-shell">
      <aside className="panel left-panel">
        <div className="panel-header">
          <h1>paperflow</h1>
          <StatusPill status={health?.status} />
        </div>

        <label className="field">
          <span>Repo Root</span>
          <select value={selectedRepo} onChange={(event) => setSelectedRepo(event.target.value)}>
            {repos.map((repo) => (
              <option key={repo.repo_root} value={repo.repo_root}>
                {repo.repo_root}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Workflow Path</span>
          <input value={workflowPath} onChange={(event) => setWorkflowPath(event.target.value)} />
        </label>

        <label className="field">
          <span>Session</span>
          <select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>
            <option value="">New/Auto</option>
            {sessions.map((session) => (
              <option key={session.session_id} value={session.session_id}>
                {session.session_id} {session.preferred ? "(preferred)" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="meta-block">
          <h2>Repo Signals</h2>
          {repos
            .filter((repo) => repo.repo_root === selectedRepo)
            .map((repo) => (
              <div key={repo.repo_root} className="repo-signal">
                <div>opencode.json: {repo.has_opencode_config ? "yes" : "no"}</div>
                <div>OpenCode.md: {repo.has_opencode_memory ? "yes" : "no"}</div>
                <div>last used: {repo.last_used_at ? prettyTime(repo.last_used_at) : "n/a"}</div>
              </div>
            ))}
        </div>

        <div className="button-row">
          <button onClick={handleStartRun}>Run Workflow</button>
          <button className="secondary" onClick={handleOpenTerminal}>
            Open Terminal
          </button>
        </div>

        <div className="meta-block">
          <h2>Reusable Sessions</h2>
          <ul className="session-list">
            {sessions.map((session) => (
              <li key={session.session_id}>
                <button className="linkish" onClick={() => setSelectedSessionId(session.session_id)}>
                  {session.session_id.slice(0, 10)}
                </button>
                <span>{session.last_step || "n/a"}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="panel center-panel">
        <div className="panel-header">
          <div>
            <h2>Run Detail</h2>
            <p>{currentRun ? currentRun.run_id : "No run active"}</p>
          </div>
          <StatusPill status={currentRun?.status} />
        </div>

        <div className="run-grid">
          <div className="meta-card">
            <strong>Current Step</strong>
            <span>{currentRun?.current_step || "n/a"}</span>
          </div>
          <div className="meta-card">
            <strong>Created</strong>
            <span>{prettyTime(currentRun?.created_at)}</span>
          </div>
          <div className="meta-card">
            <strong>Finished</strong>
            <span>{prettyTime(currentRun?.finished_at)}</span>
          </div>
          <div className="meta-card">
            <strong>Session</strong>
            <span>{currentRun?.preferred_session_id || "n/a"}</span>
          </div>
        </div>

        <div className="meta-block">
          <h2>Step Events</h2>
          <div className="event-log">
            {events.map((event) => (
              <div key={`${event.sequence}-${event.event_type}`} className="event-row">
                <span>{prettyTime(event.created_at)}</span>
                <strong>{event.event_type}</strong>
                <span>{event.step_name || "run"}</span>
                <p>{event.message}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="meta-block">
          <h2>Artifacts</h2>
          <div className="button-row">
            <button className="secondary" onClick={() => openArtifacts(currentRun?.artifacts_root)}>
              Open Artifacts
            </button>
            <button className="secondary" onClick={() => openArtifacts(currentRun?.output_root)}>
              Open Output
            </button>
          </div>
        </div>
      </main>

      <section className="panel right-panel">
        <div className="panel-header">
          <div>
            <h2>Terminal</h2>
            <p>{terminalReady ? terminalSessionId || "ready" : "loading"}</p>
          </div>
          <button className="secondary" onClick={handleOpenTerminal}>
            Launch
          </button>
        </div>
        <div ref={terminalContainerRef} className="terminal-host" />
      </section>
    </div>
  );
}
