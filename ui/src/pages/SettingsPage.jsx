import React from "react";
import { Bot, Palette, Route, Server } from "lucide-react";
import { emptyProvider, prettyTime } from "../lib/defaults";

const sections = [
  { key: "opencode", label: "OpenCode", icon: Bot },
  { key: "providers", label: "Paperflow API", icon: Server },
  { key: "routing", label: "任务路由", icon: Route },
  { key: "appearance", label: "外观", icon: Palette },
];

function routeOptions(providers) {
  return providers.filter((provider) => provider.enabled && provider.provider_id.trim());
}

export default function SettingsPage({
  activeSection,
  setActiveSection,
  opencodeSettings,
  opencodePathDraft,
  setOpencodePathDraft,
  saveOpenCodePath,
  providers,
  setProviders,
  updateProvider,
  saveProviders,
  routing,
  setRouting,
  saveRouting,
}) {
  return (
    <div className="settings-page page-enter">
      <aside className="settings-menu">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.key}
              className={`settings-menu-item ${activeSection === section.key ? "active" : ""}`}
              onClick={() => setActiveSection(section.key)}
            >
              <Icon size={17} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </aside>

      <section className="settings-content">
        {activeSection === "opencode" ? (
          <div className="settings-section">
            <header className="page-header compact">
              <div>
                <h1>OpenCode</h1>
                <p>绑定桌面版或 CLI 附带的可执行文件。</p>
              </div>
            </header>
            <label className="field">
              <span>可执行文件绝对路径</span>
              <input value={opencodePathDraft} onChange={(event) => setOpencodePathDraft(event.target.value)} />
            </label>
            <button className="primary-action" onClick={saveOpenCodePath}>保存路径</button>
            <div className="kv-list roomy">
              <div>
                <span>当前生效</span>
                <strong>{opencodeSettings?.selected_path || "未发现"}</strong>
              </div>
              <div>
                <span>最近检查</span>
                <strong>{prettyTime(opencodeSettings?.last_checked_at)}</strong>
              </div>
            </div>
            <div className="candidate-list">
              {(opencodeSettings?.candidates || []).map((candidate) => (
                <div key={`${candidate.path}-${candidate.source}`} className="candidate-item">
                  <div>
                    <strong>{candidate.source}</strong>
                    <span>{candidate.path}</span>
                  </div>
                  <em className={candidate.exists ? "ok" : "missing"}>{candidate.exists ? "可用" : "不存在"}</em>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeSection === "providers" ? (
          <div className="settings-section">
            <header className="page-header compact">
              <div>
                <h1>Paperflow API</h1>
                <p>配置写作、审阅和总结使用的模型源。</p>
              </div>
              <button className="soft-button" onClick={() => setProviders((prev) => [...prev, emptyProvider()])}>新增源</button>
            </header>
            <div className="provider-stack">
              {providers.map((provider, index) => (
                <div key={`${provider.provider_id || "provider"}-${index}`} className="form-card">
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
                  <div className="two-fields">
                    <label className="field">
                      <span>默认模型</span>
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
            <button className="primary-action" onClick={saveProviders}>保存 API 源</button>
          </div>
        ) : null}

        {activeSection === "routing" ? (
          <div className="settings-section">
            <header className="page-header compact">
              <div>
                <h1>任务路由</h1>
                <p>把不同写作任务路由到不同模型。</p>
              </div>
            </header>
            <div className="route-grid">
              {[
                { key: "writing", label: "写作" },
                { key: "review", label: "审阅" },
                { key: "summary", label: "总结" },
              ].map((task) => (
                <div key={task.key} className="form-card">
                  <h2>{task.label}</h2>
                  <label className="field">
                    <span>Provider</span>
                    <select
                      value={routing[task.key]?.provider_id || ""}
                      onChange={(event) =>
                        setRouting((prev) => ({ ...prev, [task.key]: { ...prev[task.key], provider_id: event.target.value } }))
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
                        setRouting((prev) => ({ ...prev, [task.key]: { ...prev[task.key], model: event.target.value } }))
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
            <button className="primary-action" onClick={saveRouting}>保存任务路由</button>
          </div>
        ) : null}

        {activeSection === "appearance" ? (
          <div className="settings-section">
            <header className="page-header compact">
              <div>
                <h1>外观</h1>
                <p>当前默认使用浅色圆润工作台。</p>
              </div>
            </header>
            <div className="theme-options">
              <button className="theme-card active">
                <strong>浅色主题</strong>
                <span>当前启用</span>
              </button>
              <button className="theme-card" disabled>
                <strong>深色主题</strong>
                <span>预留</span>
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <aside className="settings-summary">
        <div className="summary-note">
          <strong>配置摘要</strong>
          <span>OpenCode、API 源和任务路由会写入本地 state/settings.json。</span>
        </div>
      </aside>
    </div>
  );
}
