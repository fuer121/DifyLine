import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, "..");

async function readJson(relativePath, fallback) {
  try {
    const content = await fs.readFile(path.join(rootDir, relativePath), "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

export async function loadPublicConfig() {
  const fields = await readJson("config/workflow-fields.json", []);
  const app = await readJson("config/app.json", {});

  return {
    fields,
    app: {
      outputField: app.outputField || "result",
      larkIdentity: app.larkIdentity || "bot",
      baseNameTemplate: app.baseNameTemplate || "Dify 工作流结果 {date}",
      tableName: app.tableName || "结果表",
      difyUser: app.difyUser || "local-web-user",
      requiredLarkScopes: app.requiredLarkScopes || [
        "base:app:create",
        "base:table:create",
        "base:record:create"
      ]
    },
    runtime: {
      difyConfigured: Boolean(process.env.DIFY_API_BASE && process.env.DIFY_API_KEY),
      difyBase: maskUrl(process.env.DIFY_API_BASE || ""),
      larkCli: "lark-cli"
    }
  };
}

export function getDifyConfig() {
  const base = process.env.DIFY_API_BASE;
  const key = process.env.DIFY_API_KEY;

  if (!base || !key) {
    const error = new Error("Dify API 未配置，请在 .env 中设置 DIFY_API_BASE 和 DIFY_API_KEY。");
    error.status = 500;
    throw error;
  }

  return {
    base: base.replace(/\/+$/, ""),
    key
  };
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
