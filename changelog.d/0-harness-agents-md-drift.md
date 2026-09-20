## Fixed

- **AGENTS.md 与规范 §13.5 权威源漂移**（Better Harness 就绪度评审发现）：ISSUE #623 删除
  `.cnb.yml` 后，平台侧已不跑任何流水线（规范 §13.5 有明确登记），但代理唯一自动加载的
  AGENTS.md 未同步跟进，仍在 7 处把「CI」当作现行兜底描述——规则 6「三层防线含
  CI Branch guard 步骤」、规则 10「check-ui-logic-separation 已接入 pre-commit 与 CI」、
  规则 12「check-ps1-consistency 在 pre-commit 与 CI 核对」、规则 14「check-changelog-fragments
  在 pre-commit 与 CI 强制拦截」、规则 18「CI 只跑 pnpm build」、规则 19「CI 全绿」
  与「pre-commit 第 2 步与 CI File structure rules 各跑一次」。信任 AGENTS.md 的代理会误
  以为本地提交后有 CI 兜底，从而放松自测——恰是仓库规则最要防的静默盲区。改为「两层
  防线（平台分支保护 + 本地 pre-commit）+ 服务端形态作为判据保留但暂无调用方」，与其
  余各处删掉「与 CI」或换成「本地钩子」；同时把「干净检出（CI / 新克隆）」这类仅作环境
  指代、不声称 CI 跑门禁的表述保留。规则 22「共享类型下沉」示例路径由
  `src/lib/workflow-io-types.ts` 修正为真实存在的 `src/lib/workflow/workflow-io-types.ts`
  （这也正是规则 11「迁移目录时连带检查规范与碎片里的路径引用」在本条上的失守点）。

- **`codegraph` 与 `zvec-grep` 两个 MCP server 无工作流归属**：`.mcp.json` 声明了这两个
  stdio server，但 AGENTS.md 全文零提及，agent-customize lint 独立报出
  `mcp-without-workflow-owner`。在「按改动范围快速定位规范章节」列表末尾追加一条导航
  bullet，把它们定位为**检索/图谱加速工具**，并显式说明「门禁判据只在
  `scripts/check-*.cjs` 与 `.githooks/pre-commit`——MCP 不替代机器判据，也不作为提交前
  的独立校验源」，选择顺序：先看有没有对应 `pnpm exec` 脚本 / 门禁能给出结论 → 得不出
  再做检索；输入 / 输出 / 失败语义以各 server 的 `--help` 与 `.mcp.json` 声明为准。
