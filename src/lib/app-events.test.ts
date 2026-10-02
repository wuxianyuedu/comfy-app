// @vitest-environment jsdom
/**
 * 应用事件的判据（规范 16 §16.2.4.65）。
 *
 * 这条账的实质是「**同一份字面量的两端分开两处**」：事件名与载荷类型各写一份，
 * 于是写侧改名读侧认不出、写侧删掉读侧永远等不到。本文件判的是**出口的机制**
 * （带类型派发、退订配对、SSR 分支、载荷形状），而「表里每一条两端都在场」
 * 由 `tests/app-event-pairing.test.ts` 判 —— 两边合起来才是这条出口的完整承诺。
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
    const off = subscribeAppEvent("canvas:produce", () => {
      called++;
    });
    emitAppEvent("canvas:produce", { id: "n1", resultPath: "/a.png" });
    off();
    emitAppEvent("canvas:produce", { id: "n2", resultPath: "/b.png" });
    expect(called).toBe(1);
  });

  it("多个订阅者都收到（广播语义，不是单播）", () => {
    const hits: string[] = [];
    const off1 = subscribeAppEvent("canvas:produce", (p) =>
      hits.push(`a:${p.id}`),
    );
    const off2 = subscribeAppEvent("canvas:produce", (p) =>
      hits.push(`b:${p.id}`),
    );
    emitAppEvent("canvas:produce", { id: "t1", resultPath: "/x.png" });
    expect(hits.sort()).toEqual(["a:t1", "b:t1"]);
    off1();
    off2();
  });

  it("退订一次只影响自己那一个订阅", () => {
    let a = 0;
    let b = 0;
    const offA = subscribeAppEvent("canvas:produce", () => a++);
    const offB = subscribeAppEvent("canvas:produce", () => b++);
    offA();
    emitAppEvent("canvas:produce", { id: "x", resultPath: "/x.png" });
    expect(a).toBe(0);
    expect(b).toBe(1);
    offB();
  });

  it("`workspace:navigate` 的载荷是 `{ view }`（跳视图请求方与订阅方各一层）", () => {
    const seen: string[] = [];
    const off = subscribeAppEvent("workspace:navigate", (p) => {
      seen.push(p.view);
    });
    emitAppEvent("workspace:navigate", { view: "library" });
    expect(seen).toEqual(["library"]);
    off();
  });

  it("无 `window` 时订阅给一个空操作、派发直接返回（不抛错，也不排队重放）", () => {
    /* 事件是「此刻的广播」—— 补发一条上一轮的广播会让读侧拿到过期载荷。
     * jsdom 里 `window` 恒存在（见 vitest.config.ts 里对这条的说明），
     * 故用 `vi.stubGlobal` 显式抹掉它，覆盖 SSR 分支。 */
    vi.stubGlobal("window", undefined);
    try {
      const off = subscribeAppEvent("comfyapp:canvas-sync-changed", () => {
        throw new Error("不该被调用");
      });
      expect(() => off()).not.toThrow();
      expect(() => emitAppEvent("comfyapp:canvas-sync-changed")).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
