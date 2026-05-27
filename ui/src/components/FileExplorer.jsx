import React from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";

function FileNode({ node, depth, expandedDirs, toggleDir, selectedFile, openFile }) {
  const isDir = node.kind === "directory";
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedFile === node.path;
  const indent = { paddingLeft: `${8 + depth * 14}px` };

  return (
    <div>
      <button
        className={`file-node ${isSelected ? "selected" : ""}`}
        style={indent}
        onClick={() => (isDir ? toggleDir(node.path) : openFile(node.path))}
      >
        {isDir ? isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : <span className="file-spacer" />}
        {isDir ? isExpanded ? <FolderOpen size={16} /> : <Folder size={16} /> : <FileText size={16} />}
        <span>{node.name || "项目根目录"}</span>
      </button>
      {isDir && isExpanded
        ? node.children.map((child) => (
            <FileNode
              key={child.path || child.name}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              selectedFile={selectedFile}
              openFile={openFile}
            />
          ))
        : null}
    </div>
  );
}

export default function FileExplorer({ fileTree, expandedDirs, toggleDir, selectedFile, openFile }) {
  return (
    <section className="file-explorer">
      <div className="section-header">
        <h2>文件</h2>
        {fileTree?.truncated ? <span>已截断</span> : null}
      </div>
      <div className="file-tree">
        {fileTree?.root ? (
          <FileNode
            node={fileTree.root}
            depth={0}
            expandedDirs={expandedDirs}
            toggleDir={toggleDir}
            selectedFile={selectedFile}
            openFile={openFile}
          />
        ) : (
          <div className="empty-state">暂无文件树</div>
        )}
      </div>
    </section>
  );
}
