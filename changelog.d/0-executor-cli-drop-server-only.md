## Changed

- **`executor-cli.ts` 摘 server-only + 三条 lazy 依赖（P3 迁移第 1 期·第三步·执行批）**：`import "server-only"` 去掉；`~/lib/core/logger` / `../core/repository`（taskRepository） / `./client`（resolveComfyBase）三条 server-only 侧静态值 import 全改成 lazy + `configureExecutorCli(deps?)`。**两条通道的行为契约不同**：
  - **logger 走「加载即 fire-and-forget + module-level ref + `cliWarn` 静默 skip」**（诊断通道，与 #1060 trace、#1045 runner-state 的 `persistLogs` 失败兜底同族）：7 处 `logger.warn(...)` 一次性 sed 换成 `cliWarn(...)`，call 面一模一样，只是拿不到 logger 时静默。
  - **taskRepository / resolveComfyBase 走「关键路径、拿不到就抛」**：在 `executeViaComfyCli` 顶部一次性 resolve 成同名局部（`const taskRepository = await resolveTaskRepo(); const resolveComfyBase = await resolveBaseFn();`），下游 closure 沿用旧名，call site 一字不动；纯 Node 未 configure 时 dynamic import 撞 server-only throw → `executeViaComfyCli` 直接 reject 让 scheduler / enqueue 感知（不静默）。
  - Node 内建值 import 保留（`child_process` / `fs` / `path` —— spawn comfy-cli 子进程与读写临时工作流文件），落进 unguarded、按第三类登记。
  - 类型走 `Awaited<ReturnType<typeof loadRealTaskRepo>>` + `Pick<>, "markRunning">` 反推真实例形状（本模块只用 `markRunning` 一条）；`resolveComfyBase` 是 `() => Promise<string>` 直签；`LoggerLike` 只锁 `warn`。
  - `executor-cli.test.ts` 追加一条 `configureExecutorCli` smoke（dynamic import 拉本体，避开给 20+ 条纯 `applyRawOverrides` 测试添加加载成本），兼作 `configureExecutorCli` 在 `check-dead-exports` 眼里的消费方。
  - 登记进 `PURE_NODE_HOSTS` 时诚实标注：本模块**自身**的静态边已解，但**传递闭包**里 `./client`、`../core/repository` 各自仍静态引 server-only 侧（logger → app-runtime-log → server-only throw、repository 直接 server-only），登记是「标方向 + 消化 unguarded」、**不是**「现在能在纯 Node 里 import 本模块」——那要等 client / repository / app-runtime-log 各自拆完。
  - 验证：`tsc --noEmit` / `eslint --max-warnings 0` / `lib-node-only-scan.mjs` 现 `unguarded=10`（7 comfyui + 3 pre-existing）全由登记消化、`libOnlyReachable=0` / `clientReachable=0` / `pnpm exec vitest run src/lib/comfyui` 532/532 全绿（含新加 1 条 + 既有 executor-cli / reaper / reaper-decisions / executor-scheduler / cli-procs-singleton / lifecycle 全套）/ `.githooks/pre-commit` 28 步全过。
