---
name: code-navigation
description: 用 codegraph / zvec-grep 两个 MCP 做代码检索与影响面分析时的取舍、输入输出与校验边界。当需要在仓库里跨文件找定义/引用、评估改动影响面、或做正则/文本检索时使用；门禁判据仍以 scripts/check-*.cjs 与 .githooks/pre-commit 为准，MCP 只作导航加速。
---

# 代码检索与影响面分析（codegraph / zvec-grep）

本仓库配置了两个**本地、只读**的 MCP server（声明见 `.mcp.json`）：

- `codegraph`：语义代码图谱，按定义 / 引用 / 影响面查询（`codegraph serve --mcp`）。
- `zvec-grep`：正则 / 文本跨文件检索（`zg server --stdio`，即默认的 `agent` 工具面 = 只给已建索引的检索）。

本 Skill 是这两个 MCP 的**工作流归属**：说明何时用、输入输出、以及校验/审批边界。

## 何时用（选择顺序）

1. **先看有没有对应的 `pnpm exec` 脚本 / 门禁能直接给结论。** 门禁判据只有一处
   出处——`scripts/check-*.cjs` 与 `.githooks/pre-commit`。
2. 门禁给不出结论、需要「跨文件的语义化检索」时，再用 MCP：
   - 找定义 / 引用 / 评估改动影响面 → `codegraph`；
   - 按正则 / 文本 / 关键字跨文件搜 → `zvec-grep`。
3. **用之前先判就绪**：`codegraph status` 与 `zg status` 任一条报未初始化，这次检索就**只能当加速不可用**处理——
   未建索引时语义查询**返回空而不报错**，所以**「查不到」不等于「仓库里没有」**。要下「没有现成实现」的结论
   （AGENTS 硬规则 24 的复用优先），必须再用 Grep / Read 复核一遍，并说明用了哪一遍。
4. 二者都是**导航加速**，不作为提交前的独立校验源，也不替代机器判据。

## 输入 / 输出

- 具体参数、工具面与失败语义以各 server 的 `--help` 与 `.mcp.json` 声明为准。
- `codegraph` 维护预建索引（本地 `.codegraph/`，已 gitignore）；`zvec-grep` 维护本地
  索引（`.zvec-grep/`）。索引是缓存：删除对源码零影响；结果新鲜度取决于索引是否跟上
  了工作树，改动后若要最新结果，先确认索引已重建。

## 安装与索引前提（新检出 / 换机器要先知道）

- 这两个 server 是**每台开发机各自的全局工具**，不在 `package.json` / `pnpm-lock.yaml` 里，
  `pnpm install` 不会带上它们。命令不在 PATH 时，`.mcp.json` 里对应的 server 起不来，表现是
  **工具缺席**而不是仓库报错。本机实测版本：`codegraph` 1.6.0、`zvec-grep` 0.2.1。
- 装法（按 AGENTS 硬规则 1 只走 pnpm）：`pnpm add -g @colbymchenry/codegraph`、
  `pnpm add -g @zvec/zvec-grep`。
- 两者都带**本地索引**，没索引时语义查询没有结果，而工具自己会给出下一步：
  `codegraph status` 报 `Not initialized` → `codegraph init`（全量重建 `codegraph index`、
  增量 `codegraph sync`、删索引 `codegraph uninit`）；`zg status` 报
  `Workspace index is not configured` → `zg index`。
- `zvec-grep` 的语义索引涉及 embedding provider 选择与凭据，要不要配由你选的 embedding
  形态决定（自查入口 `zg config` / `zg auth status`）；不配索引也能用受管 ripgrep：
  `zg query --rg <pattern> <path>` 不依赖索引。
- 索引目录 `.codegraph/`、`.zvec-grep/` 是本机缓存、已 gitignore：删除对源码零影响，
  也别假设它存在于别人的机器或容器里。

## 校验 / 审批边界

- **只读**：这两个 MCP 只做检索，不写文件、不执行变更。任何「据此改代码」仍走正常
  分支 + PR + pre-commit（AGENTS 硬规则 6、7）。
- **工具面按声明收口**：`zvec-grep` 的 MCP 面跑默认的 `agent` 档（只给已建索引的检索），
  与上面那条「只读」是同一件事。受管 rg / index / status 不在 MCP 面上——需要时用 CLI
  一次性动作（`zg query --rg` / `zg index` / `zg status`），因为建索引会牵 embedding
  provider 与凭据，那一步该由人敲，不做成常开面。
- 不把 MCP 输出当作门禁通过的依据；提交门禁判据不变。
- 本文件是这条政策的**唯一出处**：AGENTS.md 只保留「门禁判据只在 `scripts/check-*.cjs` 与
  `.githooks/pre-commit`」那条红线并指向本文件，不再重抄用法。
