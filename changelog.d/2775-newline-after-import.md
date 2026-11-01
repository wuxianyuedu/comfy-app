## Changed

- oxlint `import/newline-after-import` 全仓清零（#2775）：10 处 / 9 份，全部是在
  import / require 块之后补一个空行 —— 纯空行规范化，无运行期变化：
  `src/components/studio/RequiredSummary.tsx`、`src/components/studio/canvas/NodeFrost.tsx`、
  `src/components/studio/WorkflowCanvasDecorations.tsx`、
  `src/app/(main)/settings/hooks/use-settings-page.ts` 各 1；
  `src/lib/comfyui/localWorkflows.test.ts`、`tests/reduced-motion-tiers.test.ts`、
  `scripts/build-desktop.mjs`、`scripts/check-ui-primitives.cjs` 各 1；
  `scripts/run-affected-tests.mjs` 2。
- 被改动的五份 `src/**` 同批过一遍 oxfmt（`localWorkflows.test.ts` 里另有两处既有换行
  与 `printWidth: 100` 不符，顺带收敛，仍只是空白差异）；`scripts/**` / `tests/**`
  不在格式化器的面内，未跑。
