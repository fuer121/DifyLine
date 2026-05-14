import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, "..");
const DEFAULT_WORKFLOW_ID = "default";
const DEFAULT_SCOPES = [
  "base:app:create",
  "base:table:create",
  "base:record:create"
];

async function readJson(relativePath, fallback) {
  try {
    const content = await fs.readFile(path.join(rootDir, relativePath), "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadPublicConfig() {
  const app = await readJson("config/app.json", {});
  const workflows = await loadWorkflows({ includeSecrets: false });
  const defaultWorkflow = workflows[0] || makeFallbackWorkflow(app, []);

  return {
    fields: defaultWorkflow.fields,
    app: {
      larkIdentity: app.larkIdentity || "bot",
      requiredLarkScopes: app.requiredLarkScopes || DEFAULT_SCOPES
    },
    workflows,
    runtime: {
      difyConfigured: Boolean(process.env.DIFY_API_BASE && workflows.some((workflow) => workflow.apiKeyConfigured)),
      difyBase: maskUrl(process.env.DIFY_API_BASE || ""),
      larkCli: "lark-cli"
    }
  };
}

export async function loadWorkflows({ includeSecrets = false } = {}) {
  const store = await loadWorkflowStore();
  return store.workflows.map((workflow) =>
    includeSecrets ? workflow : sanitizeWorkflow(workflow)
  );
}

export async function getWorkflowById(workflowId) {
  const workflows = await loadWorkflows({ includeSecrets: true });
  const workflow = workflowId
    ? workflows.find((item) => item.id === workflowId)
    : workflows.find((item) => item.enabled) || workflows[0];

  if (!workflow) {
    const error = new Error("未配置可用的 Dify 工作流。");
    error.status = 404;
    throw error;
  }

  if (!workflow.enabled) {
    const error = new Error(`工作流已停用：${workflow.name}`);
    error.status = 400;
    throw error;
  }

  return workflow;
}

export async function createWorkflow(payload) {
  const store = await loadWorkflowStore();
  const workflow = normalizeWorkflow(
    {
      ...payload,
      id: createWorkflowId(payload?.name, store.workflows.map((item) => item.id))
    },
    {},
    { requireApiKey: true }
  );

  store.workflows.push(workflow);
  await saveWorkflowStore(store);
  return sanitizeWorkflow(workflow);
}

export async function updateWorkflow(workflowId, payload) {
  const store = await loadWorkflowStore();
  const index = store.workflows.findIndex((workflow) => workflow.id === workflowId);
  if (index === -1) {
    const error = new Error("工作流不存在。");
    error.status = 404;
    throw error;
  }

  const previous = store.workflows[index];
  const nextPayload = {
    ...previous,
    ...payload,
    id: previous.id,
    apiKey: payload?.apiKey ? payload.apiKey : previous.apiKey
  };
  store.workflows[index] = normalizeWorkflow(nextPayload, previous, {
    requireApiKey: true
  });

  await saveWorkflowStore(store);
  return sanitizeWorkflow(store.workflows[index]);
}

export async function deleteWorkflow(workflowId) {
  const store = await loadWorkflowStore();
  const nextWorkflows = store.workflows.filter((workflow) => workflow.id !== workflowId);
  if (nextWorkflows.length === store.workflows.length) {
    const error = new Error("工作流不存在。");
    error.status = 404;
    throw error;
  }

  store.workflows = nextWorkflows;
  await saveWorkflowStore(store);
  return { deletedId: workflowId };
}

export function getDifyConfig(apiKey) {
  const base = process.env.DIFY_API_BASE;
  const key = apiKey || process.env.DIFY_API_KEY;

  if (!base || !key) {
    const error = new Error("Dify API 未配置，请设置 DIFY_API_BASE 并为当前工作流配置 API Key。");
    error.status = 500;
    throw error;
  }

  return {
    base: base.replace(/\/+$/, ""),
    key
  };
}

async function loadWorkflowStore() {
  const app = await readJson("config/app.json", {});
  const fields = await readJson("config/workflow-fields.json", []);
  const fallback = { workflows: [makeFallbackWorkflow(app, fields)] };
  const raw = await readJsonFile(getWorkflowStorePath(), fallback);
  const workflows = Array.isArray(raw) ? raw : raw?.workflows;

  return {
    workflows: Array.isArray(workflows)
      ? workflows.map((workflow) => normalizeWorkflow(workflow, fallback.workflows[0]))
      : fallback.workflows
  };
}

async function saveWorkflowStore(store) {
  await writeJsonFile(getWorkflowStorePath(), {
    workflows: store.workflows.map((workflow) => normalizeWorkflow(workflow))
  });
}

function getWorkflowStorePath() {
  return process.env.WORKFLOWS_CONFIG_PATH || path.join(rootDir, "config", "workflows.local.json");
}

function makeFallbackWorkflow(app, fields) {
  return normalizeWorkflow({
    id: DEFAULT_WORKFLOW_ID,
    name: "默认工作流",
    description: "从旧版 config/app.json 和 config/workflow-fields.json 自动生成",
    apiKey: process.env.DIFY_API_KEY || "",
    fields,
    outputField: app.outputField || "result",
    baseNameTemplate: app.baseNameTemplate || "Dify 工作流结果 {date}",
    tableName: app.tableName || "结果表",
    difyUser: app.difyUser || "local-web-user",
    enabled: true
  });
}

function normalizeWorkflow(workflow, fallback = {}, options = {}) {
  const name = String(workflow?.name || fallback.name || "").trim();
  if (!name) {
    const error = new Error("工作流名称不能为空。");
    error.status = 400;
    throw error;
  }

  const fields = Array.isArray(workflow?.fields) ? workflow.fields : fallback.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    const error = new Error("工作流至少需要配置一个输入字段。");
    error.status = 400;
    throw error;
  }

  const apiKey = String(workflow?.apiKey ?? fallback.apiKey ?? "").trim();
  if (options.requireApiKey && !apiKey) {
    const error = new Error("工作流 API Key 不能为空。");
    error.status = 400;
    throw error;
  }

  return {
    id: sanitizeId(workflow?.id || fallback.id || DEFAULT_WORKFLOW_ID),
    name,
    description: String(workflow?.description ?? fallback.description ?? ""),
    apiKey,
    fields: fields.map(normalizeField),
    outputField: String(workflow?.outputField || fallback.outputField || "result").trim(),
    baseNameTemplate: String(workflow?.baseNameTemplate || fallback.baseNameTemplate || "Dify 工作流结果 {date}"),
    tableName: String(workflow?.tableName || fallback.tableName || "结果表"),
    difyUser: String(workflow?.difyUser || fallback.difyUser || "local-web-user"),
    enabled: workflow?.enabled === undefined ? fallback.enabled !== false : Boolean(workflow.enabled)
  };
}

function normalizeField(field) {
  const name = String(field?.name || "").trim();
  if (!name) {
    const error = new Error("输入字段 name 不能为空。");
    error.status = 400;
    throw error;
  }

  const type = ["string", "integer", "number", "boolean"].includes(field?.type)
    ? field.type
    : "string";

  return {
    name,
    label: String(field?.label || name),
    type,
    required: field?.required !== false,
    defaultValue: field?.defaultValue ?? ""
  };
}

function sanitizeWorkflow(workflow) {
  const { apiKey, ...safeWorkflow } = workflow;
  return {
    ...safeWorkflow,
    apiKeyConfigured: Boolean(apiKey)
  };
}

function createWorkflowId(name, existingIds) {
  const base = sanitizeId(name) || `workflow-${Date.now()}`;
  let next = base;
  let index = 2;
  while (existingIds.includes(next)) {
    next = `${base}-${index}`;
    index += 1;
  }
  return next;
}

function sanitizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function maskUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return value.replace(/(app-|sk-)[A-Za-z0-9_-]+/g, "$1***");
  }
}

export function renderTemplate(template) {
  const now = new Date();
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .format(now)
    .replace(/\//g, "-")
    .replace(/\s/g, " ");

  return String(template || "Dify 工作流结果 {date}").replaceAll("{date}", date);
}
