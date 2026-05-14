# Dify 工作流控制台

本地 Web App：在网页里配置并切换多个 Dify Workflow，预览指定 `outputs` 字段的 JSON 结果，并确认后用 `lark-cli` 创建飞书多维表格。

## 准备配置

1. 复制环境变量模板：

```bash
cp .env.example .env
```

2. 编辑 `.env`：

```bash
DIFY_API_BASE=https://dify.qmniu.com/v1
DIFY_API_KEY=app-你的默认DifyKey
PORT=5001
```

`DIFY_API_BASE` 为全局 Dify API 地址。每个工作流的 API Key 可在页面里单独配置；`DIFY_API_KEY` 仅用于第一次没有本地工作流配置时生成默认工作流。

3. 按需调整旧版默认工作流输入字段：

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

默认读取 Dify 返回的 `data.outputs.result`，并使用 `config/app.json` 里的 `larkIdentity` 创建 Base。当前默认是 `user`，即 `lark-cli --as user`。

5. 多工作流配置：

在页面顶部点击“管理工作流”，可以新增、编辑、删除工作流。配置会保存到：

```text
config/workflows.local.json
```

该文件已被 Git 忽略，可保存本机工作流 API Key。后端对前端返回配置时只返回 `apiKeyConfigured`，不会回显 API Key 明文。

## 飞书权限

创建多维表格、创建数据表、创建字段、批量写入记录时，当前身份至少需要开通这些权限：

- `base:app:create`
- `base:table:create`
- `base:field:read`
- `base:field:create`
- `base:record:create`

如果页面提示 `App scope not enabled`，按报错里的 scope 到飞书开放平台补开权限后，再重新点击“创建飞书多维表格”。
如果使用用户身份，请确保当前用户也完成对应 scope 授权，例如：

```bash
lark-cli auth login --scope "base:field:read"
```

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

1. 在顶部选择工作流，或进入“管理工作流”维护配置。
2. 在左侧填写当前工作流的 Dify 输入参数。
3. 点击“运行工作流”。
4. 确认右侧 JSON 表格预览无误。
5. 填写飞书多维表格名称和数据表名称。
6. 点击“创建飞书多维表格”。

## 测试

```bash
npm test
npm run build
lark-cli doctor --offline
```

## 注意

- Dify API Key 只在后端读取，不会返回给前端。
- 多工作流历史按工作流隔离，旧版单工作流历史会归入默认工作流。
- 第一版只支持 Dify 输出可解析为 JSON 的结果；非 JSON 输出会展示错误，不会创建 Base。
- 飞书写入单批最多 200 行，后端会自动分批。
- `lark-cli doctor --offline` 当前提示有新版 `1.0.29` 可升级，现有 `1.0.28` 已能通过本地配置检查。
