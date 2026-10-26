## Fixed

- `scripts/typedoc-run.mjs`：typedoc 不再经 shell 层起 `node_modules/.bin/typedoc.cmd`
  垫片（ISSUE #2445）—— 平台「API 文档生成与自检」格日志开头的
  `[DEP0190] DeprecationWarning`（Node 26 弃用「args 数组 + 开 shell」）清零。
  `resolveTypedocBin`（垫片路径）→ `resolveTypedocEntry`：走
  `require.resolve("typedoc/package.json")` 取包真身 + `bin.typedoc` 相对段
  （`resolveVitestEntry` 同款口径）；`spawnTypedoc` 改
  `spawn(process.execPath, [entry, …])`，不经 shell、不括引号，参数由 Node 原生转义。
- `tests/typedoc-run.test.ts`：入口形态断言（包真身、不在 `.bin/` 下、裸根给 null）；
  新增源码形状判据（模块源码不再出现 shell 选项与手工括引号形态）——
  用例层测不到真 spawn 的选项面，源码形状是那层覆盖的唯一口径（#2444 同款）。
