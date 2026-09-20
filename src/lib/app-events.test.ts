// @vitest-environment jsdom
/**
 * 应用事件的判据（规范 16 §16.2.4.65）。
 *
 * 这条账的实质是「**同一份字面量的两端分开两处**」：事件名与载荷类型各写一份，
 * 于是写侧改名读侧认不出、写侧删掉读侧永远等不到（`open-task` 与
 * `comfyapp:local-workflows-path-changed` 就是两条**死监听** ——
 * 没有任何构建 / 测试会报它们）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { emitAppEvent, subscribeAppEvent } from "./app-events";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("emitAppEvent / subscribeAppEvent", () => {
  it("带载荷的事件，读侧拿到同一个对象", () => {
    const seen: Array<{ id: string; resultPath: string }> = [];
    const off = subscribeAppEvent("canvas:produce", (p) => seen.push(p));
    emitAppEvent("canvas:produce", { id: "n1", resultPath: "/tmp/a.png" });
    expect(seen).toEqual([{ id: "n1", resultPath: "/tmp/a.png" }]);
    off();
  });

  it("无载荷的事件派发普通 `Event`（读侧拿到 `undefined`）", () => {
    let called = 0;
    const off = subscribeAppEvent("comfyapp:canvas-store-changed", () => {
      called++;
    });
    emitAppEvent("comfyapp:canvas-store-changed");
    expect(called).toBe(1);
    off();
  });

  it("退订之后不再收到（返回的退订函数与 `addEventListener` 配对）", () => {
    let called = 0;
    const off = subscribeAppEvent("custom-nodes:updated", () => {
      called++;
    });
    emitAppEvent("custom-nodes:updated", { count: 1 });
    off();
    emitAppEvent("custom-nodes:updated", { count: 2 });
    expect(called).toBe(1);
  });

  it("多个订阅者都收到（广播语义，不是单播）", () => {
    const hits: string[] = [];
    const off1 = subscribeAppEvent("open-task", (id) => hits.push(`a:${id}`));
    const off2 = subscribeAppEvent("open-task", (id) => hits.push(`b:${id}`));
    emitAppEvent("open-task", "t1");
    expect(hits.sort()).toEqual(["a:t1", "b:t1"]);
    off1();
    off2();
  });

  it("退订一次只影响自己那一个订阅", () => {
    let a = 0;
    let b = 0;
    const offA = subscribeAppEvent("open-task", () => a++);
    const offB = subscribeAppEvent("open-task", () => b++);
    offA();
    emitAppEvent("open-task", "x");
    expect(a).toBe(0);
    expect(b).toBe(1);
    offB();
  });

  it("无 `window` 时订阅给一个空操作、派发直接返回（不抛错，也不排队重放）", () => {
    /* 事件是「此刻的广播」—— 补发一条上一轮的广播会让读侧拿到过期载荷。
     * jsdom 里 `window` 恒存在（见 vitest.config.ts 里对这条的说明），
     * 故用 `vi.stubGlobal` 显式抹掉它，覆盖 SSR 分支。 */
    vi.stubGlobal("window", undefined);
    try {
      const off = subscribeAppEvent("open-task", () => {
        throw new Error("不该被调用");
      });
      expect(() => off()).not.toThrow();
      expect(() => emitAppEvent("open-task", "x")).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
