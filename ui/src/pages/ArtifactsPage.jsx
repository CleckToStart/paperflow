import React from "react";
import { FolderOpen } from "lucide-react";

export default function ArtifactsPage({ currentRun }) {
  return (
    <div className="page-column page-enter">
      <header className="page-header">
        <div>
          <h1>产物</h1>
          <p>查看最近一次运行生成的调试文件和正式输出。</p>
        </div>
      </header>
      <section className="artifact-grid">
        <button className="artifact-tile" onClick={() => window.paperflow.openPath(currentRun?.artifacts_root)}>
          <FolderOpen size={22} />
          <strong>Artifacts</strong>
          <span>{currentRun?.artifacts_root || "暂无路径"}</span>
        </button>
        <button className="artifact-tile" onClick={() => window.paperflow.openPath(currentRun?.output_root)}>
          <FolderOpen size={22} />
          <strong>Output</strong>
          <span>{currentRun?.output_root || "暂无路径"}</span>
        </button>
      </section>
    </div>
  );
}
