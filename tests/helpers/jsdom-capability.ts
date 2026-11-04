/**
 * tests/helpers/jsdom-capability.ts — 「jsdom 没有这项能力」的唯一处置入口：jsdom 用 `not-implemented`
 * 类型的 `jsdomError` 报缺口并打进 stderr，与真出错逐字同形。口径：① 整串精确白名单才吞；② 只吞
 * `not-implemented`；③ 吞掉要报数；④ 白名单过期即按默认转发。不装 `canvas` 包：补不全绘制层还要进 `allowBuilds`。
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
 * 已登记的 jsdom 缺口，都来自 `axe-core` 要**绘制事实**时的探测：canvas 那格经 `_isIconLigature`，
 * 伪元素那格经 `getPseudoElementArea` / `hasPseudoContent`（`color-contrast`、`link-in-text-block`）。
 * 不是组件写错；规则关闭理由写在 `tests/a11y-axe-stories.test.ts`，这里只处置 axe 之外的残余噪音。
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
      const hasError = Boolean(error);
      if (!hasError || typeof error.message !== "string") {
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
 * 把处置器接到某个 jsdom window 的 `virtualConsole` 上。拿不到时返回 `null` —— 那是「这里没有
 * jsdom」（node / happy-dom 档），不是静默失败，调用方要区分（见 `tests/setup.ts` 的接线）。同一个
 * `virtualConsole` 只装一份，重复调用返回已装的那个、不重复计数。
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
