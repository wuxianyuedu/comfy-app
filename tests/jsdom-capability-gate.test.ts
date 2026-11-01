/**
 * `tests/helpers/jsdom-capability.ts` 的回归判据。
 *
 * 这份 helper 的本事是「让日志安静」，所以它最坏的失效形态恰好是**看起来最好**的那一种：
 * 吞得太宽 ⇒ 全量跑干净了，而真错误一起没了。下面每一格各钉一条吞/放的边界，
 * 变异方向也逐条写明（把哪一行改掉会红在哪一格）。
 *
 * 用 node 档不写文件头：判据面是纯函数 + 一个 `node:events` 的假 `virtualConsole`，
 * 不需要 DOM（口径见 `vitest.config.ts` 的 projects 那一段）。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  KNOWN_JSDOM_GAPS,
  createJsdomCapabilityGate,
  installJsdomCapabilityGate,
  type JsdomCapabilityController,
} from "./helpers/jsdom-capability";

const CANVAS_GAP =
  "Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package";
const PSEUDO_GAP = "Not implemented: Window's getComputedStyle() method: with pseudo-elements";

/** 造一个 jsdom 那种 `virtualConsole`（它就是 `node:events` 的 EventEmitter）。 */
function fakeVirtualConsole() {
  const emitter = new EventEmitter();
  /* 模拟 jsdom 默认那条 `forwardTo(console)` 的监听：装上之后要能看到它被摘掉。 */
  const original = vi.fn();
  emitter.on("jsdomError", original);
  return { emitter, original };
}

function scopeOf(emitter: EventEmitter) {
  return { jsdom: { virtualConsole: emitter } };
}

/** 接线并当场确认「假 virtualConsole 被认出来了」——认不出就炸在这里，而不是让
 *  后面的断言对着 `null` 报一句指不出原因的红。 */
function installOrFail(emitter: EventEmitter): JsdomCapabilityController {
  const controller = installJsdomCapabilityGate(scopeOf(emitter));
  if (!controller) {
    throw new Error("假 virtualConsole 没被认出来（readVirtualConsole 的形状与实现不符）");
  }
  return controller;
}

describe("jsdom 能力缺口的处置（精确白名单 + 计数 + 原样转发）", () => {
  it("① 台账本身不许登记「真错误」当噪音", () => {
    expect(KNOWN_JSDOM_GAPS.length).toBeGreaterThan(0);
    for (const gap of KNOWN_JSDOM_GAPS) {
      /* jsdom 的能力缺口**全部**以 `Not implemented: ` 起头（`not-implemented.js`
       * 里拼的就是这一串）。不以它起头的条目意味着有人把别的错误塞进来当噪音。 */
      expect(gap.message.startsWith("Not implemented: ")).toBe(true);
      /* 撤拦 ≠ 撤账：每条都要说清「为什么做不到」与「谁接着判」，缺一不许合。 */
      expect(gap.why.length).toBeGreaterThan(0);
      expect(gap.coveredBy.length).toBeGreaterThan(0);
    }
  });

  it("② 逐字命中才吞，并计数", () => {
    const gate = createJsdomCapabilityGate();
    expect(gate.consume({ type: "not-implemented", message: CANVAS_GAP })).toBe(true);
    expect(gate.consume({ type: "not-implemented", message: PSEUDO_GAP })).toBe(true);
    expect(gate.suppressedCount()).toBe(2);
    expect(gate.summaryLines()).toHaveLength(2);
  });

  it("③ 近亲形状不吞（缺口挪了位置是新事实，不是老噪音）", () => {
    const gate = createJsdomCapabilityGate();
    const nearMisses = [
      /* 同一个方法、换了 specialCircumstances。 */
      "Not implemented: HTMLCanvasElement's getContext() method: with a weird argument",
      /* 同一个类、换了方法（jsdom 里 `toDataURL` / `toBlob` 也走同一条通道）。 */
      "Not implemented: HTMLCanvasElement's toDataURL() method: without installing the canvas npm package",
      /* 前缀相同、缺了后半截。 */
      "Not implemented: Window's getComputedStyle() method",
      /* 大小写与空格差一个字。 */
      `${CANVAS_GAP} `,
    ];
    for (const message of nearMisses) {
      expect(gate.consume({ type: "not-implemented", message }), `这条不该被吞：${message}`).toBe(
        false,
      );
    }
    expect(gate.suppressedCount()).toBe(0);
    expect(gate.summaryLines()).toEqual([]);
  });

  it("④ 只有 not-implemented 那一档有资格被吞；真异常一律转发", () => {
    const gate = createJsdomCapabilityGate();
    /* message 逐字等于白名单，但 type 不是能力缺口 ⇒ 不许吞。 */
    expect(gate.consume({ type: "unhandled-exception", message: CANVAS_GAP })).toBe(false);
    /* 没有 type（jsdom 的资源加载失败那一类走的是别的 type 或没有）⇒ 不许吞。 */
    expect(gate.consume({ message: PSEUDO_GAP })).toBe(false);
    /* 形状不对的输入（不是对象 / message 不是串）不许把处置器本身弄炸。 */
    expect(
      gate.consume({
        type: "not-implemented",
        /* SAFETY: 类型断言已复核 */
        message: 42 as unknown as string,
      }),
    ).toBe(false);
    expect(gate.suppressedCount()).toBe(0);
  });

  it("⑤ 汇总行给得出下一步（哪条、几次、为什么、覆盖落在哪儿）", () => {
    const gate = createJsdomCapabilityGate();
    gate.consume({ type: "not-implemented", message: CANVAS_GAP });
    gate.consume({ type: "not-implemented", message: CANVAS_GAP });
    const lines = gate.summaryLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("抑制 2 条");
    expect(lines[0]).toContain(CANVAS_GAP);
    expect(lines[0]).toContain("为什么");
    expect(lines[0]).toContain("覆盖落在哪儿");
  });

  it("⑥ 装上之后：白名单内不发声音，白名单外逐字转发", () => {
    const { emitter, original } = fakeVirtualConsole();
    const controller = installOrFail(emitter);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    emitter.emit("jsdomError", {
      type: "not-implemented",
      message: CANVAS_GAP,
    });
    /* jsdom 原本那条 `forwardTo` 监听必须被摘掉，否则同一条会打两遍。 */
    expect(original).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    /* 不在白名单里的能力缺口 ⇒ 转发，且打的是 `message` 原文（不是整个 Error 对象，
     * 也不是加了前缀的形状 —— stderr 里前后形状要能对上 jsdom 自己的输出）。 */
    emitter.emit("jsdomError", {
      type: "not-implemented",
      message: "Not implemented: something brand new",
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe("Not implemented: something brand new");

    /* 未捕获异常那一支：jsdom 默认打 `cause.stack`，转发面不许改成 message。 */
    emitter.emit("jsdomError", {
      type: "unhandled-exception",
      message: "boom",
      cause: { stack: "Error: boom\n    at …" },
    });
    expect(errorSpy).toHaveBeenLastCalledWith("Error: boom\n    at …");

    expect(controller.suppressedCount()).toBe(1);
    errorSpy.mockRestore();
    controller.detach();
  });

  it("⑦ detach 之后恢复 jsdom 默认通道", () => {
    const { emitter, original } = fakeVirtualConsole();
    installOrFail(emitter).detach();
    emitter.emit("jsdomError", {
      type: "not-implemented",
      message: CANVAS_GAP,
    });
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("⑧ 同一个 virtualConsole 只装一份（重复接线不重复计数）", () => {
    const { emitter } = fakeVirtualConsole();
    const first = installOrFail(emitter);
    /* vitest 的两条挂载路径（`globalThis.jsdom` 与 `window.jsdom`）指向同一个实例，
     * setup 与用例各装一次也不能变成两个处置器。 */
    const second = installJsdomCapabilityGate({
      window: { jsdom: { virtualConsole: emitter } },
    });
    expect(second).toBe(first);

    emitter.emit("jsdomError", {
      type: "not-implemented",
      message: CANVAS_GAP,
    });
    expect(first.suppressedCount()).toBe(1);
    first.detach();
  });

  it("⑨ 没有 jsdom 的那些档返回 null，而不是炸掉 setup", () => {
    expect(installJsdomCapabilityGate(undefined)).toBeNull();
    expect(installJsdomCapabilityGate({})).toBeNull();
    expect(installJsdomCapabilityGate({ jsdom: {} })).toBeNull();
  });
});
