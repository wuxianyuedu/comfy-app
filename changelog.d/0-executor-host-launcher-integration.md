## Added

- **P3 §5 第 2 期 · Phase 2-C：`dev-launcher.mjs` 接入 `executor-host.mjs` 作为受管子进程 + `COMFY_EXECUTOR` 灰度门控**：新增 `spawnExecutorHost()`（`process.execPath` 直接起本地 node + 脚本路径，不走 pnpm——不是"用户命令"、避免 Windows 上 pnpm.cmd 的 `.ps1` 分叉与 corepack shim 探测开销），走 `launcher-core/shell.mjs` 的 `spawnInGroup`（POSIX 自建进程组 / Windows `taskkill /T`），把 child `spawned.push(child)` 塞进 launcher 的会话锚点与 `reapAll` 覆盖范围。`run()` 里新增「6.5) 可选：拉起 ComfyUI 执行器独立宿主」步骤——`(process.env.COMFY_EXECUTOR ?? "inline")` 判断，只有显式 `host` 才 spawn，其它值 warn 后走 inline；默认 **inline 不 spawn**，与 Phase 2-B「灰度起手不接管」的骨架一致（taskRepository 注入在 Phase 2-A、流量切换在 Phase 3）。
  - `COMFYAPP_HOST_BOOT_ID=runTimestamp` 传给子进程，让 host 日志与 launcher 日志能按同一时间戳串起来（Phase 2-B 的 `executor-host.mjs` 里 boot 行读这个 env、写进 `[executor-host] boot ... bootId=...`）。
  - `hostScript` 不存在时（Phase 2-B 未装齐的分支/降级检出）只 warn 跳过、不影响 launcher 主流程；这是" launcher 与被拉起脚本的解耦"：launcher 允许 host 缺席、不硬失败。
  - **不接管流量**：host 起了、inline 路径也照常跑；两个进程都存活但只有 inline 在处理任务，用户视角等价 `COMFY_EXECUTOR` 未设。这是刻意的"起得来的最小证明"，不引入双写风险（Phase 3 用 `task.claimedBy` 列做互斥后才开始分流）。

## Changed

- `scripts/standalone-private-inputs.mjs`：`RUNTIME_SCRIPTS` 加 `executor-host.mjs`——桌面包用户改 `.env` 的 `COMFY_EXECUTOR=host` 时脚本得随包带出去。
- `scripts/check-standalone-contents.cjs`：`ALLOWED_SCRIPTS` 同步加同一条，与 `RUNTIME_SCRIPTS` 同源（`tests/dist-artifact-hygiene.test.ts` 的「两份白名单集合相同」判据守着）。
- `tests/cross-platform-launcher.test.ts`：新增 `describe("Phase 2-C：executor-host 接入 launcher")` 4 条源码 grep 契约——`spawnExecutorHost` 走 `spawnInGroup`（**不**绕过进程组语义、直接 `spawn()` 会被反向匹配挡下）+ 把 child 塞进 `spawned` 让 `reapAll` 覆盖 + 受 `COMFY_EXECUTOR` 门控且默认 inline + `RUNTIME_SCRIPTS` 含 `executor-host.mjs`。真进程级验证在 `tests/executor-host.test.ts`（Phase 2-B），不重复。

## Verification

- `pnpm exec tsc --noEmit` / `eslint --max-warnings 0` → 全绿
- `pnpm exec vitest run tests/cross-platform-launcher.test.ts tests/executor-host.test.ts tests/dist-artifact-hygiene.test.ts src/lib/comfyui tests/lib-node-only-declarations.test.ts` → **589 passed / 5 skipped**（含 Phase 2-B 三条 host smoke + Phase 2-C 新增四条 grep 契约 + `reap-process.mjs` 真进程树回收那条 1.2s 用例）
- `check-format` 无新增未过 prettier 文件；`.githooks/pre-commit` 28 步全过
