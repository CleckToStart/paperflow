# paperflow

`paperflow` 现在包含两层能力：

- Python backend：工作流编排、本地 HTTP API、`opencode` 调用、session/repo 状态管理
- Electron desktop：React UI + 内嵌终端，用于启动 workflow、查看日志、浏览 artifacts、手动接管 `opencode`

目标仍然是轻量接入 `opencode`，不改它的源码。

## 当前结构

```text
paperflow/
├── .venv/
├── electron/
├── paperflow/
│   ├── agents/
│   ├── api_server.py
│   ├── executor.py
│   ├── models.py
│   ├── state.py
│   └── workflow.py
├── ui/
├── run.py
├── workflow.yaml
├── requirements.txt
└── package.json
```

## 开发环境

### Python

项目默认使用根目录下的 `.venv`：

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

### Node / Electron

```powershell
npm install
```

### OpenAI

```powershell
$env:OPENAI_API_KEY="your_key"
```

### OpenCode

确保本机可以直接执行 `opencode`。  
底层 provider、`baseURL`、模型等建议放在目标代码仓库自己的 `opencode.json` 中，而不是放到 `paperflow` 里重复管理。

## 启动方式

### 只跑 Python CLI

```powershell
.\.venv\Scripts\python run.py --workflow workflow.yaml
```

### 启动本地 API

```powershell
.\.venv\Scripts\python run.py serve --host 127.0.0.1 --port 8765
```

### 启动 Electron 开发版

```powershell
npm run dev
```

Electron main 会先检查本地 API；如果未启动，会自动从 `.venv` 拉起 backend。

## 后端 API

当前最小接口：

- `GET /health`
- `GET /repos`
- `POST /workflow-runs`
- `GET /workflow-runs/{id}`
- `GET /workflow-runs/{id}/events`
- `GET /sessions`
- `POST /sessions/{id}/resume`
- `POST /terminal-sessions`

`/workflow-runs/{id}/events` 使用 SSE 推送日志事件。

## OpenCode 运行约定

`code_evidence` 步骤默认会：

- 显式传 `--dir <repo_root>`
- 按 `repo + workflow` 粒度复用 `--session`
- 支持可选 `--attach <url>`
- 将 session 记录持久化到 `state/sessions.json`

最近使用的 repo 会记录在 `state/repos.json`。

## 前端能力

第一版桌面 UI 提供：

- repo / workflow / session 选择
- workflow run 启动与事件流展示
- artifacts / output 打开入口
- 内嵌终端，通过 `xterm.js + node-pty` 托管 `opencode`

终端用于观察与人工接管，不承担自动 workflow 主执行逻辑。

## 验证

```powershell
.\.venv\Scripts\python -m unittest discover -s tests -v
.\.venv\Scripts\python -m compileall run.py paperflow tests
npm run build:renderer
```
