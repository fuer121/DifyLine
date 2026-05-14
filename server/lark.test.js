import test from "node:test";
import assert from "node:assert/strict";
import { getBaseToken, getBaseUrl, getTableId } from "./lark.js";

test("extracts base token from common lark-cli shapes", () => {
  assert.equal(getBaseToken({ base: { app_token: "app_xxx" } }), "app_xxx");
  assert.equal(getBaseToken({ data: { base: { base_token: "base_xxx" } } }), "base_xxx");
  assert.equal(getBaseToken({ app: { token: "token_xxx" } }), "token_xxx");
  assert.equal(getBaseToken({ result: [{ appToken: "camel_xxx" }] }), "camel_xxx");
});

test("extracts base url and table id recursively", () => {
  assert.equal(getBaseUrl({ data: { base: { url: "https://example.com/base" } } }), "https://example.com/base");
  assert.equal(getTableId({ data: { table: { table_id: "tbl_xxx" } } }), "tbl_xxx");
});
