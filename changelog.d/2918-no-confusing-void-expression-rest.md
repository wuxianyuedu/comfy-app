## Changed

- oxlint `typescript/no-confusing-void-expression` 第 3 批：`src/server/**`、`src/instrumentation.ts`、
  `tests/**`、`e2e/**` 清零（35 处 / 25 份，ISSUE #2918）。

  形态与前两批一致（箭头简写 → 块体）。三处需要单独说明：

  - `src/server/api/routers/task.ts` 的 `fsPromises.rm(...).catch((error) => logger.warn(...))`
    换块体 —— `logger.warn` 返回 `void`，`catch` 的回调本来就只为副作用；
  - `src/instrumentation.ts` 两处 `await import(...).then((m) => m.startXxx())` 换块体
    （`startDispatchLoop` / `installStreamCapture` 都是 `=> void`）；
  - `tests/e2e-fake-comfyui-endpoint.test.ts` 的 `return resolve();` 改成 `resolve(); return;`
    （在 Promise executor 里，`return` 只为提前退出）。

  验证：单规则复扫上述目录 0 命中；`tsc`（两份 tsconfig）/ `eslint` / `oxfmt` 通过；
  改动面受影响用例 166 份绿 —— 另有 3 份（`ci-slot-apply` / `dev-handle` / `tauri-tools-cache`）
  在干净基线上**同样命中**，`node scripts/base-check.mjs` 的结论是 `baseline-red`，与本次改动无关。
