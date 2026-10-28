## Changed

- **删 devDep `@next/bundle-analyzer`，`pnpm analyze` 切换 Next 16 内置 Turbopack
  分析器 `next analyze`（issue #2538）**。
  老依赖挂在 **webpack** 上（`scripts/analyze-bundle.mjs` 强制 `next build --webpack`
  + Node 内注入 `ANALYZE=true` 绕 Windows 不支持内联 env），与本仓默认构建链
  （Turbopack）脱节：产物形状是另一条链的，读数不可比。16.4.3 CLI 实测
  （`next/dist/bin/next:105-157`）：`next analyze`（*Only compatible with Turbopack*，
  支持 `--snapshot` 命名快照与 `-o` 落盘）与 `next analyze export`（JSONL 流式导出，
  可 `> bundle-graph.jsonl` 交脚本/AI）都在 —— 与默认链同链，webpack 版没有的
  快照 + diff + 导出能力白得。
  - `scripts/analyze-bundle.mjs` 删除（唯一存在理由是跨平台注入 `ANALYZE=true`）；
  - 连锁登记同批：`fixed-gate-input-faces.mjs` 输入面摘掉死面
    （`tests/fixed-gate-input-faces.test.ts` 形状②会点名）；`dev-launcher-toolchain-gate`
    测试清单摘掉（它直读该文件）；`check-bundle-budget.cjs` 的分工注释改写
    （分析器与预算判据如今**同链**，原「别拿一边读数比另一边」的 webpack 警告失效）；
  - 文档同批：§12/§13/launch-and-build 回显覆盖面表/PRODUCTION-GAPS，
    `docs/generated/**` 由 `render-doc-placeholders` 再生成。
  - 明确不在本批范围：oxlint / oxfmt / shiki 引擎降档 / `experimental.turbopack*`
    四开关（已实测在 16.4.3 类型里，须单独验证后走自己的单子）。
