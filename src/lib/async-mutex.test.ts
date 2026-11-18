// AsyncMutex / KeyedAsyncMutex 的判据：同一把锁上「先读 → 判断 → 写」序列
// 不交叠（审计 #3832 一族的地基）；前一个失败不堵后一个；不同 key 之间不互斥；
// 同步重入立即抛错而不是静默死锁（#4350），await 之后的再入按排队处理不误伤。
import { describe, expect, it } from "vitest";

import { AsyncMutex, KeyedAsyncMutex } from "./async-mutex";

describe("AsyncMutex", () => {
  it("同一把锁上排队执行：前一段落定之前，后一段不开始", async () => {
    const mutex = new AsyncMutex();
    const order: Array<string> = [];
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = mutex.run(async () => {
      order.push("first-start");
      await gate;
      order.push("first-end");
      return 1;
    });
    const second = mutex.run(() => {
      order.push("second-start");
      return Promise.resolve(2);
    });

    // 第一段还卡在 gate 上：第二段不许已经开始（这正是「读-判断-写」要的互斥）。
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);

    releaseFirst!();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("前一个失败：异常原样透传给那次调用，且不堵后一个", async () => {
    const mutex = new AsyncMutex();
    await expect(mutex.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(mutex.run(() => Promise.resolve("next"))).resolves.toBe("next");
  });
});

describe("KeyedAsyncMutex", () => {
  it("不同 key 之间不互斥，同 key 串行", async () => {
    const mutex = new KeyedAsyncMutex();
    const started: Array<string> = [];
    let releaseA: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a1 = mutex.run("a", async () => {
      started.push("a1");
      await gate;
    });
    const a2 = mutex.run("a", () => {
      started.push("a2");
      return Promise.resolve();
    });
    const b1 = mutex.run("b", () => {
      started.push("b1");
      return Promise.resolve();
    });

    await Promise.resolve();
    // a1 卡住只挡 a2；b1 是另一把锁，不受影响。
    expect(started).toEqual(["a1", "b1"]);

    releaseA!();
    await Promise.all([a1, a2, b1]);
    expect(started).toEqual(["a1", "b1", "a2"]);
  });

  it("key 空闲后自动回收，后续同 key 仍可正常串行", async () => {
    const mutex = new KeyedAsyncMutex();
    await mutex.run("k", () => Promise.resolve(1));
    await Promise.resolve();
    expect(mutex.keyCount).toBe(0);

    const order: Array<string> = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = mutex.run("k", async () => {
      order.push("first");
      await gate;
    });
    const second = mutex.run("k", () => {
      order.push("second");
      return Promise.resolve();
    });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    expect(mutex.keyCount).toBe(1);
    release!();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
    await Promise.resolve();
    expect(mutex.keyCount).toBe(0);
  });
});

describe("重入护栏（ISSUE #4350）", () => {
  it("fn 同步段内再调 run：立即同步抛错，而不是静默排到自己后面", async () => {
    const mutex = new AsyncMutex();
    let caught: unknown;
    const outer = mutex.run(() => {
      try {
        // void 仅标记「刻意不接 promise」；run 在排队前就同步抛错，异常照常被 catch 接住。
        void mutex.run(() => Promise.resolve("inner"));
      } catch (error) {
        caught = error;
      }
      return Promise.resolve("outer");
    });
    // 外层照常落定：护栏抛的是「这次再入」的错，不连坐外层已接住的情况。
    await expect(outer).resolves.toBe("outer");
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain("重入");
  });

  it("同步重入不接住：错误沿外层 run 透传，且锁不因此坏死", async () => {
    const mutex = new AsyncMutex();
    const outer = mutex.run(() => mutex.run(() => Promise.resolve("inner")));
    await expect(outer).rejects.toThrow(/重入/);
    // 护栏抛错发生在排队之前，链上没有留下半态：后续调用照常。
    await expect(mutex.run(() => Promise.resolve("next"))).resolves.toBe("next");
  });

  it("await 之后再调 run 按排队处理（护栏不误伤并发排队）", async () => {
    const mutex = new AsyncMutex();
    const order: Array<string> = [];
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let inner: Promise<number> | undefined;

    const outer = mutex.run(async () => {
      order.push("outer-start");
      await gate;
      // fn 已让出控制权：此刻的 run 与「别的调用方正常排队」不可区分，必须放行。
      // （此时若 await inner 即为契约禁止的异步重入——静默死锁，见文件头。）
      inner = mutex.run(() => {
        order.push("inner");
        return Promise.resolve(2);
      });
      releaseGate!();
    });
    releaseGate!();
    await outer;
    await expect(inner!).resolves.toBe(2);
    expect(order).toEqual(["outer-start", "inner"]);
  });

  it("KeyedAsyncMutex：同 key 同步重入抛错且 key 照常回收；不同 key 不算重入", async () => {
    const mutex = new KeyedAsyncMutex();
    const same = mutex.run("k", () => mutex.run("k", () => Promise.resolve(1)));
    await expect(same).rejects.toThrow(/重入/);
    await Promise.resolve();
    // 抛错路径上 pending 也要归零：key 不能因为一次重入而永久驻留。
    expect(mutex.keyCount).toBe(0);

    const other = mutex.run("a", () => mutex.run("b", () => Promise.resolve(2)));
    await expect(other).resolves.toBe(2);
  });
});
