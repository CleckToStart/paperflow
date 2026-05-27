import React from "react";
import { FolderOpen, Play } from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import { eventTypeLabel, prettyTime } from "../lib/defaults";

export default function RunsPage({ currentRun, events, startRun, paperflow }) {
  return (
    <div className="page-column page-enter">
      <header className="page-header">
        <div>
          <h1>运行</h1>
          <p>{currentRun ? currentRun.run_id : "尚未启动工作流"}</p>
        </div>
        <div className="page-actions">
          <StatusBadge status={currentRun?.status} />
          <button className="primary-action" onClick={startRun}>
            <Play size={16} />
            <span>运行</span>
          </button>
        </div>
      </header>

      <section className="metrics-row">
        <div className="metric-box">
          <span>当前步骤</span>
          <strong>{currentRun?.current_step || "暂无"}</strong>
        </div>
        <div className="metric-box">
          <span>创建时间</span>
          <strong>{prettyTime(currentRun?.created_at)}</strong>
        </div>
        <div className="metric-box">
          <span>结束时间</span>
          <strong>{prettyTime(currentRun?.finished_at)}</strong>
        </div>
        <div className="metric-box">
          <span>会话</span>
          <strong>{currentRun?.preferred_session_id || "自动"}</strong>
        </div>
      </section>

      <section className="content-panel">
        <div className="section-header">
          <h2>事件流</h2>
          <span>{events.length} 条</span>
        </div>
        <div className="event-list">
          {events.length === 0 ? (
            <div className="empty-state">运行后这里会显示步骤事件、错误和状态变更。</div>
          ) : (
            events.map((event) => (
              <div key={`${event.sequence}-${event.event_type}`} className="event-item">
                <div className="event-head">
                  <strong>{eventTypeLabel(event.event_type)}</strong>
                  <span>{prettyTime(event.created_at)}</span>
                </div>
                <p>{event.message}</p>
                <small>{event.step_name || "流程"}</small>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="content-panel">
        <div className="section-header">
          <h2>产物入口</h2>
        </div>
        <div className="button-row">
          <button className="soft-button" onClick={() => paperflow.openPath(currentRun?.artifacts_root)} disabled={!currentRun?.artifacts_root}>
            <FolderOpen size={16} />
            <span>打开 artifacts</span>
          </button>
          <button className="soft-button" onClick={() => paperflow.openPath(currentRun?.output_root)} disabled={!currentRun?.output_root}>
            <FolderOpen size={16} />
            <span>打开 output</span>
          </button>
        </div>
      </section>
    </div>
  );
}
