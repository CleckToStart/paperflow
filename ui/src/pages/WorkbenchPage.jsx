import React from "react";
import { Play } from "lucide-react";
import FileExplorer from "../components/FileExplorer";
import FileViewer from "../components/FileViewer";

export default function WorkbenchPage({
  repos,
  selectedRepo,
  setSelectedRepo,
  workflowPath,
  setWorkflowPath,
  sessions,
  selectedSessionId,
  setSelectedSessionId,
  selectedRepoInfo,
  startRun,
  fileTree,
  expandedDirs,
  toggleDir,
  selectedFile,
  openFile,
  fileContent,
  fileLoading,
  bootstrapError,
}) {
  return (
    <div className="workbench-grid page-enter">
      <aside className="left-context">
        <section className="control-panel">
          <div className="section-header">
            <h2>项目</h2>
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
            <span>工作流</span>
            <input value={workflowPath} onChange={(event) => setWorkflowPath(event.target.value)} />
          </label>
          <label className="field">
            <span>OpenCode 会话</span>
            <select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>
              <option value="">自动选择</option>
              {sessions.map((session) => (
                <option key={session.session_id} value={session.session_id}>
                  {session.session_id} {session.preferred ? "默认" : ""}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-action" onClick={startRun}>
            <Play size={16} />
            <span>运行工作流</span>
          </button>
          {bootstrapError ? <div className="inline-error">后端连接失败：{bootstrapError}</div> : null}
        </section>

        <section className="control-panel compact">
          <div className="section-header">
            <h2>仓库状态</h2>
          </div>
          <div className="kv-list">
            <div>
              <span>opencode.json</span>
              <strong>{selectedRepoInfo?.has_opencode_config ? "已存在" : "缺失"}</strong>
            </div>
            <div>
              <span>OpenCode.md</span>
              <strong>{selectedRepoInfo?.has_opencode_memory ? "已存在" : "缺失"}</strong>
            </div>
          </div>
        </section>

        <FileExplorer
          fileTree={fileTree}
          expandedDirs={expandedDirs}
          toggleDir={toggleDir}
          selectedFile={selectedFile}
          openFile={openFile}
        />
      </aside>

      <FileViewer repoRoot={selectedRepo} selectedFile={selectedFile} fileContent={fileContent} fileLoading={fileLoading} />
    </div>
  );
}
