## Fixed

#2919 批次③：`typescript/no-unnecessary-condition` 在 `src/components`、`src/app`、
`scripts`、`.storybook`、`next.config.js` 按单规则口径 **59 处 / 36 份 → 0**。

- 机械族改写 8 处（本地构造的已知非空类型上多余的可选链 / 恒非空的 `??` 右支）：
  `RelatedEdgesHighlight.test.tsx` ×2、`use-film-studio.test.ts` ×1、
  `use-task-log-stream.test.ts` ×4、`base-check.mjs` 的 `r.verdict ?? "红"` ×1。
- 保留运行期防御 51 处，落 46 行 `oxlint-disable-next-line typescript/no-unnecessary-condition`，
  逐行写值来源 + 为何不可达 / 为何保留：
  - DOM `textContent`（JSDOM / 真实 DOM 运行期可为 `string | null`）：26 处；
  - 子进程出参 / 外部文本（`stdout`、`lines`、`text`、`argv` 下标、`next.config.js` 的 `pnpm store path`）：13 处；
  - Storybook `parameters` 里的场景名（story 里手写的不可信输入）：6 处；
  - 其余（`as` 断言后的外部形状 1、夹具可选参数 1、流式 `while (true)` 3、`matchAll` 捕获组 1）：6 处。
- 另收掉 master 新增的回潮 3 处（`scripts/ci-run-tool.mjs`、`tests/ci-run-tool-readout.test.ts`、
  `scripts/ci-mirror-lfs-push.mjs`，都是子进程出参兜底，同样落台账禁用 + 理由）。

验证：单规则复扫 **59 → 0**（1384 份文件）；`tsc --noEmit` 0 错；
`vitest run`（`src/components` + `src/app` + 脚本 / 故事源相关用例）**292 份 / 2955 条全绿**；
`pnpm check:premerge` 通过。
