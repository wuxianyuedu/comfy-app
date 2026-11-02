/**
 * tests/helpers/jsdom-capability.ts — 「jsdom 没有这项能力」的唯一处置入口。
 *
 * ── 这一档补的是哪一格 ─────────────────────────────────────
 *
 * jsdom 对超出自己实现范围的东西**不抛异常**，而是走 `VirtualConsole` 发一条
 * `type: "not-implemented"` 的 `jsdomError`；默认那条通道（`api.js` 里
 * `new VirtualConsole().forwardTo(console)`）把它原样打进 stderr。于是
 * 「宿主缺能力」与「被测代码真出错」在日志里**逐字同形**（都是 `stderr | 文件 > 用例`），
 * 全量跑那一跑的读数被这两行占掉，而真错反而混在里面看不出来。
 *
 * ── 四条口径 ───────────────────────────────────────────────
 *
 * ① **精确白名单，整串相等才吞**。`error.message` 必须与 `KNOWN_JSDOM_GAPS` 里某条
 *    逐字相同。近亲形状（同一个 `getContext` 换了 `specialCircumstances`、或换成
 *    `toDataURL` / `toBlob` 那一档）**不吞** —— 那说明缺口挪了位置，是新事实，
 *    不是老噪音；按前缀吞就等于把「以后所有 canvas 相关的报错」一起关掉。
 * ② **只吞 `type === "not-implemented"`**。资源加载失败、样式表解析失败、未捕获异常
 *    带的是别的 type（或没有），一律按 jsdom 默认形态转发（含 `unhandled-exception`
 *    打 `cause.stack` 那一支）。
 * ③ **吞掉要报数**。每份文件结束时打一行汇总：哪条、几次、为什么、以及这一档的覆盖
 *    真正落在哪儿。没有这一行，「安静」与「被人关掉了」在日志里同形。
 * ④ **白名单过期时自己会响**。jsdom 升级改了那串原文，`consume` 就匹配不上、于是按
 *    默认形态把它转发出来 —— 日志里当场看得见，人据此改表。这比再加一条
 *    「登记了却没命中」的判据准：处置器是**每份文件一份**，某条只在别的文件里被踩到，
 *    在这一份里必然「未命中」，那种判据只会误报一片。
 *
 * ── 为什么不装 `canvas` 那个原生包 ─────────────────────────
 *
 * 它只补 `getContext` 这一格，伪元素的 `getComputedStyle` 照旧没有；而这两格问的都是
 * **真实绘制**（字体度量、`::before` 的 `content`）。业主的口径是「这种情况就别用
 * jsdom」—— 正解是让 jsdom 不判绘制层（`tests/a11y-axe-stories.test.ts` 的
 * `PAINT_SCOPE_RULES_OFF` 逐条点名并写明理由），而不是给它装一件原生件让它
 * 「判得更像真的」。顺带一条代价：原生包要进 `pnpm-workspace.yaml` 的 `allowBuilds`
 * （AGENTS 硬规则 8），为两行日志付这个代价不划算。
 */

/** jsdom 发出的错误对象（只声明本文件用到的那几个字段，不依赖 jsdom 的类型包）。 */
type JsdomErrorLike = {
  cause?: { stack?: string };
  message: string;
  type?: string;
};

/** `jsdom.virtualConsole` 的结构面（它继承 `node:events` 的 EventEmitter）。 */
type VirtualConsoleLike = {
  listeners(event: string): Array<unknown>;
  on(event: string, listener: (error: JsdomErrorLike) => void): unknown;
  removeAllListeners(event: string): unknown;
};

export type JsdomCapabilityGap = {
  /** 撤拦 ≠ 撤账：这一档的覆盖真正落在哪儿。 */
  coveredBy: string;
  /** jsdom 的原文，**逐字相等**才吞（见文件头第 ① 条）。 */
  message: string;
  /** 为什么 jsdom 做不到这件事。 */
  why: string;
};

/**
 * 已登记的 jsdom 能力缺口。两条都是 `axe-core` 在要**绘制事实**时踩到的：
 *
 * - canvas 那一格来自 `_isIconLigature`（拿 2d 上下文量「这段文本是不是字体图标连字」），
 *   调用点是 `color-contrast` 的 matches（经 `hasRealTextChildren`）与
 *   `label-content-name-mismatch`（经 `visibleVirtual({ ignoreIconLigature: true })`）；
 * - 伪元素那一格来自 `getPseudoElementArea` / `hasPseudoContent`，调用点是
 *   `color-contrast` 与 `link-in-text-block`。
 *
 * 也就是说这两行**不是某个组件写错了**，而是这三条规则在 jsdom 里必然踩到的探测。
 * 规则的关闭与理由写在 `tests/a11y-axe-stories.test.ts`，这里只处置**残余**噪音
 * （axe 之外也有代码走到这两条通道时，仍按白名单吞、并计数报出来）。
 */
export const KNOWN_JSDOM_GAPS: ReadonlyArray<JsdomCapabilityGap> = [
  {
    message:
      "Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package",
    why: "jsdom 不带字体度量：`getContext` 只有在装了原生 `canvas` 包时才有实现，否则直接回 `null`。",
    coveredBy:
      "连字 / 图标度量这一档由 Storybook 的 a11y 面板（真浏览器，有度量）现场判；axe 侧的两条规则已在 a11y 用例里点名关掉。",
  },
  {
    message: "Not implemented: Window's getComputedStyle() method: with pseudo-elements",
    why: "jsdom 的 `getComputedStyle` 只实现了无伪元素那一档（`Window.js` 对第二参非空直接 notImplemented），而 `::before/::after` 的 `content` 正是它要读的。",
    coveredBy:
      "伪元素绘制由 Storybook 的 a11y 面板（真浏览器，CSS 生效）现场判；axe 侧的相关规则已在 a11y 用例里点名关掉。",
  },
];

export type JsdomCapabilityController = {
  /** 处置一条 `jsdomError`：按白名单吞掉并计数返回 `true`，需要转发返回 `false`。 */
  consume: (error: JsdomErrorLike) => boolean;
  /** 还原 jsdom 原本的 `jsdomError` 监听。 */
  detach: () => void;
  /** 汇总行；一条都没吞过则是空数组（不打「0 条」那种废话）。 */
  summaryLines: () => Array<string>;
  /** 已吞掉的条数（全部缺口相加）。 */
  suppressedCount: () => number;
};

/**
 * 纯函数那一层：给定白名单，产出一个可单测的处置器。
 * 转发与否的判据全在这里，`VirtualConsole` 只是它的一个消费者。
 */
export function createJsdomCapabilityGate(
  gaps: ReadonlyArray<JsdomCapabilityGap> = KNOWN_JSDOM_GAPS,
): JsdomCapabilityController {
  const byMessage = new Map(gaps.map((gap) => [gap.message, gap]));
  const counts = new Map<string, number>();
  let suppressed = 0;

  return {
    consume(error) {
      if (!error || typeof error.message !== "string") {
        return false;
      }
      /* 第 ② 条口径：只有 jsdom 自己那条「能力缺口」通道有资格被吞。 */
      if (error.type !== "not-implemented") {
        return false;
      }
      const gap = byMessage.get(error.message);
      if (!gap) {
        return false;
      }
      counts.set(gap.message, (counts.get(gap.message) ?? 0) + 1);
      suppressed += 1;
      return true;
    },
    suppressedCount: () => suppressed,
    /* 按白名单登记的顺序出汇总（而不是按「第一次被踩到的先后」）—— 台账要每次一样，
     * 否则同一轮跑两次给出两份逐字不同的汇总，就没法据它核对。 */
    summaryLines: () =>
      gaps
        .filter((gap) => counts.has(gap.message))
        .map(
          (gap) =>
            `[jsdom 能力缺口] 抑制 ${counts.get(gap.message) ?? 0} 条：${gap.message}\n  为什么：${gap.why}\n  覆盖落在哪儿：${gap.coveredBy}`,
        ),
    detach: () => undefined,
  };
}

/** 已装过处置器的 `virtualConsole`（同一实例只装一份，重复调用返回同一个）。 */
const installed = new WeakMap<VirtualConsoleLike, JsdomCapabilityController>();

/**
 * 把处置器接到某个 jsdom window 的 `virtualConsole` 上。
 *
 * 拿不到 `virtualConsole` 时返回 `null` —— 那是「这里没有 jsdom」（node / happy-dom
 * 档），不是「静默失败」；调用方要区分这两件事，见 `tests/setup.ts` 的接线。
 * 同一个 `virtualConsole` 只装一份（重复调用返回已装的那个，不重复计数）。
 */
export function installJsdomCapabilityGate(
  scope: unknown,
  gaps: ReadonlyArray<JsdomCapabilityGap> = KNOWN_JSDOM_GAPS,
): JsdomCapabilityController | null {
  const console_ = readVirtualConsole(scope);
  if (!console_) {
    return null;
  }
  const existing = installed.get(console_);
  if (existing) {
    return existing;
  }

  const gate = createJsdomCapabilityGate(gaps);
  /* 摘掉 jsdom 默认那条 `forwardTo` 的 `jsdomError` 监听，换成我们的处置器。
   * 其余事件（`log` / `warn` / `error`…）一个都不动 —— 那还是原样转发。 */
  const originals = console_.listeners("jsdomError");
  console_.removeAllListeners("jsdomError");
  console_.on("jsdomError", (error) => {
    if (gate.consume(error)) {
      return;
    }
    /* 逐字复现 jsdom 的默认转发形态（`virtual-console.js` 的 `forward`）：
     * 未捕获异常打 `cause.stack`，其余打 `message`。不是打整个 Error 对象 ——
     * 那会把 stderr 的形状改掉。 */
    if (error.type === "unhandled-exception") {
      console.error(error.cause?.stack ?? error.message);
    } else {
      console.error(error.message);
    }
  });

  const controller: JsdomCapabilityController = {
    ...gate,
    detach: () => {
      console_.removeAllListeners("jsdomError");
      for (const listener of originals) {
        /* SAFETY: 类型断言已复核 */
        console_.on("jsdomError", listener as (error: JsdomErrorLike) => void);
      }
      installed.delete(console_);
    },
  };
  installed.set(console_, controller);
  return controller;
}

/**
 * vitest 的 jsdom 档把 `JSDOM` 实例挂在两处：VM 路径挂 `window.jsdom`，
 * 非 VM 路径挂 `globalThis.jsdom`（`populateGlobal` 之后两边都能看到）。
 * 这里两个都试，取到的仍是同一个 `virtualConsole` 对象。
 */
function readVirtualConsole(scope: unknown): VirtualConsoleLike | null {
  if (typeof scope !== "object" || scope === null) {
    return null;
  }
  /* SAFETY: 类型断言已复核 */
  const holder = scope as {
    jsdom?: { virtualConsole?: VirtualConsoleLike };
    window?: { jsdom?: { virtualConsole?: VirtualConsoleLike } };
  };
  return holder.jsdom?.virtualConsole ?? holder.window?.jsdom?.virtualConsole ?? null;
}
