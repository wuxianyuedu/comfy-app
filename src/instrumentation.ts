/**
 * Next.js 遥测/观测初始化入口（Next 15 约定文件，自动执行）。
 * 仅在配置了 SENTRY_DSN 时启用 Sentry；未配置则全部 no-op。
 *
 * 启动耗时形状（本文件的唯一耗时契约）：
 *   · **请求会等 register() 返回**（Next 的启动语义），所以本函数里 await 的每一步
 *     都直接加在「首个请求被响应」之前 —— 这里只保留两步**有先后契约**的串行：
 *     产物根搬迁（先于一切读产物的启动点）→ 流捕获（先于其余分支可能产生的输出）。
 *   · 其余五支（reaper / dispatch / film 恢复 / 事件循环观测 / Sentry）互不依赖、
 *     都是「起循环即返回」或纯后台核对，**并行踢出、不阻塞 register**：串行 await
 *     它们的模块图编译（每支都要拉起一大片 server 代码）曾占掉暖启动就绪时间的
 *     一半（ISSUE #4137 的实测读数）。
 *
 * 注意：本文件在 Node.js 与 Edge 两种 runtime 下都会执行，
 * 必须按 runtime 分别加载对应配置，禁止在此处引入 server-only 模块；
 * Node-only 分件因此一律走动态 import（不能进 Edge 图）。
 */
/** 进程级兜底是否已挂（幂等闸：register 可能被 Next 以不同 runtime 多次触发）。 */
let processSafetyNetInstalled = false;

/** 同一条消息的重复记账：首 3 条全量记，之后每 50 条记一条——周期循环里的
 *  每拍异常不再把日志文件灌满（ISSUE #4256）。 */
const SAFETY_NET_REPEAT_EVERY = 50;

/**
 * 显式注册 `unhandledRejection` / `uncaughtException` 的进程级兜底（ISSUE #4216）。
 *
 * 策略与既有有效行为一致：**只记日志、不退出**——常驻桌面服务里，一条后台循环
 * （成片监看 / 派发 / reaper）的 rejection 不该打挂整个应用。此前这层只来自
 * `@sentry/node` 默认集成的隐式副作用（且 `scripts/executor-host.mjs` 等宿主进程
 * 没有这层）；这里显式化之后，谁起服务谁就有这张网。
 *
 * 洪水防护（ISSUE #4256）：同一 message 的重复异常只记首 3 条、之后每 50 条记
 * 一条（带累计序号），防止「周期循环每拍抛同一异常」把日志文件灌满。
 * 导出仅为可测（注册是进程级副作用，用例直接调用并断言监听器挂载与输出）。
 */
export function installProcessSafetyNet(): void {
  if (processSafetyNetInstalled) {
    return;
  }
  processSafetyNetInstalled = true;
  const describe = (reason: unknown): string =>
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  const counts = new Map<string, number>();
  const report = (kind: string, reason: unknown): void => {
    const text = describe(reason);
    const count = (counts.get(text) ?? 0) + 1;
    counts.set(text, count);
    if (count <= 3 || count % SAFETY_NET_REPEAT_EVERY === 0) {
      console.error(`[process] ${kind}#${count}：${text}`);
    }
  };
  process.on("unhandledRejection", (reason: unknown) => {
    report("unhandledRejection", reason);
  });
  process.on("uncaughtException", (error: Error) => {
    report("uncaughtException", error);
  });
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    /* 进程级兜底（ISSUE #4216）：先于一切后台分支挂上——后台循环（成片监看、
     * 派发、reaper）的 rejection 不该打挂常驻服务。 */
    installProcessSafetyNet();
    /* 产物根的一次性搬迁（台账 A13 的结构性关法）：历史落点在 `public/generated/`，
     * 而 `public/**` 由 Next 按静态文件直接发出、根本不经过带闸的 route handler ——
     * 把根搬到 `generated/` 之后那条旁路**不存在**。搬这一动作必须排在所有会读产物的
     * 启动点**之前**（下面的成片监看恢复就会读镜头视频），所以它是这里串行等待的
     * 第一步；dev 下本文件懒编译（`✓ Ready` 之后首个请求触发），这个编译窗口仍存在，
     * 但它只覆盖下面两步串行，不再叠加五支后台分支。 */
    await import("./lib/media/artifact-root-migration.server").then((m) =>
      m.migrateLegacyArtifactRoot(),
    );
    /* 把本进程（应用服务）的 stdout / stderr 转录一份进面板可见日志文件：
     * 此前首屏编译错误、Turbopack FATAL、未捕获的服务端异常只落在
     * log/nextjs/nextjs-stderr-*.log，而「应用日志」面板不读它——应用服务起不来
     * 时用户打开面板看到一片空白（ISSUE #360）。
     * 排在其余分支之前：并行分支的失败读数（含 console.error）要能被它收进面板。 */
    await import("./lib/log/capture-streams.server").then((m) => {
      m.installStreamCapture();
    });

    /* ── 并行启动分支（ISSUE #4137）────────────────────────────────────────
     *
     * 五支互不依赖的后台任务，此处只「踢出」不等待：
     *   · reaper —— ComfyUI 孤儿任务回收的**唯一** Next 侧启动点（P3 §5 ADR §14 D3）：
     *     它过去靠 `enqueue.ts` 的裸副作用 import 顺带起来，那条隐式耦合让
     *     「谁起 reaper」在模块图上不可见、且被删 import 时会静默失效。
     *   · dispatch —— 派发循环的**唯一** Next 侧启动点（P3 §5 ADR §14 D1 第二刀）：
     *     Next 也是一个执行宿主（owner='inline'），要按库里 `claimedBy` 归自己的
     *     那些行去领。与 reaper 同形态：不起就没有安全网——提交后那一次即时 kick
     *     若正好撞上 ComfyUI 还没起来，之后就再没人推进它。
     *   · film-resume —— 成片监看的**唯一** Next 侧恢复点（P3 §5 ADR 5-A）：
     *     `startFilm` 末尾那条 `void watchFilm()` 只活在当前进程里，热重启 /
     *     桌包重启会把它弄丢，而镜头任务还在库里由执行侧推进 —— 没人监看就是影片
     *     永远停在 GENERATING（既不出片也不失败）。**必须在产物搬迁完成之后**
     *     （它读镜头视频）——它排在 `register()` 串行段之后才被踢出，顺序由结构保证。
     *   · event-loop-watch —— 事件循环阻塞观测的**唯一**启动点（ISSUE #3369）：
     *     服务「断开约 20 秒自行恢复」的现场里进程没死、无异常、无慢查询记录，
     *     服务端一个字都不留——没有这份读数，断开永远「莫名」。
     *   · sentry —— SDK 配置；未配 DSN 时 no-op。
     *
     * 每支的失败只记日志、**不许**冒泡成 register 的拒绝：这些是自愈/观测网，
     * 单支失效不该让首个请求失败；console.error 由上面装好的流捕获收进面板。
     * 完成后落一行逐支耗时（启动页不显示，进 app-runtime 日志），给「启动耗时」
     * 的后续取证留同源读数。
     */
    const bootStartedAt = Date.now();
    /** @param {string} name 分支名（也进汇总行的键位） */
    const branchDoneMs = new Map<string, number>();
    const startBranch = (name: string, run: () => Promise<unknown>): Promise<void> =>
      import("./lib/shell/boot-branches.server").then(
        ({ FUNCTIONAL_BRANCHES, runBootBranchWithRetry }) => {
          /* 功能分支（dispatch / reaper / film-resume）带**自愈重试**（ISSUE #4257）：
           * 失败重试至多 3 次（间隔 30s），仍失败则记账落盘——消息中心据此提示，
           * 任务/影片不再静默卡死。`COMFYAPP_BOOT_BRANCH_FAIL=<名[,名…]>` 是
           * 测试注入点（强制某分支失败，验证提示链路用）。 */
          const attempt = (): Promise<unknown> => {
            const forced = process.env.COMFYAPP_BOOT_BRANCH_FAIL?.split(",").includes(name);
            if (forced === true) {
              return Promise.reject(new Error(`注入的启动失败（${name}）`));
            }
            return FUNCTIONAL_BRANCHES.has(name) ? runBootBranchWithRetry(name, run) : run();
          };
          return attempt().then(
            () => {
              branchDoneMs.set(name, Date.now() - bootStartedAt);
            },
            (error: unknown) => {
              branchDoneMs.set(name, -1);
              console.error(
                `[boot] ${name} 启动分支失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
              );
            },
          );
        },
      );
    /* 三个 void 返回的启动器（reaper / dispatch / event-loop-watch）用块体调用：
     * 箭头简写把 void 值当返回值会被 no-confusing-void-expression 判红，
     * 而这里的语义本来就是「调一下、不等它」。 */
    const branches = [
      [
        "reaper",
        () =>
          import("./lib/comfyui/reaper").then((m) => {
            m.startReaper();
          }),
      ],
      [
        "dispatch",
        () =>
          import("./lib/comfyui/executor-dispatch").then((m) => {
            m.startDispatchLoop();
          }),
      ],
      [
        "film-resume",
        () => import("./server/film/orchestrator").then((m) => m.resumeStalledFilms()),
      ],
      [
        "event-loop-watch",
        () =>
          import("./lib/log/event-loop-watch.server").then((m) => {
            m.startEventLoopWatch();
          }),
      ],
      ["sentry", () => import("./sentry.server.config")],
    ] as const satisfies ReadonlyArray<[string, () => Promise<unknown>]>;
    void Promise.all(branches.map(([name, run]) => startBranch(name, run)))
      .then(() => {
        const detail = branches
          .map(([name]) => `${name}=${branchDoneMs.get(name) ?? "?"}ms`)
          .join(" · ");
        console.info(`[boot] 后台启动分支全部完成（并行，不阻塞服务就绪）：${detail}`);
      })
      .catch((error: unknown) => {
        console.error(`[boot] 启动分支汇总失败：${String(error)}`);
      });
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
