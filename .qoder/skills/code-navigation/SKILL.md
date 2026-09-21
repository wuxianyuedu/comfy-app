---
name: code-navigation
description: 用 codegraph / zvec-grep 两个 MCP 做代码检索与影响面分析时的取舍、输入输出与校验边界。当需要在仓库里跨文件找定义/引用、评估改动影响面、或做正则/文本检索时使用；门禁判据仍以 scripts/check-*.cjs 与 .githooks/pre-commit 为准，MCP 只作导航加速。
---

# 代码检索与影响面分析（codegraph / zvec-grep）

本仓库配置了两个**本地、只读**的 MCP server（声明见 `.mcp.json`）：

- `codegraph`：语义代码图谱，按定义 / 引用 / 影响面查询（`codegraph serve --mcp`）。
- `zvec-grep`：正则 / 文本跨文件检索（`zg server --stdio --mcp-toolset full`）。

本 Skill 是这两个 MCP 的**工作流归属**：说明何时用、输入输出、以及校验/审批边界。

## 何时用（选择顺序）

1. **先看有没有对应的 `pnpm exec` 脚本 / 门禁能直接给结论。** 门禁判据只有一处
   出处——`scripts/check-*.cjs` 与 `.githooks/pre-commit`。
2. 门禁给不出结论、需要「跨文件的语义化检索」时，再用 MCP：
   - 找定义 / 引用 / 评估改动影响面 → `codegraph`；
   - 按正则 / 文本 / 关键字跨文件搜 → `zvec-grep`。
3. 二者都是**导航加速**，不作为提交前的独立校验源，也不替代机器判据。

## 输入 / 输出

- 具体参数、工具面与失败语义以各 server 的 `--help` 与 `.mcp.json` 声明为准。
- `codegraph` 维护预建索引（本地 `.codegraph/`，已 gitignore）；`zvec-grep` 维护本地
  索引（`.zvec-grep/`）。索引是缓存：删除对源码零影响；结果新鲜度取决于索引是否跟上
  了工作树，改动后若要最新结果，先确认索引已重建。

## 校验 / 审批边界

- **只读**：这两个 MCP 只做检索，不写文件、不执行变更。任何「据此改代码」仍走正常
  分支 + PR + pre-commit（AGENTS 硬规则 6、7）。
- 不把 MCP 输出当作门禁通过的依据；提交门禁判据不变。
- 与 AGENTS.md「改动前必读文档」里的 MCP 路由条目同源，不另立第二套判据。
