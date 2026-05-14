# Dify 工作流控制台

本地 Web App：在网页里调用 Dify Workflow API，预览 `outputs.result` 的 JSON 结果，并确认后用 `lark-cli --as bot` 创建飞书多维表格。

## 准备配置

1. 复制环境变量模板：

```bash
cp .env.example .env
```

2. 编辑 `.env`：

```bash
DIFY_API_BASE=https://dify.qmniu.com/v1
DIFY_API_KEY=app-你的DifyKey
PORT=5001
```

3. 按需调整工作流输入字段：

```text
config/workflow-fields.json
```

默认字段是：

- `book_id`
- `start_chapter_index`
- `end_chapter_index`

4. 按需调整应用配置：

```text
config/app.json
```

默认读取 Dify 返回的 `data.outputs.result`，并使用 `lark-cli --as bot` 创建 Base。

## 飞书权限

使用 Bot 身份创建多维表格、创建数据表、批量写入记录时，飞书开放平台里的当前应用至少需要开通这些权限：

- `base:app:create`
- `base:table:create`
- `base:record:create`

如果页面提示 `App scope not enabled`，按报错里的 scope 到飞书开放平台补开权限后，再重新点击“创建飞书多维表格”。

## 启动

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:5173/
```

## 使用流程

1. 在左侧填写 Dify 输入参数。
2. 点击“运行工作流”。
3. 确认右侧 JSON 表格预览无误。
4. 填写飞书多维表格名称和数据表名称。
5. 点击“创建飞书多维表格”。

## 测试

```bash
npm test
npm run build
lark-cli doctor --offline
```

## 注意

- Dify API Key 只在后端读取，不会返回给前端。
- 第一版只支持 Dify 输出可解析为 JSON 的结果；非 JSON 输出会展示错误，不会创建 Base。
- 飞书写入单批最多 200 行，后端会自动分批。
- `lark-cli doctor --offline` 当前提示有新版 `1.0.29` 可升级，现有 `1.0.28` 已能通过本地配置检查。
