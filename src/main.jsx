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
  Settings,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react";
import "./styles.css";

const API_BASE = "";
const HISTORY_KEY = "dify.workflow.history.v2";
const LEGACY_HISTORY_KEY = "dify.workflow.history.v1";
const ACTIVE_WORKFLOW_KEY = "dify.workflow.active.v1";
const HISTORY_LIMIT = 20;
const FIELD_TYPES = ["string", "integer", "number", "boolean"];

function App() {
  const [config, setConfig] = useState(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState(() => loadActiveWorkflowId());
  const [inputs, setInputs] = useState({});
  const [result, setResult] = useState(null);
  const [larkResult, setLarkResult] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [activeHistoryId, setActiveHistoryId] = useState("");
  const [baseName, setBaseName] = useState("");
  const [tableName, setTableName] = useState("");
  const [running, setRunning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerBusy, setManagerBusy] = useState(false);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    persistHistory(history);
  }, [history]);

  useEffect(() => {
    persistActiveWorkflowId(activeWorkflowId);
  }, [activeWorkflowId]);

  const workflows = config?.workflows || [];
  const enabledWorkflows = workflows.filter((workflow) => workflow.enabled);
  const activeWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === activeWorkflowId) || enabledWorkflows[0] || workflows[0] || null,
    [workflows, enabledWorkflows, activeWorkflowId]
  );
  const workflowHistory = useMemo(
    () => history.filter((entry) => entry.workflowId === activeWorkflow?.id).slice(0, HISTORY_LIMIT),
    [history, activeWorkflow]
  );
  const preview = useMemo(() => result?.parsed?.previewRows || [], [result]);
  const columns = useMemo(() => result?.parsed?.columns || [], [result]);
  const isBusy = running || creating || managerBusy;
  const canRun = Boolean(activeWorkflow?.enabled && activeWorkflow?.apiKeyConfigured && config?.runtime?.difyBase);

  async function loadConfig(options = {}) {
    try {
      const data = await apiGet("/api/config");
      const nextWorkflows = data.workflows || [];
      const nextWorkflowId = resolveWorkflowId(
        options.workflowId || activeWorkflowId,
        nextWorkflows
      );

      setConfig(data);
      setActiveWorkflowId(nextWorkflowId);
      applyWorkflowContext(nextWorkflowId, nextWorkflows, history);
      addLog("INFO", "System", "配置加载完成");
    } catch (loadError) {
      setError(loadError.message);
      addLog("ERROR", "System", loadError.message);
    }
  }

  function applyWorkflowContext(workflowId, nextWorkflows = workflows, nextHistory = history) {
    const workflow = nextWorkflows.find((item) => item.id === workflowId);
    if (!workflow) {
      setInputs({});
      setResult(null);
      setLarkResult(null);
      setBaseName("");
      setTableName("");
      setActiveHistoryId("");
      return;
    }

    const latest = nextHistory
      .filter((entry) => entry.workflowId === workflow.id)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (latest) {
      setInputs({ ...defaultsFromFields(workflow.fields), ...(latest.inputs || {}) });
      setResult(latest.result || null);
      setLarkResult(latest.larkResult || null);
      setBaseName(latest.baseName || renderTemplate(workflow.baseNameTemplate));
      setTableName(latest.tableName || workflow.tableName);
      setActiveHistoryId(latest.id);
      return;
    }

    setInputs(defaultsFromFields(workflow.fields));
    setResult(null);
    setLarkResult(null);
    setBaseName(renderTemplate(workflow.baseNameTemplate));
    setTableName(workflow.tableName);
    setActiveHistoryId("");
  }

  function selectWorkflow(workflowId) {
    if (isBusy || workflowId === activeWorkflowId) return;
    setError("");
    setActiveWorkflowId(workflowId);
    applyWorkflowContext(workflowId);
    const workflow = workflows.find((item) => item.id === workflowId);
    addLog("INFO", "System", `已切换工作流：${workflow?.name || workflowId}`);
  }

  async function runWorkflow() {
    if (!activeWorkflow) return;
    setRunning(true);
    setError("");
    setLarkResult(null);
    addLog("INFO", "Dify", `开始运行工作流：${activeWorkflow.name}`);

    try {
      const data = await apiPost("/api/workflow/run", {
        workflowId: activeWorkflow.id,
        inputs
      });
      const entry = createHistoryEntry({
        workflow: activeWorkflow,
        inputs,
        result: data,
        baseName,
        tableName
      });
      setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, HISTORY_LIMIT * 5));
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
    if (!result?.parsed || !activeWorkflow) return;
    setCreating(true);
    setError("");
    addLog("INFO", "lark-cli", `开始创建飞书多维表格：${baseName}`);

    try {
      const data = await apiPost("/api/lark/base/create", {
        workflowId: activeWorkflow.id,
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
    if (!entry || !activeWorkflow) return;
    setInputs({ ...defaultsFromFields(activeWorkflow.fields), ...(entry.inputs || {}) });
    setResult(entry.result || null);
    setLarkResult(entry.larkResult || null);
    setBaseName(entry.baseName || renderTemplate(activeWorkflow.baseNameTemplate));
    setTableName(entry.tableName || activeWorkflow.tableName);
    setActiveHistoryId(entry.id);
    setError("");
    addLog("INFO", "System", `已恢复历史结果：${formatHistoryLabel(entry)}`);
  }

  async function saveWorkflow(payload) {
    setManagerBusy(true);
    setError("");
    try {
      const saved = payload.id
        ? await apiPut(`/api/workflows/${encodeURIComponent(payload.id)}`, payload)
        : await apiPost("/api/workflows", payload);
      await loadConfig({ workflowId: saved.workflow.id });
      addLog("INFO", "System", `工作流已保存：${saved.workflow.name}`);
    } catch (saveError) {
      setError(saveError.message);
      addLog("ERROR", "System", saveError.message);
      throw saveError;
    } finally {
      setManagerBusy(false);
    }
  }

  async function removeWorkflow(workflowId) {
    setManagerBusy(true);
    setError("");
    try {
      await apiDelete(`/api/workflows/${encodeURIComponent(workflowId)}`);
      const remaining = workflows.filter((workflow) => workflow.id !== workflowId);
      const nextId = resolveWorkflowId(activeWorkflowId === workflowId ? "" : activeWorkflowId, remaining);
      await loadConfig({ workflowId: nextId });
      addLog("INFO", "System", "工作流已删除");
    } catch (deleteError) {
      setError(deleteError.message);
      addLog("ERROR", "System", deleteError.message);
      throw deleteError;
    } finally {
      setManagerBusy(false);
    }
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
            <p>{activeWorkflow ? `当前工作流：${activeWorkflow.name}` : "请先创建一个可用工作流"}</p>
          </div>
        </div>
        <div className="top-actions">
          <label className="workflow-switcher">
            <span>工作流</span>
            <select
              value={activeWorkflow?.id || ""}
              onChange={(event) => selectWorkflow(event.target.value)}
              disabled={isBusy || workflows.length === 0}
            >
              {workflows.length ? null : <option value="">暂无工作流</option>}
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id} disabled={!workflow.enabled}>
                  {workflow.name}{workflow.enabled ? "" : "（停用）"}
                </option>
              ))}
            </select>
          </label>
          <GhostButton
            icon={Settings}
            label="管理工作流"
            onClick={() => setManagerOpen(true)}
            disabled={isBusy}
          />
          <div className="status-strip">
            <Status ok={Boolean(config.runtime.difyBase)} label="Dify Base" value={config.runtime.difyBase || "未配置"} />
            <Status ok={Boolean(activeWorkflow?.apiKeyConfigured)} label="API Key" value={activeWorkflow?.apiKeyConfigured ? "已配置" : "未配置"} />
            <Status ok label="lark-cli" value={`--as ${config.app.larkIdentity}`} />
          </div>
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

      {!activeWorkflow ? (
        <section className="empty-state no-workflow">
          暂无可用工作流。点击“管理工作流”创建后即可运行 Dify。
        </section>
      ) : null}

      <section className="workspace">
        <aside className="left-rail">
          <Panel
            index="1"
            title="工作流输入配置"
            description="字段来自当前工作流配置，提交时会映射为 Dify inputs。"
            action={<GhostButton icon={RefreshCcw} label="重载配置" onClick={() => loadConfig()} disabled={isBusy} />}
          >
            {activeWorkflow ? (
              <div className="field-list">
                <div className="field-head">
                  <span>字段名</span>
                  <span>类型</span>
                  <span>必填</span>
                  <span>值</span>
                </div>
                {activeWorkflow.fields.map((field) => (
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
            ) : (
              <div className="empty-state">请先创建工作流。</div>
            )}
          </Panel>

          <Panel
            index="2"
            title="运行工作流"
            description={`使用 blocking 模式等待 Dify 完成，再解析 outputs.${activeWorkflow?.outputField || "result"}。`}
            action={<GhostButton icon={Trash2} label="清空结果" onClick={resetResult} disabled={!result || isBusy} />}
          >
            <button className="primary-run" onClick={runWorkflow} disabled={running || !canRun}>
              {running ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              {running ? "运行中..." : "运行工作流"}
            </button>
            {!canRun ? (
              <div className="inline-hint">需要配置全局 Dify Base 和当前工作流 API Key 后才能运行。</div>
            ) : null}
          </Panel>
        </aside>

        <section className="right-rail">
          <Panel
            index="3"
            title="输出预览"
            description="解析后的 JSON 数据，最多展示前 100 条；历史按工作流隔离。"
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
              entries={workflowHistory}
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
                  <input value={baseName} onChange={(event) => setBaseName(event.target.value)} disabled={!activeWorkflow} />
                </label>
                <label>
                  <span>数据表名称</span>
                  <input value={tableName} onChange={(event) => setTableName(event.target.value)} disabled={!activeWorkflow} />
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

      {managerOpen ? (
        <WorkflowManager
          workflows={workflows}
          activeWorkflowId={activeWorkflow?.id || ""}
          busy={managerBusy}
          onClose={() => setManagerOpen(false)}
          onSave={saveWorkflow}
          onDelete={removeWorkflow}
        />
      ) : null}
    </main>
  );
}

function WorkflowManager({ workflows, activeWorkflowId, busy, onClose, onSave, onDelete }) {
  const [editingId, setEditingId] = useState(activeWorkflowId || workflows[0]?.id || "");
  const editingWorkflow = workflows.find((workflow) => workflow.id === editingId) || null;
  const [form, setForm] = useState(() => workflowToForm(editingWorkflow));
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setForm(workflowToForm(editingWorkflow));
    setFormError("");
  }, [editingId]);

  function updateField(index, patch) {
    setForm((current) => ({
      ...current,
      fields: current.fields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field
      )
    }));
  }

  function addField() {
    setForm((current) => ({
      ...current,
      fields: [
        ...current.fields,
        {
          name: `field_${current.fields.length + 1}`,
          label: `field_${current.fields.length + 1}`,
          type: "string",
          required: true,
          defaultValue: ""
        }
      ]
    }));
  }

  function removeField(index) {
    setForm((current) => ({
      ...current,
      fields: current.fields.filter((_, fieldIndex) => fieldIndex !== index)
    }));
  }

  async function submitForm(event) {
    event.preventDefault();
    setFormError("");
    try {
      await onSave(cleanWorkflowPayload(form));
      onClose();
    } catch (error) {
      setFormError(error.message);
    }
  }

  async function deleteCurrentWorkflow() {
    if (!form.id) return;
    const confirmed = window.confirm(`确认删除工作流“${form.name}”？`);
    if (!confirmed) return;
    try {
      await onDelete(form.id);
      onClose();
    } catch (error) {
      setFormError(error.message);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="workflow-modal" role="dialog" aria-modal="true" aria-label="管理工作流">
        <div className="modal-head">
          <div>
            <h2>管理工作流</h2>
            <p>配置会保存到本地私有文件，API Key 不会在读取时回显。</p>
          </div>
          <button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="workflow-manager-grid">
          <aside className="workflow-list-panel">
            <button className={!form.id ? "workflow-list-item active" : "workflow-list-item"} onClick={() => setEditingId("")} disabled={busy}>
              <strong>新建工作流</strong>
              <span>创建一组新的 Dify 配置</span>
            </button>
            {workflows.map((workflow) => (
              <button
                key={workflow.id}
                className={workflow.id === form.id ? "workflow-list-item active" : "workflow-list-item"}
                onClick={() => setEditingId(workflow.id)}
                disabled={busy}
              >
                <strong>{workflow.name}</strong>
                <span>{workflow.apiKeyConfigured ? "API Key 已配置" : "API Key 未配置"}</span>
              </button>
            ))}
          </aside>

          <form className="workflow-form" onSubmit={submitForm}>
            {formError ? (
              <div className="form-error">
                <TriangleAlert size={16} />
                <span>{formError}</span>
              </div>
            ) : null}

            <div className="form-two-col">
              <label>
                <span>工作流名称</span>
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
              <label>
                <span>状态</span>
                <select value={String(form.enabled)} onChange={(event) => setForm({ ...form, enabled: event.target.value === "true" })}>
                  <option value="true">启用</option>
                  <option value="false">停用</option>
                </select>
              </label>
            </div>

            <label>
              <span>描述</span>
              <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>

            <div className="form-two-col">
              <label>
                <span>API Key {form.id && form.apiKeyConfigured ? "（留空则保留现有 Key）" : ""}</span>
                <input
                  type="password"
                  value={form.apiKey}
                  placeholder={form.id && form.apiKeyConfigured ? "已配置，输入新值可替换" : "app-..."}
                  onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                />
              </label>
              <label>
                <span>Dify user</span>
                <input value={form.difyUser} onChange={(event) => setForm({ ...form, difyUser: event.target.value })} />
              </label>
            </div>

            <div className="form-three-col">
              <label>
                <span>输出字段</span>
                <input value={form.outputField} onChange={(event) => setForm({ ...form, outputField: event.target.value })} />
              </label>
              <label>
                <span>Base 名称模板</span>
                <input value={form.baseNameTemplate} onChange={(event) => setForm({ ...form, baseNameTemplate: event.target.value })} />
              </label>
              <label>
                <span>数据表名称</span>
                <input value={form.tableName} onChange={(event) => setForm({ ...form, tableName: event.target.value })} />
              </label>
            </div>

            <div className="field-builder-head">
              <div>
                <strong>输入字段</strong>
                <span>这些字段会提交到 Dify inputs。</span>
              </div>
              <GhostButton icon={Plus} label="添加字段" onClick={addField} disabled={busy} />
            </div>

            <div className="field-builder">
              {form.fields.map((field, index) => (
                <div className="field-builder-row" key={`${field.name}-${index}`}>
                  <input value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} placeholder="name" />
                  <input value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} placeholder="label" />
                  <select value={field.type} onChange={(event) => updateField(index, { type: event.target.value })}>
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  <select value={String(field.required)} onChange={(event) => updateField(index, { required: event.target.value === "true" })}>
                    <option value="true">必填</option>
                    <option value="false">选填</option>
                  </select>
                  <input
                    value={field.defaultValue}
                    onChange={(event) => updateField(index, { defaultValue: event.target.value })}
                    placeholder="default"
                  />
                  <button className="icon-button" type="button" onClick={() => removeField(index)} disabled={busy || form.fields.length <= 1} aria-label="删除字段">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              {form.id ? (
                <button className="danger-button" type="button" onClick={deleteCurrentWorkflow} disabled={busy}>
                  删除工作流
                </button>
              ) : <span />}
              <div className="modal-action-group">
                <button className="ghost-button" type="button" onClick={onClose} disabled={busy}>取消</button>
                <button className="primary-small" type="submit" disabled={busy}>
                  {busy ? <Loader2 className="spin" size={16} /> : null}
                  保存工作流
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>
    </div>
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
    <button className="ghost-button" type="button" onClick={onClick} disabled={disabled}>
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
    return <div className="history-empty">当前工作流暂无历史记录。运行后，最近 20 条内容会自动保存在本地。</div>;
  }

  return (
    <div className="history-block">
      <div className="history-title">当前工作流最近 20 条生成内容</div>
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

async function apiPut(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleResponse(response);
}

async function apiDelete(path) {
  const response = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
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

function createHistoryEntry({ workflow, inputs, result, baseName, tableName }) {
  return {
    id: createHistoryId(),
    workflowId: workflow.id,
    workflowName: workflow.name,
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
    .slice(0, HISTORY_LIMIT * 5);
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

function defaultsFromFields(fields = []) {
  return Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? ""]));
}

function workflowToForm(workflow) {
  if (!workflow) {
    return {
      id: "",
      name: "",
      description: "",
      apiKey: "",
      apiKeyConfigured: false,
      fields: [
        {
          name: "book_id",
          label: "book_id",
          type: "string",
          required: true,
          defaultValue: ""
        }
      ],
      outputField: "result",
      baseNameTemplate: "Dify 工作流结果 {date}",
      tableName: "结果表",
      difyUser: "local-web-user",
      enabled: true
    };
  }

  return {
    ...workflow,
    apiKey: "",
    fields: workflow.fields.map((field) => ({ ...field, defaultValue: field.defaultValue ?? "" }))
  };
}

function cleanWorkflowPayload(form) {
  return {
    id: form.id || undefined,
    name: form.name.trim(),
    description: form.description,
    apiKey: form.apiKey.trim(),
    fields: form.fields.map((field) => ({
      name: field.name.trim(),
      label: field.label.trim() || field.name.trim(),
      type: field.type,
      required: Boolean(field.required),
      defaultValue: coerceDefaultValue(field.defaultValue, field.type)
    })),
    outputField: form.outputField.trim() || "result",
    baseNameTemplate: form.baseNameTemplate || "Dify 工作流结果 {date}",
    tableName: form.tableName || "结果表",
    difyUser: form.difyUser || "local-web-user",
    enabled: Boolean(form.enabled)
  };
}

function coerceDefaultValue(value, type) {
  if (type === "integer") {
    const number = Number.parseInt(value, 10);
    return Number.isNaN(number) ? value : number;
  }
  if (type === "number") {
    const number = Number(value);
    return Number.isNaN(number) ? value : number;
  }
  if (type === "boolean") return value === true || value === "true";
  return value;
}

function resolveWorkflowId(candidateId, workflows) {
  if (candidateId && workflows.some((workflow) => workflow.id === candidateId)) return candidateId;
  return workflows.find((workflow) => workflow.enabled)?.id || workflows[0]?.id || "";
}

function loadHistory() {
  if (typeof window === "undefined") return [];
  const current = readHistoryStorage(HISTORY_KEY, false);
  if (current.length) return current;
  return readHistoryStorage(LEGACY_HISTORY_KEY, true);
}

function readHistoryStorage(key, legacy) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(Boolean)
      .map((entry) => ({
        id: entry.id || createHistoryId(),
        workflowId: entry.workflowId || "default",
        workflowName: entry.workflowName || "默认工作流",
        createdAt: Number(entry.createdAt) || Date.now(),
        inputs: entry.inputs || {},
        result: entry.result || null,
        baseName: entry.baseName || "",
        tableName: entry.tableName || "",
        larkResult: entry.larkResult || null,
        legacy
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, HISTORY_LIMIT * 5);
  } catch {
    return [];
  }
}

function persistHistory(history) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT * 5)));
  } catch {
    // Ignore storage quota or privacy mode failures.
  }
}

function loadActiveWorkflowId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ACTIVE_WORKFLOW_KEY) || "";
}

function persistActiveWorkflowId(workflowId) {
  if (typeof window === "undefined") return;
  if (workflowId) {
    window.localStorage.setItem(ACTIVE_WORKFLOW_KEY, workflowId);
  }
}

createRoot(document.getElementById("root")).render(<App />);
