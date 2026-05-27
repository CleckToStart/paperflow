import React, { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

function StatusPill({ status }) {
  const labelMap = {
    ok: "正常",
    completed: "完成",
    running: "运行中",
    pending: "等待中",
    failed: "失败",
    idle: "空闲",
  };
  const value = status || "idle";
  return <span className={`status-pill status-${value}`}>{labelMap[value] || value}</span>;
}

function prettyTime(value) {
  if (!value) return "暂无";
  return new Date(value).toLocaleString("zh-CN");
}

function emptyProvider() {
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

function routeOptions(providers) {
  return providers.filter((provider) => provider.enabled && provider.provider_id.trim());
}

function eventTypeLabel(eventType) {
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
  const [opencodeSettings, setOpencodeSettings] = useState(null);
  const [opencodePathDraft, setOpencodePathDraft] = useState("");
  const [providers, setProviders] = useState([]);
  const [routing, setRouting] = useState({
    writing: { provider_id: "", model: "" },
    review: { provider_id: "", model: "" },
    summary: { provider_id: "", model: "" },
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const currentWorkflowName = useMemo(() => {
    if (!workflowPath) return "";
    const filename = workflowPath.split(/[\\/]/).pop() || "";
    return filename.replace(/\.[^.]+$/, "");
  }, [workflowPath]);

  const selectedRepoInfo = useMemo(
    () => repos.find((repo) => repo.repo_root === selectedRepo) || null,
    [repos, selectedRepo],
  );

  useEffect(() => {
    async function bootstrap() {
      const [healthResponse, reposResponse, opencodeResponse, providersResponse, routingResponse] = await Promise.all([
        window.paperflow.health(),
        window.paperflow.listRepos(),
        window.paperflow.getOpenCodeSettings(),
        window.paperflow.getProvidersSettings(),
        window.paperflow.getTaskRouting(),
      ]);
      setHealth(healthResponse);
      setRepos(reposResponse.items);
      setWorkflowPath(reposResponse.default_workflow_path);
      setSelectedRepo(reposResponse.items[0]?.repo_root || healthResponse.backend_root);
      setOpencodeSettings(opencodeResponse);
      setOpencodePathDraft(opencodeResponse.configured_path || opencodeResponse.selected_path || "");
      setProviders(providersResponse.items.length > 0 ? providersResponse.items : [emptyProvider()]);
      setRouting(routingResponse);
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
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#e6edf3",
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
        terminal.writeln("\r\n[终端会话已退出]");
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
      if (["run.status", "run.finished", "run.failed"].includes(event.event_type)) {
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
    });
    setTerminalSessionId(record.terminal_session_id);
    terminalRef.current?.clear();
    terminalRef.current?.writeln(`[终端 ${record.terminal_session_id}] ${record.repo_root}`);
    fitAddonRef.current?.fit();
    window.paperflow
      .resizeTerminal(record.terminal_session_id, terminalRef.current?.cols || 120, terminalRef.current?.rows || 40)
      .catch(console.error);
  }

  async function openArtifacts(pathValue) {
    if (!pathValue) return;
    await window.paperflow.openPath(pathValue);
  }

  async function saveOpenCodePath() {
    const updated = await window.paperflow.updateOpenCodeSettings({ executable_path: opencodePathDraft });
    setOpencodeSettings(updated);
    setOpencodePathDraft(updated.configured_path || updated.selected_path || "");
    const healthResponse = await window.paperflow.health();
    setHealth(healthResponse);
  }

  function updateProvider(index, field, value) {
    setProviders((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  }

  async function saveProviders() {
    const filtered = providers.filter(
      (provider) =>
        provider.provider_id.trim() &&
        provider.label.trim() &&
        provider.base_url.trim() &&
        provider.default_model.trim(),
    );
    const updated = await window.paperflow.updateProvidersSettings({ items: filtered });
    setProviders(updated.items.length > 0 ? updated.items : [emptyProvider()]);
  }

  async function saveRouting() {
    const updated = await window.paperflow.updateTaskRouting(routing);
    setRouting(updated);
  }

  return (
    <div className="codex-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">P</div>
          <div>
            <h1>paperflow</h1>
            <p>论文写作与 OpenCode 协同工作台</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="inline-status">
            <span>后端</span>
            <StatusPill status={health?.status} />
          </div>
          <div className="inline-status">
            <span>OpenCode</span>
            <span className="path-badge">{health?.opencode_selected_path || "未绑定"}</span>
          </div>
          <button className="secondary ghost" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
        </div>
      </header>

      <div className="workspace-shell">
        <aside className="sidebar">
          <section className="sidebar-section">
            <div className="section-title-row">
              <h2>工作区</h2>
              <StatusPill status={currentRun?.status} />
            </div>
            <label className="field">
              <span>代码仓库</span>
              <select value={selectedRepo} onChange={(event) => setSelectedRepo(event.target.value)}>
                {repos.map((repo) => (
                  <option key={repo.repo_root} value={repo.repo_root}>
                    {repo.repo_root}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>工作流文件</span>
              <input value={workflowPath} onChange={(event) => setWorkflowPath(event.target.value)} />
            </label>
            <label className="field">
              <span>复用会话</span>
              <select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>
                <option value="">自动选择/新建</option>
                {sessions.map((session) => (
                  <option key={session.session_id} value={session.session_id}>
                    {session.session_id} {session.preferred ? "（默认）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-stack">
              <button onClick={handleStartRun}>运行工作流</button>
              <button className="secondary" onClick={handleOpenTerminal}>
                打开终端
              </button>
            </div>
          </section>

          <section className="sidebar-section">
            <h2>仓库状态</h2>
            <div className="info-card">
              <div className="info-row">
                <span>opencode.json</span>
                <strong>{selectedRepoInfo?.has_opencode_config ? "已存在" : "缺失"}</strong>
              </div>
              <div className="info-row">
                <span>OpenCode.md</span>
                <strong>{selectedRepoInfo?.has_opencode_memory ? "已存在" : "缺失"}</strong>
              </div>
              <div className="info-row">
                <span>最近使用</span>
                <strong>{prettyTime(selectedRepoInfo?.last_used_at)}</strong>
              </div>
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-title-row">
              <h2>历史会话</h2>
              <span className="muted-text">{sessions.length} 个</span>
            </div>
            <div className="session-column">
              {sessions.length === 0 ? (
                <div className="empty-card">当前仓库还没有可复用的 OpenCode 会话。</div>
              ) : (
                sessions.map((session) => (
                  <button
                    key={session.session_id}
                    className={`session-card ${selectedSessionId === session.session_id ? "active" : ""}`}
                    onClick={() => setSelectedSessionId(session.session_id)}
                  >
                    <div className="session-primary">
                      <span>{session.session_id.slice(0, 12)}</span>
                      {session.preferred ? <em>默认</em> : null}
                    </div>
                    <div className="session-secondary">
                      <span>{session.last_step || "未记录步骤"}</span>
                      <span>{prettyTime(session.last_used_at)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <main className="content-area">
          <section className="main-panel">
            <div className="main-panel-header">
              <div>
                <h2>运行概览</h2>
                <p>{currentRun ? currentRun.run_id : "尚未启动工作流"}</p>
              </div>
              <div className="button-row">
                <button className="secondary" onClick={() => openArtifacts(currentRun?.artifacts_root)}>
                  打开产物目录
                </button>
                <button className="secondary" onClick={() => openArtifacts(currentRun?.output_root)}>
                  打开输出目录
                </button>
              </div>
            </div>

            <div className="summary-grid">
              <div className="summary-card">
                <span>当前步骤</span>
                <strong>{currentRun?.current_step || "暂无"}</strong>
              </div>
              <div className="summary-card">
                <span>创建时间</span>
                <strong>{prettyTime(currentRun?.created_at)}</strong>
              </div>
              <div className="summary-card">
                <span>结束时间</span>
                <strong>{prettyTime(currentRun?.finished_at)}</strong>
              </div>
              <div className="summary-card">
                <span>复用会话</span>
                <strong>{currentRun?.preferred_session_id || "自动"}</strong>
              </div>
            </div>

            <div className="main-subpanel">
              <div className="section-title-row">
                <h3>事件流</h3>
                <span className="muted-text">{events.length} 条</span>
              </div>
              <div className="event-log">
                {events.length === 0 ? (
                  <div className="empty-card">运行后这里会显示步骤事件、错误和状态变更。</div>
                ) : (
                  events.map((event) => (
                    <div key={`${event.sequence}-${event.event_type}`} className="event-row">
                      <div className="event-meta">
                        <span>{prettyTime(event.created_at)}</span>
                        <strong>{eventTypeLabel(event.event_type)}</strong>
                        <span>{event.step_name || "流程"}</span>
                      </div>
                      <p>{event.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="terminal-panel">
            <div className="main-panel-header">
              <div>
                <h2>终端</h2>
                <p>{terminalReady ? terminalSessionId || "已就绪，尚未启动会话" : "终端初始化中"}</p>
              </div>
              <button className="secondary" onClick={handleOpenTerminal}>
                启动 OpenCode 终端
              </button>
            </div>
            <div ref={terminalContainerRef} className="terminal-host" />
          </section>
        </main>
      </div>

      {settingsOpen ? (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <aside className="settings-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>设置</h2>
                <p>管理 OpenCode 可执行文件、Paperflow 模型源和任务路由。</p>
              </div>
              <button className="secondary ghost" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>

            <section className="drawer-section">
              <h3>OpenCode 可执行文件</h3>
              <label className="field">
                <span>绝对路径</span>
                <input value={opencodePathDraft} onChange={(event) => setOpencodePathDraft(event.target.value)} />
              </label>
              <div className="button-row">
                <button className="secondary" onClick={saveOpenCodePath}>
                  保存路径
                </button>
              </div>
              <div className="info-card">
                <div className="info-row">
                  <span>当前生效</span>
                  <strong>{opencodeSettings?.selected_path || "未发现"}</strong>
                </div>
                <div className="info-row">
                  <span>最近检查</span>
                  <strong>{prettyTime(opencodeSettings?.last_checked_at)}</strong>
                </div>
              </div>
              <div className="candidate-list">
                {(opencodeSettings?.candidates || []).map((candidate) => (
                  <div key={`${candidate.path}-${candidate.source}`} className="candidate-item">
                    <div>
                      <strong>{candidate.source}</strong>
                      <p>{candidate.path}</p>
                    </div>
                    <span className={`candidate-badge ${candidate.exists ? "ok" : "missing"}`}>
                      {candidate.exists ? "可用" : "不存在"}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="drawer-section">
              <div className="section-title-row">
                <h3>Paperflow API 源</h3>
                <button className="secondary" onClick={() => setProviders((prev) => [...prev, emptyProvider()])}>
                  新增源
                </button>
              </div>
              <div className="provider-column">
                {providers.map((provider, index) => (
                  <div key={`${provider.provider_id || "provider"}-${index}`} className="provider-form-card">
                    <label className="field">
                      <span>Provider ID</span>
                      <input value={provider.provider_id} onChange={(event) => updateProvider(index, "provider_id", event.target.value)} />
                    </label>
                    <label className="field">
                      <span>显示名称</span>
                      <input value={provider.label} onChange={(event) => updateProvider(index, "label", event.target.value)} />
                    </label>
                    <label className="field">
                      <span>Base URL</span>
                      <input value={provider.base_url} onChange={(event) => updateProvider(index, "base_url", event.target.value)} />
                    </label>
                    <label className="field">
                      <span>API Key</span>
                      <input value={provider.api_key} onChange={(event) => updateProvider(index, "api_key", event.target.value)} />
                    </label>
                    <div className="two-column-fields">
                      <label className="field">
                        <span>主模型</span>
                        <input value={provider.default_model} onChange={(event) => updateProvider(index, "default_model", event.target.value)} />
                      </label>
                      <label className="field">
                        <span>小模型</span>
                        <input value={provider.small_model} onChange={(event) => updateProvider(index, "small_model", event.target.value)} />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="button-row">
                <button className="secondary" onClick={saveProviders}>
                  保存 API 源
                </button>
              </div>
            </section>

            <section className="drawer-section">
              <h3>任务路由</h3>
              <div className="route-column">
                {[
                  { key: "writing", label: "写作" },
                  { key: "review", label: "审阅" },
                  { key: "summary", label: "总结" },
                ].map((task) => (
                  <div key={task.key} className="route-card">
                    <div className="route-title">{task.label}</div>
                    <label className="field">
                      <span>Provider</span>
                      <select
                        value={routing[task.key]?.provider_id || ""}
                        onChange={(event) =>
                          setRouting((prev) => ({
                            ...prev,
                            [task.key]: { ...prev[task.key], provider_id: event.target.value },
                          }))
                        }
                      >
                        <option value="">沿用工作流默认值</option>
                        {routeOptions(providers).map((provider) => (
                          <option key={provider.provider_id} value={provider.provider_id}>
                            {provider.label || provider.provider_id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>模型覆盖</span>
                      <input
                        value={routing[task.key]?.model || ""}
                        onChange={(event) =>
                          setRouting((prev) => ({
                            ...prev,
                            [task.key]: { ...prev[task.key], model: event.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
              <div className="button-row">
                <button className="secondary" onClick={saveRouting}>
                  保存任务路由
                </button>
              </div>
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
