// AsyncMutex / KeyedAsyncMutex 的判据：同一把锁上「先读 → 判断 → 写」序列
// 不交叠（审计 #3832 一族的地基）；前一个失败不堵后一个；不同 key 之间不互斥。
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
});
