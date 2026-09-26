## Changed

- **5 个二级叶模块摘 server-only（P3 迁移第 1 期·lib 层地基批）**：`comfyui/instance-kind` / `comfyui/env-python` / `comfyui/lifecycle-exit` / `comfyui/desktop-instance` / `shell/open-in-browser` 五个模块清完。全都不引 server-only 侧模块、也不引业务侧的 logger / repository，形态与 `kill-process-tree` / `log-paths` / `app-runtime-log` 同族：
  - `instance-kind`：只依赖 `fs` / `path`。
  - `env-python`：`fs` / `os` / `path` + 纯函数 `~/lib/path-display`。
  - `lifecycle-exit`：`fs` + `./proc-detect` 的 type-only import。
  - `desktop-instance`：`fs` / `os` / `path` + 同批 `instance-kind`。
  - `shell/open-in-browser`：`child_process` + 纯函数 `~/lib/error-message`。
  - 这一步的战略意义：清完 comfyui 与 shell 目录下的**二级叶**，`client` / `comfyui/status` / `comfyui/lifecycle-launch` 等**汇聚点**的传递边就能自然解——它们静态引的就是这几个（`instance-kind` / `env-python` / `desktop-instance` / `open-in-browser`）。下一批拆汇聚点时不再需要 lazy 化这些叶子。
  - 全部登记进 `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。scanner 现 `unguarded=17`（前 10 批 comfyui + log-paths + app-runtime-log + 本批 5 叶 + 3 pre-existing），全部由登记消化；`libOnlyReachable=0` / `clientReachable=0` 保持。零行为变化。
  - 验证：`tsc --noEmit` / `eslint --max-warnings 0` / `vitest run src/lib/comfyui src/lib/shell tests/lib-node-only-declarations.test.ts` **619/619 全绿**（含 `instance-kind.test.ts` / `env-python.test.ts` / `lifecycle-exit.test.ts` / `desktop-instance.test.ts` 各自的既有回归 + `lib-node-only-declarations.test.ts` 5 条判据全过）/ `.githooks/pre-commit` 28 步全过。
