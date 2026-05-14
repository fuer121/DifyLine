import express from "express";
import { loadPublicConfig, renderTemplate } from "./config.js";
import { createLarkBaseFromParsed } from "./lark.js";
import { parseWorkflowOutput } from "./mapper.js";
import { coerceInputs, runDifyWorkflow } from "./workflow.js";

const app = express();
const port = Number(process.env.PORT || 5001);

app.use(express.json({ limit: "10mb" }));

app.get("/api/config", async (_request, response, next) => {
  try {
    response.json(await loadPublicConfig());
  } catch (error) {
    next(error);
  }
});

app.post("/api/workflow/run", async (request, response, next) => {
  try {
    const publicConfig = await loadPublicConfig();
    const inputs = coerceInputs(publicConfig.fields, request.body?.inputs || {});
    const result = await runDifyWorkflow({
      inputs,
      outputField: publicConfig.app.outputField,
      user: publicConfig.app.difyUser
    });

    response.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/lark/base/create", async (request, response, next) => {
  try {
    const publicConfig = await loadPublicConfig();
    const parsed = request.body?.parsed || parseWorkflowOutput(request.body?.rawOutput);
    const baseName = request.body?.baseName || renderTemplate(publicConfig.app.baseNameTemplate);
    const tableName = request.body?.tableName || publicConfig.app.tableName;

    const result = await createLarkBaseFromParsed({
      parsed,
      baseName,
      tableName,
      identity: publicConfig.app.larkIdentity
    });

    response.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/output/parse", (request, response, next) => {
  try {
    response.json({ ok: true, parsed: parseWorkflowOutput(request.body?.rawOutput) });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  const status = error.status || 500;
  response.status(status).json({
    ok: false,
    error: error.message || "服务器错误",
    details: sanitizeErrorDetails(error.details)
  });
});

app.listen(port, () => {
  console.log(`Dify 工作流控制台 API 已启动：http://127.0.0.1:${port}`);
});

function sanitizeErrorDetails(details) {
  if (!details) return undefined;
  return JSON.parse(
    JSON.stringify(details).replace(/(app-|sk-)[A-Za-z0-9_-]+/g, "$1***")
  );
}

