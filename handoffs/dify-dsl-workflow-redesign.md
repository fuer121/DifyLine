# Dify DSL 工作流改造交接

更新时间：2026-05-13  
工作区：`/Users/staff/Desktop/Vibe coding/Dify 工作流`

## 背景

本次任务从一个可导出的 Dify 工作流 YAML 出发：

- 原始文件：`书籍章节画像自动提取-copy01.yml`
- 原能力：输入书籍 ID、章节范围、角色名，逐章分析指定角色的形象阶段变化
- 新需求：输入小说 ID 和章节范围，最多 100 章，逐章识别章节中出现的角色，判断角色定位为核心、重要或边缘，并输出角色名、角色定位、判断依据

过程中尝试过 Loop 增量合并版，但目标 Dify 前端无法渲染部分节点类型，最终落地为兼容版：

- 可运行文件：`小说角色定位合并-兼容版.yml`
- 设计文档：`角色定位增量合并工作流设计.md`
- 不稳定草稿：`小说角色定位增量合并.yml`、`小说角色定位增量合并-v2.yml`

## 关键结论

### 1. 先以原始可导入 DSL 为兼容性基准

不要直接按 Dify 最新文档或猜测节点结构生成 DSL。目标环境可能版本较旧或前端节点组件不完整。

本次原始 YAML 中已验证可渲染的节点类型只有：

```text
start
code
iteration
iteration-start
tool
llm
end
```

对应外层 `type`：

```text
custom
custom-iteration-start
```

后续生成新 DSL 时，应优先只使用这些节点，除非目标 Dify 环境中已有同类节点导出样本。

### 2. React #130 多半是节点组件不兼容

导入后若画布报：

```text
Application error: a client-side exception has occurred
Uncaught Error: Minified React error #130
```

优先判断为前端渲染到了未知节点组件。常见风险节点：

```text
loop
loop-start
loop-end
assigner
if-else
```

这不一定代表 YAML 语法错，也不一定代表后端导入失败；可能是应用已创建，但前端打不开画布。

### 3. CSRF 401 和 DSL 错误要分开判断

如果 console 里大量接口都 401：

```text
/console/api/workspaces
/console/api/account/profile
/console/api/features
CSRF token is missing or invalid
```

这是浏览器会话/Cookie/CSRF 问题，不是 DSL 结构问题。

排查顺序：

1. Chrome 无痕窗口打开 Dify。
2. 若无痕正常，清理原浏览器中 `dify.qmniu.com` 的站点数据后重新登录。
3. 若无痕也 401，再检查服务端 URL、Cookie、CORS、反代配置。

本次验证：Chrome 无痕窗口能正常进入工作室，说明 CSRF 问题来自旧会话。

## 推荐落地策略

### 首选：兼容版 Iteration + 最终合并

当目标 Dify 环境不能稳定渲染 Loop / Assigner / If-Else 时，采用：

```text
用户输入
  -> 章节范围规范
  -> Iteration 逐章分析
      -> 获取书库书籍章节内容
      -> LLM 单章角色分析
      -> Code 解析单章 JSON
  -> LLM 最终合并角色结果
  -> Code 最终格式化输出
  -> End 输出
```

优点：

- 使用原始工作流已验证节点类型
- 导入和画布渲染成功率高
- 输出仍满足最终字段要求

缺点：

- 不是严格的“每章分析后立即增量暂存”
- 所有章节结果最终一次性进入合并 LLM，章节很多时上下文压力更大

适用范围：

- 章节数不超过 100
- 章节内容整体不会超过最终合并 LLM 可处理范围
- 目标优先级是“先跑通”

### 进阶：Loop 增量版只在有导出样本时做

如果确实要严格实现：

```text
第一章分析 -> 暂存
第二章分析 -> 合并前一章暂存 -> 暂存
第三章分析 -> 合并前两章暂存 -> 暂存
...
```

不要凭空写 Loop DSL。应先在目标 Dify UI 中手动创建一个最小 Loop 工作流，然后导出 YAML，确认以下字段：

- Loop 节点 `data.type`
- Loop start / Loop end 的外层 `type`
- 循环变量字段名
- 变量赋值器字段名
- If-Else 条件结构
- Edge 的 `sourceHandle` 写法

拿到目标环境自己的导出样本后，再基于样本生成增量版。

## 生成 DSL 的检查清单

每次生成 YAML 后做这些本地检查：

```bash
ruby -ryaml -e 'data=YAML.load_file("文件名.yml"); puts data.keys.inspect'
```

检查节点和边：

```bash
ruby -ryaml -rjson - <<'RUBY'
data=YAML.load_file('文件名.yml')
nodes=data.dig('workflow','graph','nodes') || []
edges=data.dig('workflow','graph','edges') || []
require 'set'
ids=Set.new(nodes.map{|n| n['id']})
missing=[]
edges.each do |e|
  missing << ['edge.source',e['id'],e['source']] unless ids.include?(e['source'])
  missing << ['edge.target',e['id'],e['target']] unless ids.include?(e['target'])
end
puts JSON.pretty_generate({
  nodes:nodes.size,
  edges:edges.size,
  node_types:nodes.map{|n| [n['type'], n.dig('data','type')]}.uniq,
  missing:missing
})
RUBY
```

重点看：

- `missing` 必须为空
- `node_types` 不应出现目标环境未验证过的节点
- `value_selector` 第一个元素必须指向存在的节点 ID，或者是目标环境支持的特殊 selector
- 迭代内部节点要带 `parentId`、`isInIteration: true`、`iteration_id`
- 迭代起点使用 `custom-iteration-start`

## 本次可用文件说明

### `小说角色定位合并-兼容版.yml`

当前已验证可以跑的版本。节点：

```text
用户输入
章节范围规范
逐章分析
获取书库书籍章节内容
单章角色分析
解析单章 JSON
最终合并角色结果
最终格式化输出
输出
```

输出：

```json
[
  {
    "角色名": "角色名称",
    "角色定位": "核心角色 | 重要角色 | 边缘角色",
    "判断依据": ["依据1", "依据2"]
  }
]
```

### `小说角色定位增量合并.yml`

第一版 Loop 增量 DSL 草稿。导入后可能触发 React #130。

### `小说角色定位增量合并-v2.yml`

第二版 Loop 增量 DSL 草稿，修过 CSRF 排查后发现仍可能触发 React #130。保留作参考，不建议直接导入生产环境。

### `角色定位增量合并工作流设计.md`

概念设计文档，适合在 Dify UI 中手动搭建严格增量版时参考。

## 后续迭代建议

1. 在目标 Dify UI 手动搭一个最小 Loop 示例：Start -> Loop -> Code -> Variable Assign -> Exit。
2. 导出最小 Loop 示例 YAML，新增到 `handoffs/samples/`。
3. 基于目标环境实际导出的 Loop DSL，生成真正增量版。
4. 如果章节内容很长，兼容版要增加分批合并：每 10 到 20 章合并一次，再二次总合并。
5. 如果角色同名或别名复杂，最终合并提示词中增加“角色别名冲突表”和“不确定合并列表”。

## 更新规则

后续相同任务继续更新本文档：

- 新增目标 Dify 版本信息
- 新增成功导入的 DSL 样本
- 记录失败报错和最终根因
- 将可复用的 Ruby/YAML 生成脚本独立成脚本文件
- 保留“失败版本为什么失败”的说明，避免重复踩坑
