import React from "react";
import { Clipboard, ExternalLink, FileText } from "lucide-react";
import { formatBytes } from "../lib/defaults";
import { getPaperflowApi } from "../lib/paperflowApi";

function reasonText(reason) {
  const map = {
    too_large: "文件超过预览大小限制",
    binary: "二进制文件不可预览",
    decode_error: "文件编码无法解析",
    read_error: "读取文件失败",
    tree_error: "文件树加载失败",
  };
  return map[reason] || "请选择一个文件";
}

export default function FileViewer({ repoRoot, selectedFile, fileContent, fileLoading }) {
  const paperflow = getPaperflowApi();

  async function copyContent() {
    if (fileContent?.readable) {
      await navigator.clipboard.writeText(fileContent.content);
    }
  }

  async function showInFolder() {
    if (repoRoot && selectedFile) {
      await paperflow.showItemInFolder(`${repoRoot}\\${selectedFile.replaceAll("/", "\\")}`);
    }
  }

  if (!selectedFile) {
    return (
      <section className="file-viewer empty-viewer">
        <FileText size={34} />
        <h2>请选择一个文件</h2>
        <p>在左侧文件资源管理器中选择文件后，这里会显示只读内容。</p>
      </section>
    );
  }

  return (
    <section className="file-viewer">
      <header className="file-viewer-header">
        <div>
          <h2>{fileContent?.name || selectedFile.split("/").pop()}</h2>
          <p>{selectedFile}</p>
        </div>
        <div className="file-actions">
          {fileContent?.size != null ? <span>{formatBytes(fileContent.size)}</span> : null}
          <button className="icon-button" title="复制内容" onClick={copyContent} disabled={!fileContent?.readable}>
            <Clipboard size={16} />
          </button>
          <button className="icon-button" title="在文件管理器中显示" onClick={showInFolder}>
            <ExternalLink size={16} />
          </button>
        </div>
      </header>

      <div className="file-body">
        {fileLoading ? (
          <div className="empty-state">正在读取文件</div>
        ) : fileContent?.readable ? (
          <pre>{fileContent.content}</pre>
        ) : (
          <div className="empty-state">{reasonText(fileContent?.reason)}</div>
        )}
      </div>
    </section>
  );
}
