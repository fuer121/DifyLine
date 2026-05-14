const MAX_FIELD_NAME_LENGTH = 100;

export function parseWorkflowOutput(rawOutput) {
  const value = parseJsonIfNeeded(rawOutput);
  const records = extractRecords(value);
  const normalizedRecords = records.map((record) => normalizeRecord(record));
  const columns = inferColumns(normalizedRecords);

  return {
    value,
    records: normalizedRecords,
    columns,
    rowCount: normalizedRecords.length,
    previewRows: normalizedRecords.slice(0, 100)
  };
}

export function parseJsonIfNeeded(rawOutput) {
  if (typeof rawOutput !== "string") return rawOutput;

  const trimmed = rawOutput.trim();
  if (!trimmed) {
    const error = new Error("Dify 输出为空，无法解析为 JSON。");
    error.status = 422;
    throw error;
  }

  try {
    return JSON.parse(trimmed);
  } catch (firstError) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // Keep the original parse error for clearer user feedback.
      }
    }

    const error = new Error("Dify 输出不是有效 JSON，无法生成多维表格。");
    error.status = 422;
    error.details = { parseError: firstError.message };
    throw error;
  }
}

export function extractRecords(value) {
  if (Array.isArray(value)) return value;

  if (isPlainObject(value)) {
    const firstArray = Object.values(value).find((item) => Array.isArray(item));
    if (firstArray) return firstArray;
    return [value];
  }

  const error = new Error("Dify JSON 输出必须是对象或数组。");
  error.status = 422;
  throw error;
}

function normalizeRecord(record) {
  if (isPlainObject(record)) {
    const normalized = {};
    for (const [key, value] of Object.entries(record)) {
      normalized[uniqueFieldName(sanitizeFieldName(key), normalized)] = value;
    }
    return normalized;
  }
  return { value: record };
}

export function inferColumns(records) {
  const seen = new Map();

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const name = sanitizeFieldName(key);
      const current = seen.get(name);
      const nextType = inferLarkFieldType(value);

      if (!current) {
        seen.set(name, { name, type: nextType });
      } else if (current.type !== nextType) {
        current.type = mergeFieldType(current.type, nextType);
      }
    }
  }

  if (seen.size === 0) {
    seen.set("value", { name: "value", type: "text" });
  }

  return Array.from(seen.values());
}

export function inferLarkFieldType(value) {
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "checkbox";
  return "text";
}

function mergeFieldType(left, right) {
  if (left === right) return left;
  if (left === "text" || right === "text") return "text";
  return "text";
}

export function toLarkCellValue(value, fieldType) {
  if (value === undefined) return null;
  if (value === null) return null;

  if (fieldType === "number") {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  if (fieldType === "checkbox") {
    return typeof value === "boolean" ? value : Boolean(value);
  }

  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

export function buildBatchPayload(records, columns) {
  const fields = columns.map((column) => column.name);
  const rows = records.map((record) =>
    columns.map((column) => toLarkCellValue(record[column.name], column.type))
  );

  return { fields, rows };
}

export function chunkRows(rows, size = 200) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function sanitizeFieldName(name) {
  const value = String(name || "value").trim() || "value";
  return value.slice(0, MAX_FIELD_NAME_LENGTH);
}

function uniqueFieldName(name, record) {
  if (!Object.prototype.hasOwnProperty.call(record, name)) return name;

  let index = 2;
  while (Object.prototype.hasOwnProperty.call(record, `${name}_${index}`)) {
    index += 1;
  }
  return `${name}_${index}`;
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}
