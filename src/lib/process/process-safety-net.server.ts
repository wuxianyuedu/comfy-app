/**
 * 进程级兜底（`unhandledRejection` / `uncaughtException`）的安装器与记账器。
 *
 * 为什么从 `src/instrumentation.ts` 拆成独立的 `.server.ts`（ISSUE #4568）：
 * instrumentation 会被 Next 按 **Node / Edge 两种 runtime 各编译一份**，而
 * `process.on` 这个 Node API 只要写在 instrumentation 本体里，Edge 编译面也会
 * 静态看到它 —— 即使调用点在 `NEXT_RUNTIME === "nodejs"` 分支内（该分支在 Edge
 * 产物里被死代码消除，但源码级的 API 引用仍在编译单元里），于是每次编译都在
 * stderr 刷「A Node.js API is used (process.on) which is not supported in the
 * Edge Runtime」+「Ecmascript file had an error」。挪进本模块、经 nodejs 分支
 * **动态 import** 后，它只存在于 Node 编译图 —— 与 instrumentation 里其余
 * Node-only 分件（capture-streams / event-loop-watch / boot-branches）同一形态。
 *
 * 策略与既有有效行为一致：**只记日志、不退出** —— 常驻桌面服务里，一条后台循环
 * （成片监看 / 派发 / reaper）的 rejection 不该打挂整个应用。此前这层只来自
 * `@sentry/node` 默认集成的隐式副作用（且 `scripts/executor-host.mjs` 等宿主进程
 * 没有这层）；显式化之后，谁起服务谁就有这张网（ISSUE #4216）。
 */

/** 进程级兜底是否已挂（幂等闸：register 可能被 Next 以不同 runtime 多次触发）。 */
let processSafetyNetInstalled = false;

/** 同一条消息的重复记账：首 3 条全量记，之后每 50 条记一条——周期循环里的
 *  每拍异常不再把日志文件灌满（ISSUE #4256）。 */
const SAFETY_NET_REPEAT_EVERY = 50;

/** 洪水防护去重表的条目上限（ISSUE #4338）。键是完整异常文本（含 stack），
 *  故障态下后台循环每拍抛出的变体（不同 id / 路径 / SQL 片段）各占一条长键；
 *  不设上限时键数随变体数无界增长，常驻数周的桌面进程内存缓慢上涨。
 *  封顶后淘汰「最久未重复」的冷变体键；持续重复的热键每次命中都刷新位次、
 *  不会被挤掉，限频记账不中断。 */
export const SAFETY_NET_MAX_KEYS = 512;

/** 洪水防护的记账器（去重 + 限频 + 封顶）。独立成工厂是为了单测能直接断言
 *  「键数封顶 / 热键不被冷变体洪水挤掉」，不必真挂进程级监听器。 */
export type SafetyNetReporter = {
  report: (kind: string, reason: unknown) => void;
  /** 当前驻留的去重键数（恒 ≤ SAFETY_NET_MAX_KEYS）。 */
  readonly size: number;
};

export function createSafetyNetReporter(): SafetyNetReporter {
  const describe = (reason: unknown): string =>
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  const counts = new Map<string, number>();
  return {
    get size(): number {
      return counts.size;
    },
    report: (kind: string, reason: unknown): void => {
      const text = describe(reason);
      const count = (counts.get(text) ?? 0) + 1;
      /* LRU 触碰（与 runner-state 的 touchAndEvict 同一形态）：Map 迭代序=插入序、
       * 对已存在的键 set 不改位次，所以先 delete 再 set 刷新「最近使用」；
       * 超限时淘汰迭代器首项（最久未用）。 */
      counts.delete(text);
      counts.set(text, count);
      while (counts.size > SAFETY_NET_MAX_KEYS) {
        const oldest = counts.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        counts.delete(oldest);
      }
      if (count <= 3 || count % SAFETY_NET_REPEAT_EVERY === 0) {
        console.error(`[process] ${kind}#${count}：${text}`);
      }
    },
  };
}

/**
 * 显式注册 `unhandledRejection` / `uncaughtException` 的进程级兜底（ISSUE #4216）。
 * 洪水防护（ISSUE #4256）：同一 message 的重复异常只记首 3 条、之后每 50 条记
 * 一条（带累计序号）；去重表封顶 SAFETY_NET_MAX_KEYS 条、LRU 淘汰（ISSUE #4338），
 * 长生命周期进程不再随异常变体数无界增长。
 * 导出仅为可测（注册是进程级副作用，用例直接调用并断言监听器挂载与输出）。
 */
export function installProcessSafetyNet(): void {
  if (processSafetyNetInstalled) {
    return;
  }
  processSafetyNetInstalled = true;
  const reporter = createSafetyNetReporter();
  process.on("unhandledRejection", (reason: unknown) => {
    reporter.report("unhandledRejection", reason);
  });
  process.on("uncaughtException", (error: Error) => {
    reporter.report("uncaughtException", error);
  });
}
