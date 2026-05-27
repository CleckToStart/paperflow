import React from "react";
import NavRail from "./NavRail";
import TopBar from "./TopBar";

export default function AppShell({
  activePage,
  setActivePage,
  navItems,
  health,
  selectedRepo,
  workflowPath,
  terminal,
  children,
}) {
  return (
    <div className="app-shell">
      <NavRail items={navItems} activePage={activePage} setActivePage={setActivePage} />
      <div className="app-body">
        <TopBar
          health={health}
          selectedRepo={selectedRepo}
          workflowPath={workflowPath}
          onSettings={() => setActivePage("settings")}
        />
        <div className={`app-content ${activePage === "settings" ? "no-right" : ""}`}>
          <main className="page-surface">{children}</main>
          {activePage !== "settings" ? <aside className="right-context">{terminal}</aside> : null}
        </div>
      </div>
    </div>
  );
}
