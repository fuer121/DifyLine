import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBatchPayload,
  chunkRows,
  inferColumns,
  parseWorkflowOutput,
  toLarkCellValue
} from "./mapper.js";

test("parses array output into records and inferred columns", () => {
  const parsed = parseWorkflowOutput(
    JSON.stringify([
      { name: "林默", chapter: 1, active: true },
      { name: "苏晴", chapter: 2, active: false }
    ])
  );

  assert.equal(parsed.rowCount, 2);
  assert.deepEqual(parsed.columns, [
    { name: "name", type: "text" },
    { name: "chapter", type: "number" },
    { name: "active", type: "checkbox" }
  ]);
});

test("uses first array field from object output", () => {
  const parsed = parseWorkflowOutput({
    meta: { total: 1 },
    roles: [{ id: "char_001", profile: { role: "主角" } }]
  });

  assert.equal(parsed.rowCount, 1);
  assert.equal(parsed.records[0].id, "char_001");
  assert.equal(toLarkCellValue(parsed.records[0].profile, "text"), '{\n  "role": "主角"\n}');
});

test("wraps ordinary object as a single row", () => {
  const parsed = parseWorkflowOutput({ title: "结果", score: 98 });
  assert.equal(parsed.rowCount, 1);
  assert.deepEqual(parsed.columns, [
    { name: "title", type: "text" },
    { name: "score", type: "number" }
  ]);
});

test("builds lark batch payload and chunks rows", () => {
  const records = [
    { a: "x", b: 1 },
    { a: "y", b: 2 }
  ];
  const columns = inferColumns(records);
  assert.deepEqual(buildBatchPayload(records, columns), {
    fields: ["a", "b"],
    rows: [
      ["x", 1],
      ["y", 2]
    ]
  });
  assert.equal(chunkRows(new Array(401).fill([]), 200).length, 3);
});

test("rejects non-json string output", () => {
  assert.throws(() => parseWorkflowOutput("不是 JSON"), /不是有效 JSON/);
});

