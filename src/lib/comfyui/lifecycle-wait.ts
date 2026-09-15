/* ── lifecycle 的等待原语与事件回调（ISSUE #570 第 1~3 项）────────────
 *
 * `lifecycle.ts` 的 `ensureComfyUiReady` 曾是一个 405 行函数，内部又塞了一个
 * 288 行的 IIFE 与三个不可测的事件回调。真正的病根是**两条等待循环同构**
 * （keepAlive 与 bound 各自实现「探测就绪 → 判死 → 超时收尾」），以及**回调
 * 闭包捕获宿主状态**导致只能起真进程才能验证。
 *
 * 本模块把这两件事抽出来，判据是**能不能在测试里直接调它**：
 *
 *   1. `waitForComfyReady(opts)` —— 单一等待循环，两条启动路径只注入差异
 *      （探测方式 `probe`、判死方式 `isDead`、早退理由 `earlyExit`）；
 *      超时文案**收敛到一处**（此前 keepAlive / bound 各写了一份逐字相同的）。
 *   2. `createOutputSink(deps)` —— stdout/stderr 的「appendRuntimeLog + 留底」
 *      回调，宿主状态显式传参，无需真实子进程即可单测。
 *   3. `createRecentOutputLedger()` / `createChildExitHandler(deps)` ——
 *      「进程秒退」时提取可行动报错的留底与退出回调。
 *
 * 为什么单开文件而不是塞回 `lifecycle-derive.ts`：derive 是**纯判决表**
 * （输入事实 → 输出结论，无 IO）；这里带时钟与轮询（`sleep` / `deadline`），
 * 但 IO 一律经参数注入，所以同样可测。两者混在一起会让「纯函数」这条边界
 * 失守。
 */

/** 就绪探测：返回可达 base（不可达为 null）。 */
export type ComfyProbe = () => Promise<string | null>;
/** 判死：返回 true 表示进程已确定不会起来（保活进程未出现 / 子进程消失）。 */
export type ComfyDeadCheck = () => Promise<boolean>;

export interface WaitForComfyReadyOpts {
  /** 探测一次是否就绪。 */
  probe: ComfyProbe;
  /** 判死探测；返回非 null 表示「已判死」，其值为可行动的失败文案。 */
  isDead: () => Promise<string | null>;
  /** 每次轮询前的早退理由；返回非 null 立即结束（用户手动关闭 / 子进程消失）。 */
  earlyExit?: () => { ok: false; base: null; detail: string } | null;
  /** 硬超时绝对时间戳（null = 不设硬超时，一直等）。 */
  deadline: number | null;
  /** 超时未就绪时的可行动文案（**唯一一处**，两条路径共用）。 */
  timeoutDetail: string;
  /** 轮询间隔（默认 2000ms，与既有行为一致）。 */
  intervalMs?: number;
  /** 就绪时返回的 detail 文案（默认「ComfyUI 已启动并就绪」）。 */
  readyDetail?: string;
  /** 就绪时进入日志（成功文案由调用方决定，如「保活」后缀）。 */
  onReady?: (base: string) => void;
  /** 判死时进入日志。 */
  onDead?: (detail: string) => void;
}

export interface WaitReadyResult {
  ok: boolean;
  base: string | null;
  detail: string;
}

/**
 * 单一等待循环：拉起之后「等到就绪 / 等到判死 / 等到超时」。
 *
 * 循环体只有一份，keepAlive 与 bound 的差别全在注入的 `probe` 与 `isDead`：
 *
 * ```ts
 * // keepAlive：端口实探 + 限频查进程表判死
 * await waitForComfyReady({ probe: () => probeComfyUi(2000),
 *                           isDead: async () => (await findPidForMainPy(mainPy)) ? null : "…",
 *                           … });
 * // bound：已知子进程 PID → 探它监听的端口 + /system_stats
 * await waitForComfyReady({ probe: () => probeChildReady(child), … });
 * ```
 *
 * 这就是 `lifecycle-derive.ts` 判决表同一手法的延伸：把「怎么探」与
 * 「怎么判」变成参数，循环本身可被逐条测试锁住（不必起真进程）。
 */
export async function waitForComfyReady(
  opts: WaitForComfyReadyOpts,
): Promise<WaitReadyResult> {
  const interval = opts.intervalMs ?? 2000;
  for (;;) {
    const exit = opts.earlyExit?.();
    if (exit) return exit;

    const dead = await opts.isDead();
    if (dead !== null) {
      opts.onDead?.(dead);
      return { ok: false, base: null, detail: dead };
    }

    const base = await opts.probe();
    if (base !== null) {
      opts.onReady?.(base);
      return {
        ok: true,
        base,
        detail: opts.readyDetail ?? "ComfyUI 已启动并就绪",
      };
    }

    if (opts.deadline !== null && Date.now() >= opts.deadline) break;
    await sleep(interval);
  }
  return { ok: false, base: null, detail: opts.timeoutDetail };
}

/** 可注入的睡眠（默认真 sleep；测试传入立即返回的桩以不等待）。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── 事件回调（可测的具名纯函数）────────────────────────────────────── */

export interface OutputSinkDeps {
  /** 把一行原文追加进运行日志（带 `[out]` / `[err]` 前缀）。 */
  appendRuntimeLog: (line: string) => void;
  /** 留底一行（供进程秒退时提取可行动报错）。 */
  pushRecent: (text: string) => void;
  /** 单行截断上限（默认 500，与既有行为一致）。 */
  maxLineChars?: number;
}

/**
 * 构造 stdout/stderr 的 `data` 回调。
 *
 * 此前这三段是闭包内联的，捕获 `recentOutput` / `appendRuntimeLog` 等宿主状态，
 * 于是「输出截断到 500 字符」「留底上限 60 行」这些行为**只能起真进程验证**。
 * 现在依赖显式传参，回调可直接调用断言：
 *
 * ```ts
 * const lines: string[] = [];
 * const sink = createOutputSink({ appendRuntimeLog: (l) => lines.push(l),
 *                                 pushRecent: (t) => recent.push(t) });
 * sink(Buffer.from("a".repeat(600)));
 * expect(lines[0]).toContain("…");  // 已截断
 * ```
 */
export function createOutputSink(
  deps: OutputSinkDeps,
): (chunk: Buffer | string) => void {
  const cap = deps.maxLineChars ?? 500;
  return (chunk: Buffer | string) => {
    const text = chunk.toString().trimEnd().slice(0, cap);
    deps.appendRuntimeLog(`[out] ${text}`);
    deps.pushRecent(text);
  };
}

/** 行留底账本：按行累积、超出 `maxLines` 丢弃最旧。 */
export interface RecentOutputLedger {
  lines: string[];
  push: (text: string) => void;
}

/** 留底账本（默认上限 60 行，与既有行为一致）。 */
export function createRecentOutputLedger(maxLines = 60): RecentOutputLedger {
  const lines: string[] = [];
  return {
    lines,
    push(text: string) {
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lines.push(trimmed);
        while (lines.length > maxLines) lines.shift();
      }
    },
  };
}

export interface ChildExitDeps {
  /** 进程退出时的会话结束横幅文案（含 ANSI）。 */
  banner: (code: number | null) => string;
  /** 写会话横幅。 */
  appendSessionBanner: (banner: string) => void;
  /** 进入日志。 */
  log: (msg: string) => void;
  /** 清掉宿主持有的子进程句柄（仅当仍是同一个 child 时）。 */
  clearChild: () => void;
}

/**
 * 构造 `child.on("exit")` 回调：落会话结束横幅 + 清句柄。
 * 依赖显式传参后可直接单测，不必起真进程。
 */
export function createChildExitHandler(
  deps: ChildExitDeps,
): (code: number | null) => void {
  return (code: number | null) => {
    deps.appendSessionBanner(deps.banner(code));
    deps.log(`ComfyUI 进程退出（code=${code ?? "null"}）`);
    deps.clearChild();
  };
}
