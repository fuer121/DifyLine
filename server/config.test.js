import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createWorkflow,
  deleteWorkflow,
  loadPublicConfig,
  loadWorkflows,
  updateWorkflow
} from "./config.js";

test("falls back to legacy app config without leaking api key", async () => {
  await withTempWorkflowStore(async () => {
    process.env.DIFY_API_BASE = "https://dify.example.com/v1";
    process.env.DIFY_API_KEY = "app-secret";

    const config = await loadPublicConfig();

    assert.equal(config.workflows.length, 1);
    assert.equal(config.workflows[0].id, "default");
    assert.equal(config.workflows[0].apiKeyConfigured, true);
    assert.equal(Object.hasOwn(config.workflows[0], "apiKey"), false);
    assert.equal(config.runtime.difyConfigured, true);
  });
});

test("creates, updates, preserves api key, and deletes workflows", async () => {
  await withTempWorkflowStore(async (storePath) => {
    process.env.DIFY_API_BASE = "https://dify.example.com/v1";
    process.env.DIFY_API_KEY = "";

    const created = await createWorkflow({
      name: "角色抽取",
      apiKey: "app-created",
      fields: [{ name: "book_id", type: "string", required: true }],
      outputField: "items",
      baseNameTemplate: "角色 {date}",
      tableName: "角色表",
      difyUser: "local-user",
      enabled: true
    });

    assert.equal(created.apiKeyConfigured, true);
    assert.equal(Object.hasOwn(created, "apiKey"), false);

    const updated = await updateWorkflow(created.id, {
      name: "角色抽取 v2",
      apiKey: "",
      fields: [{ name: "chapter", type: "integer", required: true, defaultValue: 1 }]
    });

    const secretWorkflow = (await loadWorkflows({ includeSecrets: true }))
      .find((workflow) => workflow.id === created.id);
    assert.equal(updated.name, "角色抽取 v2");
    assert.equal(secretWorkflow.apiKey, "app-created");
    assert.equal(secretWorkflow.fields[0].type, "integer");

    await deleteWorkflow(created.id);
    const raw = JSON.parse(await fs.readFile(storePath, "utf8"));
    assert.equal(raw.workflows.some((workflow) => workflow.id === created.id), false);
    assert.equal(raw.workflows.some((workflow) => workflow.id === "default"), true);
  });
});

async function withTempWorkflowStore(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dify-workflows-"));
  const storePath = path.join(directory, "workflows.local.json");
  const previousPath = process.env.WORKFLOWS_CONFIG_PATH;
  const previousBase = process.env.DIFY_API_BASE;
  const previousKey = process.env.DIFY_API_KEY;
  process.env.WORKFLOWS_CONFIG_PATH = storePath;

  try {
    await callback(storePath);
  } finally {
    if (previousPath === undefined) {
      delete process.env.WORKFLOWS_CONFIG_PATH;
    } else {
      process.env.WORKFLOWS_CONFIG_PATH = previousPath;
    }
    if (previousBase === undefined) {
      delete process.env.DIFY_API_BASE;
    } else {
      process.env.DIFY_API_BASE = previousBase;
    }
    if (previousKey === undefined) {
      delete process.env.DIFY_API_KEY;
    } else {
      process.env.DIFY_API_KEY = previousKey;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}
