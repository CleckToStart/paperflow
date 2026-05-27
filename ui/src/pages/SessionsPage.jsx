import React from "react";
import { CheckCircle2 } from "lucide-react";
import { prettyTime } from "../lib/defaults";

export default function SessionsPage({ sessions, selectedSessionId, setSelectedSessionId }) {
  return (
    <div className="page-column page-enter">
      <header className="page-header">
        <div>
          <h1>会话</h1>
          <p>按当前仓库和工作流复用 OpenCode 上下文。</p>
        </div>
      </header>

      <div className="list-panel">
        {sessions.length === 0 ? (
          <div className="empty-state">暂无可复用会话。</div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.session_id}
              className={`wide-list-item ${selectedSessionId === session.session_id ? "active" : ""}`}
              onClick={() => setSelectedSessionId(session.session_id)}
            >
              <div>
                <strong>{session.session_id}</strong>
                <span>{session.last_step || "未记录步骤"}</span>
              </div>
              <div className="list-side">
                {session.preferred ? <CheckCircle2 size={17} /> : null}
                <span>{prettyTime(session.last_used_at)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
