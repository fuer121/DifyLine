import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Clipboard,
  Database,
  Loader2,
  Play,
  Plus,
  RefreshCcw,
  Trash2,
  TriangleAlert
} from "lucide-react";
import "./styles.css";

const API_BASE = "";
const HISTORY_KEY = "dify.workflow.history.v1";
const HISTORY_LIMIT = 20;

function App() {
  const [config, setConfig] = useState(null);
  const [inputs, setInputs] = useState({});
  const [result, setResult] = useState(null);
  const [larkResult, setLarkResult] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [activeHistoryId, setActiveHistoryId] = useState("");
  const [baseName, setBaseName] = useState("");
  const [tableName, setTableName] = useState("");
  const [running, setRunning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    persistHistory(history);
  }, [history]);

  useEffect(() => {
    if (!config || !history.length) return;
    const latest = history[0];
    if (!latest || activeHistoryId) return;

    if (latest.inputs) setInputs(latest.inputs);
    if (latest.baseName) setBaseName(latest.baseName);
    if (latest.tableName) setTableName(latest.tableName);
    if (latest.result) setResult(latest.result);
    if (latest.larkResult) setLarkResult(latest.larkResult);
    setActiveHistoryId(latest.id);
    addLog("INFO", "System", `已恢复最近 ${history.length} 条生成内容中的最新一条`);
  }, [config, history, activeHistoryId]);

  async function loadConfig() {
    try {
      const data = await apiGet("/api/config");
      setConfig(data);
      setInputs(
        Object.fromEntries(
          data.fields.map((field) => [field.name, field.defaultValue ?? ""])
        )
      );
      setBaseName(renderTemplate(data.app.baseNameTemplate));
      setTableName(data.app.tableName);
      addLog("INFO", "System", "配置加载完成");
    } catch (loadError) {
      setError(loadError.message);
      addLog("ERROR", "System", loadError.message);
    }
  }

  async function runWorkflow() {
    setRunning(true);
    setError("");
    setLarkResult(null);
    addLog("INFO", "Dify", "开始运行工作流");

    try {
      const data = await apiPost("/api/workflow/run", { inputs });
      const entry = createHistoryEntry({
        inputs,
        result: data,
        baseName,
        tableName
      });
      setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, HISTORY_LIMIT));
      setActiveHistoryId(entry.id);
      setResult({ ...data, historyId: entry.id });
      setLarkResult(null);
      addLog(
        "INFO",
        "Parser",
        `JSON 解析成功，得到 ${data.parsed.rowCount} 条记录、${data.parsed.columns.length} 个字段`
      );
    } catch (runError) {
      setResult(null);
      setError(runError.message);
      addLog("ERROR", "Dify", runError.message);
    } finally {
      setRunning(false);
    }
  }

  async function createBase() {
    if (!result?.parsed) return;
    setCreating(true);
    setError("");
    addLog("INFO", "lark-cli", `开始创建飞书多维表格：${baseName}`);

    try {
      const data = await apiPost("/api/lark/base/create", {
        parsed: result.parsed,
        baseName,
        tableName
      });
      setLarkResult(data);
      if (result?.historyId) {
        setHistory((current) =>
          updateHistoryEntry(current, result.historyId, {
            larkResult: data,
            baseName,
            tableName
          })
        );
      }
      addLog("INFO", "lark-cli", `创建成功，写入 ${data.recordCount} 条记录`);
    } catch (createError) {
      setError(createError.message);
      addLog("ERROR", "lark-cli", createError.message);
    } finally {
      setCreating(false);
    }
  }

  function updateInput(name, value) {
    setInputs((current) => ({ ...current, [name]: value }));
  }

  function resetResult() {
    setResult(null);
    setLarkResult(null);
    setActiveHistoryId("");
    setError("");
    addLog("INFO", "System", "结果已清空");
  }

  function restoreHistoryEntry(entry) {
    if (!entry) return;
    setInputs(entry.inputs || {});
    setResult(entry.result || null);
    setLarkResult(entry.larkResult || null);
    setBaseName(entry.baseName || renderTemplate(config.app.baseNameTemplate));
    setTableName(entry.tableName || config.app.tableName);
    setActiveHistoryId(entry.id);
    setError("");
    addLog("INFO", "System", `已恢复历史结果：${formatHistoryLabel(entry)}`);
  }

  function addLog(level, source, message) {
    setLogs((current) =>
      [
        {
          time: new Date().toLocaleString("zh-CN", { hour12: false }),
          level,
          source,
          message
        },
        ...current
      ].slice(0, 20)
    );
  }

  const preview = useMemo(() => result?.parsed?.previewRows || [], [result]);
  const columns = useMemo(() => result?.parsed?.columns || [], [result]);

  if (!config) {
    return (
      <main className="boot">
        <Loader2 className="spin" size={24} />
        <span>正在加载控制台配置...</span>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Database size={20} />
          </div>
          <div>
            <h1>Dify 工作流控制台</h1>
            <p>本地调用 Dify 工作流，并生成飞书多维表格</p>
          </div>
        </div>
        <div className="status-strip">
          <Status ok={config.runtime.difyConfigured} label="Dify" value={config.runtime.difyBase || "未配置"} />
          <Status ok label="lark-cli" value={`--as ${config.app.larkIdentity}`} />
        </div>
      </header>

      <section className="scope-strip">
        <span>飞书应用需开通权限</span>
        {(config.app.requiredLarkScopes || []).map((scope) => (
          <code key={scope}>{scope}</code>
        ))}
      </section>

      {error ? (
        <section className="alert">
          <TriangleAlert size={18} />
          <span>{error}</span>
        </section>
      ) : null}

      <section className="workspace">
        <aside className="left-rail">
          <Panel
            index="1"
            title="工作流输入配置"
            description="字段来自 config/workflow-fields.json，提交时会映射为 Dify inputs。"
            action={<GhostButton icon={RefreshCcw} label="重载配置" onClick={loadConfig} />}
          >
            <div className="field-list">
              <div className="field-head">
                <span>字段名</span>
                <span>类型</span>
                <span>必填</span>
                <span>值</span>
              </div>
              {config.fields.map((field) => (
                <div className="field-row" key={field.name}>
                  <input value={field.label || field.name} disabled />
                  <span className="type-chip">{field.type}</span>
                  <span className={field.required ? "required yes" : "required"}>{field.required ? "是" : "否"}</span>
                  <FieldInput
                    field={field}
                    value={inputs[field.name] ?? ""}
                    onChange={(value) => updateInput(field.name, value)}
                  />
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            index="2"
            title="运行工作流"
            description="使用 blocking 模式等待 Dify 完成，再解析 outputs.result。"
            action={<GhostButton icon={Trash2} label="清空结果" onClick={resetResult} />}
          >
            <button className="primary-run" onClick={runWorkflow} disabled={running || !config.runtime.difyConfigured}>
              {running ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              {running ? "运行中..." : "运行工作流"}
            </button>
          </Panel>
        </aside>

        <section className="right-rail">
          <Panel
            index="3"
            title="输出预览"
            description="解析后的 JSON 数据，最多展示前 100 条。"
            action={
              <GhostButton
                icon={Clipboard}
                label="复制 JSON"
                onClick={() => navigator.clipboard?.writeText(JSON.stringify(result?.rawOutput ?? "", null, 2))}
                disabled={!result}
              />
            }
          >
            <PreviewTable columns={columns} rows={preview} />
            <HistoryList
              entries={history}
              activeId={activeHistoryId}
              onSelect={restoreHistoryEntry}
            />
          </Panel>

          <Panel index="4" title="创建飞书多维表格" description="确认预览无误后，再创建新的 Base 并写入记录。">
            <div className="lark-grid">
              <div className="form-stack">
                <label>
                  <span>机器人身份</span>
                  <input value={`lark-cli --as ${config.app.larkIdentity}`} disabled />
                </label>
                <label>
                  <span>多维表格名称</span>
                  <input value={baseName} onChange={(event) => setBaseName(event.target.value)} />
                </label>
                <label>
                  <span>数据表名称</span>
                  <input value={tableName} onChange={(event) => setTableName(event.target.value)} />
                </label>
                <button className="create-button" disabled={!result?.parsed || creating} onClick={createBase}>
                  {creating ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
                  {creating ? "创建中..." : "创建飞书多维表格"}
                </button>
              </div>
              <div className="create-result">
                {larkResult ? (
                  <>
                    <div className="success-title">
                      <CheckCircle2 size={18} />
                      创建成功
                    </div>
                    <ResultLine label="记录数" value={larkResult.recordCount} />
                    <ResultLine label="字段数" value={larkResult.fieldCount} />
                    <ResultLine label="Base Token" value={larkResult.baseToken} />
                    <ResultLine label="Table ID" value={larkResult.tableId} />
                    {larkResult.baseUrl ? (
                      <a className="base-link" href={larkResult.baseUrl} target="_blank" rel="noreferrer">
                        打开飞书多维表格
                      </a>
                    ) : null}
                  </>
                ) : (
                  <div className="empty-state">尚未创建。运行工作流并确认预览后，可在这里生成飞书 Base。</div>
                )}
              </div>
            </div>
          </Panel>
        </section>
      </section>

      <Panel index="5" title="活动日志" description="最近 20 条本地操作记录。">
        <LogTable logs={logs} />
      </Panel>
    </main>
  );
}

function Panel({ index, title, description, action, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{index}. {title}</h2>
          <p>{description}</p>
        </div>
        {action ? <div className="panel-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Status({ ok, label, value }) {
  return (
    <div className="status-item">
      <span className={ok ? "dot ok" : "dot bad"} />
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function GhostButton({ icon: Icon, label, onClick, disabled }) {
  return (
    <button className="ghost-button" onClick={onClick} disabled={disabled}>
      <Icon size={16} />
      {label}
    </button>
  );
}

function FieldInput({ field, value, onChange }) {
  if (field.type === "boolean") {
    return (
      <select value={String(value)} onChange={(event) => onChange(event.target.value)}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  return (
    <input
      type={field.type === "integer" || field.type === "number" ? "number" : "text"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function PreviewTable({ columns, rows }) {
  if (!rows.length) {
    return <div className="empty-state tall">运行工作流后，这里会显示解析后的 JSON 表格预览。</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.name}>
                {column.name}
                <span>{column.type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.name}>{formatCell(row[column.name])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryList({ entries, activeId, onSelect }) {
  if (!entries.length) {
    return <div className="history-empty">暂无历史记录。运行工作流后，最近 20 条内容会自动保存在本地。</div>;
  }

  return (
    <div className="history-block">
      <div className="history-title">最近 20 条生成内容</div>
      <div className="history-list">
        {entries.map((entry) => (
          <button
            key={entry.id}
            className={entry.id === activeId ? "history-item active" : "history-item"}
            onClick={() => onSelect(entry)}
          >
            <span className="history-label">{formatHistoryLabel(entry)}</span>
            <span className="history-meta">
              {entry.result?.parsed?.rowCount ?? 0} 条 · {entry.larkResult ? "已生成 Base" : "待生成"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LogTable({ logs }) {
  if (!logs.length) return <div className="empty-state">暂无日志。</div>;

  return (
    <div className="log-table">
      {logs.map((log, index) => (
        <div className="log-row" key={`${log.time}-${index}`}>
          <span>{log.time}</span>
          <strong className={log.level.toLowerCase()}>{log.level}</strong>
          <span>{log.source}</span>
          <p>{log.message}</p>
        </div>
      ))}
    </div>
  );
}

function ResultLine({ label, value }) {
  return (
    <div className="result-line">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);
  return handleResponse(response);
}

async function apiPost(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleResponse(response);
}

async function handleResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  }
  return data;
}

function renderTemplate(template) {
  const date = new Date()
    .toLocaleString("zh-CN", { hour12: false })
    .replace(/\//g, "-");
  return String(template || "Dify 工作流结果 {date}").replaceAll("{date}", date);
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatHistoryLabel(entry) {
  const createdAt = entry?.createdAt ? new Date(entry.createdAt) : null;
  const timeLabel = createdAt
    ? createdAt.toLocaleString("zh-CN", { hour12: false })
    : "未知时间";
  const rowCount = entry?.result?.parsed?.rowCount ?? 0;
  return `${timeLabel} · ${rowCount} 行`;
}

function createHistoryEntry({ inputs, result, baseName, tableName }) {
  return {
    id: createHistoryId(),
    createdAt: Date.now(),
    inputs: structuredCloneSafe(inputs),
    result: structuredCloneSafe(result),
    baseName,
    tableName,
    larkResult: null
  };
}

function updateHistoryEntry(history, id, patch) {
  return history
    .map((entry) => (entry.id === id ? { ...entry, ...structuredCloneSafe(patch) } : entry))
    .slice(0, HISTORY_LIMIT);
}

function createHistoryId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `history-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function structuredCloneSafe(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function loadHistory() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(Boolean)
      .map((entry) => ({
        id: entry.id || createHistoryId(),
        createdAt: Number(entry.createdAt) || Date.now(),
        inputs: entry.inputs || {},
        result: entry.result || null,
        baseName: entry.baseName || "",
        tableName: entry.tableName || "",
        larkResult: entry.larkResult || null
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function persistHistory(history) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  } catch {
    // Ignore storage quota or privacy mode failures.
  }
}

createRoot(document.getElementById("root")).render(<App />);
