## Added

- 新增注释语言棘轮门禁 `scripts/check-comment-language.cjs`（规范 12 §12.4.6 /
  AGENTS 硬规则 23）：按文件记「疑似英文注释行」的计数棘轮，只许降不许升 ——
  新增带英文注释的文件、或存量文件的英文注释变多即阻断提交；
  `--update` 收紧基线、`--strict` 要求必须收紧。
  配套回归测试 `tests/comment-language.test.ts`（15 条）。
- 「纯 ASCII 模块」白名单机制：会被 `next-code-frame` 渲染到的构建期模块必须保持纯 ASCII，
  注释写英文 —— 名单登记在 `docs/reference-facts.md` 的 `comment.language.asciiOnly` 一行
  （**只定义一次**，由 `scripts/doc-facts.cjs` 反向解析、`pnpm doc:check` 核对，判据与文档共读）。

## Changed

- **代码注释统一改成中文**（ISSUE #678「代码中的注释尽量改成中文」）：业务模块、组件、
  测试与脚本里的英文注释逐条改写为中文。第一批完成的是注释量最大的几个文件
  （`workflow-types` / `workflow-utils` / `workflow-editor-build-nodes` /
  `workflow-subgraph-parse` / `workflow-detail` / `workflow-detail-raw` /
  `workflow-detail-io` / `workflow-io` / `WorkflowEditorNodes` / `WorkflowSubgraphNode` /
  `comfyui/reaper` / `comfyui/markdown` / `comfyui/localWorkflows` 等），
  棘轮基线由 5550 行降到 3562 行，余量按同一口径继续推进。
- 规范与口径同步：`AGENTS.md` 新增硬规则 23；`docs/standards/12-代码组织与文件结构.md`
  新增 §12.4.6（注释语言与「纯 ASCII 模块」白名单、工具指示注释豁免）；
  `docs/standards/launch-and-build.md` 新增 §9.6（例外为什么必须存在、名单为什么只能有一份）。

## Fixed

- 工具指示注释（`@vitest-environment` / `@ts-expect-error` / `eslint-disable*` 等）
  在统计中整行豁免：它们是工具按**字面量**解析的指令，改成中文不是报错而是**静默失效**
  （用例悄悄跑回默认环境、类型豁免悄悄失效）。棘轮因此不会被这类行逼着做出错误改写。
