## Added

- **脚本执行命令行现在会打出来（`>>> <命令行>`），并收成唯一出口**：此前脚本只打印步骤名（「1/4 执行 pnpm build」/「步骤 1/2：pnpm install」），真正被执行的那条命令只在**失败分支**里出现 —— 顺利时看不到、出问题时才补一句；而 Windows 上 `pnpm` 被解析成哪一种形态（无扩展名 shim / `.ps1` / `.cmd`）只能从命令行看出来，不回显就只能靠猜（ISSUE #576 的四轮现场）。
  - 新增 `scripts/launcher-core/command-echo.mjs`：`formatCommandLine()`（必要才加引号、空参数不丢、单行）+ `echoCommandLine()`（`>>> ` 前缀、sink 可注入、`COMFYAPP_ECHO_COMMANDS=0` 整体静默）。
  - 接在**执行出口**上：`shell.mjs`（`spawnInGroup` / `runSync` / `runPnpmSync`）、`procs.mjs`（`runCapture` 的端口/进程探测）、`corepack.mjs`（工具链探测与 corepack 重建）；入口脚本里直连 spawn 的地方（`dev.mjs` / `start.mjs` / `analyze-bundle.mjs` / `build-desktop.mjs` / `db-schema-state.mjs` / `dev-launcher.mjs` 打开浏览器 / `quality-gate.mjs`）显式调用同一出口。
  - `run-tests.mjs` / `quality-gate.mjs` 里手写的 `>>> pnpm …` 改由共享实现产出：手写那份只能猜「pnpm」这个字面名，回显的应是**形态判据选出来的**那条（宿主 + `-File <shim>` 一起带上）。
  - Windows 入口 `.ps1` 补同一前缀的回显（`.ps1` 无法 import 上面的模块，只能手工写）：`dev-launcher.ps1`（此前只有 `-DryRun` 才打印将调用的命令）、`entry-common.ps1`（双击入口转交）、`sync-lint.ps1`、`generate-docs.ps1`、`prepare-local-run.ps1`。
  - 分发白名单同步登记新模块：`standalone-private-inputs.mjs` 的 `RUNTIME_SCRIPTS` 与 `check-standalone-contents.cjs` 的 `ALLOWED_SCRIPTS` —— `shell.mjs` / `procs.mjs` 都 import 它，漏登记就是桌面包里编排器的运行期 `ERR_MODULE_NOT_FOUND`。
  - 规范 `docs/standards/launch-and-build.md` 新增 §4.4（回显口径、两侧分工、`COMFYAPP_ECHO_COMMANDS` 开关）；回归护栏 `tests/command-echo.test.ts`（格式化规则 / 开关 / 「执行出口真的接上了」）。
