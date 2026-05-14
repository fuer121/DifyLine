# Figma 页面原型规格

目标文件：
https://www.figma.com/design/J57TCEFLyHxYGKPRlCzUlO/Untitled?node-id=25-2

当前会话没有暴露 Figma MCP / `use_figma` 写入工具，也没有可用的 `FIGMA_OAUTH_TOKEN`，所以这份交付物先作为可导入 Figma 的整页原型蓝图。可导入素材在同目录：

- `handoffs/figma-page-prototype.svg`

## 页面

- Frame 名称：`Dify 工作流控制台 / Web prototype`
- 桌面尺寸：`1440 x 1180`
- 背景：`#F6F7F4`
- 最大内容宽度：`1408`
- 外边距：左右 `16`，顶部 `18`
- 基础字体：Inter / system UI

## 颜色

- Text primary：`#20231F`
- Text secondary：`#6C746A`
- Text muted：`#7A8378`
- Surface：`rgba(255,255,255,0.92)`
- Surface soft：`#FBFCFA`
- Border：`#E2E6DF`
- Border soft：`#E3E7DF`
- Primary green：`#23864D`
- Success green：`#14733E`
- Success bg：`#EAF7EE`
- Error：`#91331F`
- Error bg：`#FFF6F3`

## 结构

1. 顶部状态栏
   - Logo：38 x 38，圆角 8，背景 `#23864D`
   - 标题：`Dify 工作流控制台`，24 / 1.15 / 760
   - 副标题：13 / 1.4
   - 状态胶囊：Dify、lark-cli，绿色在线点

2. 左栏
   - 宽度约 528
   - 面板 1：工作流输入配置
   - 面板 2：运行工作流

3. 右栏
   - 宽度约 868
   - 面板 3：输出预览
   - 面板 4：创建飞书多维表格

4. 底部
   - 面板 5：活动日志
   - 宽度 1408

## 组件规格

- Panel：白色 92% 透明，1px 边框 `#E2E6DF`，圆角 8，内边距 14。
- Button primary：高 44，圆角 7，背景 `#23864D`，白字 14 / 760。
- Button ghost：高 36，圆角 6，背景 `#FBFCFA`，边框 `#DFE4DC`。
- Input：高 38，圆角 6，边框 `#DFE4DC`。
- Disabled input：背景 `#F7F8F5`，文字 `#5C645A`。
- Chip：高 32，圆角 6，12 / 700。
- Empty state：虚线边框 `#D9DFD5`，圆角 7，背景 `#FBFCFA`。

## 文案与默认数据

- 字段：
  - `book_id` / `string` / 必填 / `book_001`
  - `start_chapter_index` / `integer` / 必填 / `1`
  - `end_chapter_index` / `integer` / 必填 / `50`
- 飞书：
  - 身份：`lark-cli --as bot`
  - Base 名称：`Dify 工作流结果 2026-05-13 12:30:00`
  - 表名：`结果表`

## Figma 落地建议

接入 Figma MCP 后，优先用 `use_figma` 创建可编辑 Frame，而不是只放入 SVG：

1. 创建 1440 宽 wrapper frame，垂直 auto layout。
2. 创建 `Topbar`、`Panel`、`GhostButton`、`PrimaryButton`、`Input`、`Chip`、`EmptyState` 基础组件。
3. 按本规格复用组件实例组成整页。
4. 最后对照 `figma-page-prototype.svg` 做视觉核验。
