import { getDifyConfig } from "./config.js";
import { parseWorkflowOutput } from "./mapper.js";

export function coerceInputs(fields, values) {
  const inputs = {};
  const missing = [];

  for (const field of fields) {
    const rawValue = values?.[field.name];
    const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "";

    if (field.required && !hasValue) {
      missing.push(field.name);
      continue;
    }

    if (!hasValue) continue;
    inputs[field.name] = coerceValue(rawValue, field.type);
  }

  if (missing.length > 0) {
    const error = new Error(`缺少必填输入：${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }

  return inputs;
}

function coerceValue(value, type) {
  if (type === "integer") {
    const number = Number.parseInt(value, 10);
    return Number.isNaN(number) ? value : number;
  }

  if (type === "number") {
    const number = Number(value);
    return Number.isNaN(number) ? value : number;
  }

  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes", "on", "是"].includes(String(value).toLowerCase());
  }

  return value;
}

export async function runDifyWorkflow({ inputs, outputField, user }) {
  const { base, key } = getDifyConfig();
  const response = await fetch(`${base}/workflows/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputs,
      response_mode: "blocking",
      user
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(safeDifyMessage(data) || `Dify 调用失败：HTTP ${response.status}`);
    error.status = response.status;
    error.details = stripSecrets(data);
    throw error;
  }

  const outputs = data?.data?.outputs || {};
  if (!Object.prototype.hasOwnProperty.call(outputs, outputField)) {
    const error = new Error(`Dify 返回中没有 data.outputs.${outputField}`);
    error.status = 502;
    error.details = { outputKeys: Object.keys(outputs) };
    throw error;
  }

  const rawOutput = outputs[outputField];
  const parsed = parseWorkflowOutput(rawOutput);

  return {
    workflowRunId: data?.workflow_run_id || data?.data?.id || null,
    taskId: data?.task_id || null,
    outputField,
    rawOutput,
    parsed,
    outputs
  };
}

function safeDifyMessage(data) {
  return data?.message || data?.error || data?.code;
}

function stripSecrets(value) {
  const text = JSON.stringify(value || {});
  return JSON.parse(text.replace(/(app-|sk-)[A-Za-z0-9_-]+/g, "$1***"));
}

