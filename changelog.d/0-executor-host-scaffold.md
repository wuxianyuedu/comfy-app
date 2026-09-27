## Added

- **P3 §5 第 2 期 · Phase 2-B 骨架**：新增 `scripts/executor-host.mjs`（~90 行）。只走三条最小契约——**boot 打印 + 心跳落盘 + SIGTERM/`--once` 干净退**——为后续 Phase 2-C（launcher 集成）与 Phase 3（真正接管任务）铺路。ADR（`docs/superpowers/specs/2026-09-26-p3-phase2-executor-host-design.md`）§7 Phase 2-B 定义里明说这一步不接管流量，只证明「独立进程活着 + 日志落对 + 终止时进程真退」。
  - 纯 `.mjs` 无 TS：骨架阶段**不** `import` 任何 `src/**` 的 TS 模块——那会需要 tsx runtime + 触发 configureXxx 注入链，而 Phase 2-A（repository driver 抽取）还没做、注入链没有可注入的实现。保持零依赖让单测能直接 `spawn(node, [executor-host.mjs])` 而不用 tsx。
  - 日志路径：默认 `log/services/executor-host.log`（追加、不轮转，与 `comfyui-runtime.log` 同族）；`COMFYAPP_HOST_LOG` env 可覆盖到任意路径。测试全走 `mkdtempSync(os.tmpdir())`，绝不污染仓库 `log/`（遵循 MEMORY「写日志类用例给自己的临时目录」条）。
  - 环境变量：`COMFYAPP_HOST_LOG` / `COMFYAPP_HOST_BOOT_ID`；`--once` 参数走 boot-then-exit；`--interval=N` 控心跳周期（默认 5s）。
  - 新增 `tests/executor-host.test.ts` 3 条契约：① `--once` 立刻 exit 0、日志含 boot + 退出两行、时间戳形态与 `app-runtime.log` 一致；② 常驻 + SIGTERM：先等到 heartbeat 再 kill、POSIX 断 exit=0 + `shutdown sig=SIGTERM` 行、Windows 只断「进程真终止」（`child.kill("SIGTERM")` 在 win32 走 TerminateProcess、handler 不跑是 Node 已知差异，真正的整树回收由 `cross-platform-launcher.test.ts` 与 `kill-process-tree.windows.test.ts` 覆盖，本 PR 不重复测）；③ 源码级断默认路径落在 `log/services/`，与规范 §4「log 分区」一致。用例超时提到 20s，覆盖 spawn + 首次 heartbeat (100ms) + kill 往返。
  - **不接 launcher**（Phase 2-C）、**不登记 `RUNTIME_SCRIPTS`**（standalone 产物白名单，Phase 2-D 做）：骨架阶段这个文件在 `scripts/` 下静态存在，但生产路径没人 `spawn` 它——所以产物白名单登记与 launcher 集成一起留给后续 PR。这样 Phase 2-C 前，`.mjs` 挂了也不影响任何已跑通的启动链。
  - 验证：`tsc --noEmit` / `eslint --max-warnings 0` / `vitest run tests/executor-host.test.ts` **3/3 全绿**（含 Windows 平台分岔）/ `.githooks/pre-commit` 28 步全过。
