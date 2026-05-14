import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildBatchPayload, chunkRows } from "./mapper.js";

const execFileAsync = promisify(execFile);

export async function createLarkBaseFromParsed({ parsed, baseName, tableName, identity = "bot" }) {
  if (!parsed?.records?.length) {
    const error = new Error("没有可写入飞书多维表格的记录。");
    error.status = 422;
    throw error;
  }

  const base = await runLarkStep("创建飞书多维表格", ["base", "+base-create", "--as", identity, "--name", baseName]);
  const baseToken = getBaseToken(base);

  if (!baseToken) {
    const error = new Error(
      `飞书 Base 创建成功但未识别到 base token。已收到字段：${summarizeKeys(base)}`
    );
    error.status = 502;
    error.details = base;
    throw error;
  }

  const table = await runLarkStep("创建数据表", [
    "base",
    "+table-create",
    "--as",
    identity,
    "--base-token",
    baseToken,
    "--name",
    tableName,
    "--fields",
    JSON.stringify(parsed.columns.map((column) => ({ name: column.name, type: column.type }))),
    "--view",
    JSON.stringify([{ name: "默认表格", type: "grid" }])
  ]);

  const tableId = getTableId(table) || tableName;
  const payload = buildBatchPayload(parsed.records, parsed.columns);
  const rowChunks = chunkRows(payload.rows, 200);
  const batches = [];

  for (const rows of rowChunks) {
    const result = await runLarkStep("批量写入记录", [
      "base",
      "+record-batch-create",
      "--as",
      identity,
      "--base-token",
      baseToken,
      "--table-id",
      tableId,
      "--json",
      JSON.stringify({ fields: payload.fields, rows })
    ]);
    batches.push(result);
  }

  return {
    baseToken,
    baseUrl: getBaseUrl(base),
    permissionGrant: findFirstKey(base, ["permission_grant", "permissionGrant"]) || null,
    tableId,
    tableName,
    fieldCount: parsed.columns.length,
    recordCount: parsed.records.length,
    batchCount: batches.length,
    raw: {
      base,
      table,
      batches
    }
  };
}

async function runLarkStep(stage, args) {
  try {
    return await runLark(args);
  } catch (error) {
    error.message = `飞书${stage}失败：${error.message}`;
    throw error;
  }
}

export async function runLark(args) {
  try {
    const { stdout, stderr } = await execFileAsync("lark-cli", args, {
      maxBuffer: 1024 * 1024 * 20
    });

    if (stderr?.trim()) {
      // lark-cli may print notices to stderr; keep stdout as source of truth.
    }

    return parseJson(stdout);
  } catch (error) {
    const message = parseLarkError(error);
    const wrapped = new Error(message);
    wrapped.status = 502;
    wrapped.details = safeParse(error.stdout) || safeParse(error.stderr) || {
      code: error.code,
      signal: error.signal
    };
    throw wrapped;
  }
}

export function getBaseToken(result) {
  return findFirstKey(result, [
    "app_token",
    "base_token",
    "baseToken",
    "token",
    "appToken"
  ]);
}

export function getTableId(result) {
  return findTableIdInKnownContainers(result) || findFirstTableId(result);
}

export function getBaseUrl(result) {
  return findFirstKey(result, ["url", "base_url", "baseUrl"]);
}

function findFirstKey(value, keys) {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstKey(item, keys);
      if (found) return found;
    }
    return null;
  }

  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key];
    }
    if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) {
      return value[key];
    }
  }

  for (const item of Object.values(value)) {
    const found = findFirstKey(item, keys);
    if (found) return found;
  }

  return null;
}

function findTableIdInKnownContainers(result) {
  const candidates = [
    result?.table,
    result?.data?.table,
    result?.result?.table,
    result?.table_info,
    result?.data?.table_info
  ];

  for (const candidate of candidates) {
    const tableId = getTableIdFromObject(candidate, { allowPlainId: true });
    if (tableId) return tableId;
  }

  return null;
}

function findFirstTableId(value) {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstTableId(item);
      if (found) return found;
    }
    return null;
  }

  const direct = getTableIdFromObject(value);
  if (direct) return direct;

  for (const item of Object.values(value)) {
    const found = findFirstTableId(item);
    if (found) return found;
  }

  return null;
}

function getTableIdFromObject(value, { allowPlainId = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  for (const key of ["table_id", "tableId"]) {
    if (isTableId(value[key])) return value[key];
  }

  if (allowPlainId && isTableId(value.id)) return value.id;
  return null;
}

function isTableId(value) {
  return typeof value === "string" && value.startsWith("tbl");
}

function summarizeKeys(value) {
  const paths = [];
  collectKeys(value, "", paths);
  return paths.slice(0, 24).join(", ") || "无";
}

function collectKeys(value, prefix, paths) {
  if (!value || typeof value !== "object" || paths.length >= 24) return;
  if (Array.isArray(value)) {
    collectKeys(value[0], `${prefix}[0]`, paths);
    return;
  }

  for (const key of Object.keys(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    paths.push(next);
    collectKeys(value[key], next, paths);
    if (paths.length >= 24) return;
  }
}

function parseJson(stdout) {
  const text = stdout?.trim();
  if (!text) return {};
  return JSON.parse(text);
}

function parseLarkError(error) {
  const payload = safeParse(error.stderr) || safeParse(error.stdout);
  const message = payload?.error?.message || payload?.message || `lark-cli 调用失败：${error.message}`;
  const missingScope = message.match(/required scope\s+([a-zA-Z0-9:._-]+)/)?.[1];

  if (missingScope) {
    return `飞书应用缺少权限 ${missingScope}。请在飞书开放平台为 lark-cli 当前应用开通该 scope 后，再重新生成多维表格。原始错误：${message}`;
  }

  return message;
}

function safeParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}
