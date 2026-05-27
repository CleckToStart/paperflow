import React, { useEffect, useMemo, useState } from "react";
import { FolderOpen, History, Play, Settings, Workflow } from "lucide-react";
import AppShell from "./components/AppShell";
import TerminalPane from "./components/TerminalPane";
import WorkbenchPage from "./pages/WorkbenchPage";
import RunsPage from "./pages/RunsPage";
import SessionsPage from "./pages/SessionsPage";
import ArtifactsPage from "./pages/ArtifactsPage";
import SettingsPage from "./pages/SettingsPage";
import { emptyProvider } from "./lib/defaults";
import { getPaperflowApi } from "./lib/paperflowApi";

const navItems = [
  { key: "workbench", label: "工作台", icon: FolderOpen },
  { key: "runs", label: "运行", icon: Play },
  { key: "sessions", label: "会话", icon: History },
  { key: "artifacts", label: "产物", icon: Workflow },
  { key: "settings", label: "设置", icon: Settings },
];

function workflowName(workflowPath) {
  if (!workflowPath) return "";
  const filename = workflowPath.split(/[\\/]/).pop() || "";
  return filename.replace(/\.[^.]+$/, "");
}

export default function App() {
  const [activePage, setActivePage] = useState("workbench");
  const [activeSettingsSection, setActiveSettingsSection] = useState("opencode");
  const [health, setHealth] = useState(null);
  const [repos, setRepos] = useState([]);
  const [workflowPath, setWorkflowPath] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [currentRun, setCurrentRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [opencodeSettings, setOpencodeSettings] = useState(null);
  const [opencodePathDraft, setOpencodePathDraft] = useState("");
  const [providers, setProviders] = useState([]);
  const [routing, setRouting] = useState({
    writing: { provider_id: "", model: "" },
    review: { provider_id: "", model: "" },
    summary: { provider_id: "", model: "" },
  });
  const [fileTree, setFileTree] = useState(null);
  const [expandedDirs, setExpandedDirs] = useState(new Set([""]));
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");
  const paperflow = useMemo(() => getPaperflowApi(), []);

  const selectedRepoInfo = useMemo(
    () => repos.find((repo) => repo.repo_root === selectedRepo) || null,
    [repos, selectedRepo],
  );
  const currentWorkflowName = useMemo(() => workflowName(workflowPath), [workflowPath]);

  useEffect(() => {
    async function bootstrap() {
      const [healthResponse, reposResponse, opencodeResponse, providersResponse, routingResponse] = await Promise.all([
        paperflow.health(),
        paperflow.listRepos(),
        paperflow.getOpenCodeSettings(),
        paperflow.getProvidersSettings(),
        paperflow.getTaskRouting(),
      ]);
      setBootstrapError("");
      setHealth(healthResponse);
      setRepos(reposResponse.items);
      setWorkflowPath(reposResponse.default_workflow_path);
      setSelectedRepo(reposResponse.items[0]?.repo_root || healthResponse.backend_root);
      setOpencodeSettings(opencodeResponse);
      setOpencodePathDraft(opencodeResponse.configured_path || opencodeResponse.selected_path || "");
      setProviders(providersResponse.items.length > 0 ? providersResponse.items : [emptyProvider()]);
      setRouting(routingResponse);
    }
    bootstrap().catch((error) => {
      console.error(error);
      setBootstrapError(error.message || String(error));
    });
  }, [paperflow]);

  useEffect(() => {
    if (!selectedRepo || !currentWorkflowName) return;
    paperflow
      .listSessions({ repoRoot: selectedRepo, workflowName: currentWorkflowName })
      .then((response) => {
        setSessions(response.items);
        const preferred = response.items.find((item) => item.preferred);
        setSelectedSessionId(preferred?.session_id || response.items[0]?.session_id || "");
      })
      .catch(console.error);
  }, [paperflow, selectedRepo, currentWorkflowName]);

  useEffect(() => {
    if (!selectedRepo) return;
    paperflow
      .getFileTree(selectedRepo)
      .then((tree) => {
        setFileTree(tree);
        setExpandedDirs(new Set([""]));
        setSelectedFile("");
        setFileContent(null);
      })
      .catch(() => {
        setFileTree(null);
        setFileContent({ readable: false, reason: "tree_error", content: "" });
      });
  }, [paperflow, selectedRepo]);

  async function startRun() {
    const run = await paperflow.startWorkflowRun({
      workflow_path: workflowPath,
      repo_root: selectedRepo,
      resume_session_id: selectedSessionId || null,
    });
    setCurrentRun(run);
    setEvents([]);
    const unsubscribe = paperflow.subscribeRunEvents(run.run_id, async (event) => {
      setEvents((prev) => [...prev, event]);
      if (["run.status", "run.finished", "run.failed"].includes(event.event_type)) {
        setCurrentRun(await paperflow.getWorkflowRun(run.run_id));
      }
    });
    setTimeout(() => unsubscribe(), 1000 * 60 * 30);
  }

  async function openFile(path) {
    if (!path) return;
    setSelectedFile(path);
      setFileLoading(true);
    try {
      const content = await paperflow.readFile({ repoRoot: selectedRepo, path });
      setFileContent(content);
    } catch (error) {
      setFileContent({ path, name: path, readable: false, reason: "read_error", content: String(error) });
    } finally {
      setFileLoading(false);
    }
  }

  function toggleDir(path) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function saveOpenCodePath() {
    const updated = await paperflow.updateOpenCodeSettings({ executable_path: opencodePathDraft });
    setOpencodeSettings(updated);
    setOpencodePathDraft(updated.configured_path || updated.selected_path || "");
    setHealth(await paperflow.health());
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
    const updated = await paperflow.updateProvidersSettings({ items: filtered });
    setProviders(updated.items.length > 0 ? updated.items : [emptyProvider()]);
  }

  async function saveRouting() {
    setRouting(await paperflow.updateTaskRouting(routing));
  }

  const commonProps = {
    health,
    repos,
    selectedRepo,
    setSelectedRepo,
    selectedRepoInfo,
    workflowPath,
    setWorkflowPath,
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    currentRun,
    events,
    startRun,
    fileTree,
    expandedDirs,
    toggleDir,
    selectedFile,
    openFile,
    fileContent,
    fileLoading,
    bootstrapError,
  };

  const page =
    activePage === "workbench" ? (
      <WorkbenchPage {...commonProps} />
    ) : activePage === "runs" ? (
      <RunsPage currentRun={currentRun} events={events} startRun={startRun} paperflow={paperflow} />
    ) : activePage === "sessions" ? (
      <SessionsPage sessions={sessions} selectedSessionId={selectedSessionId} setSelectedSessionId={setSelectedSessionId} />
    ) : activePage === "artifacts" ? (
      <ArtifactsPage currentRun={currentRun} />
    ) : (
      <SettingsPage
        activeSection={activeSettingsSection}
        setActiveSection={setActiveSettingsSection}
        opencodeSettings={opencodeSettings}
        opencodePathDraft={opencodePathDraft}
        setOpencodePathDraft={setOpencodePathDraft}
        saveOpenCodePath={saveOpenCodePath}
        providers={providers}
        setProviders={setProviders}
        updateProvider={updateProvider}
        saveProviders={saveProviders}
        routing={routing}
        setRouting={setRouting}
        saveRouting={saveRouting}
      />
    );

  return (
    <AppShell
      activePage={activePage}
      setActivePage={setActivePage}
      navItems={navItems}
      health={health}
      selectedRepo={selectedRepo}
      workflowPath={workflowPath}
      terminal={<TerminalPane selectedRepo={selectedRepo} selectedSessionId={selectedSessionId} paperflow={paperflow} />}
    >
      {page}
    </AppShell>
  );
}
