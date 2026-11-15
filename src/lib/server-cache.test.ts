// server-cache 的两条并发守卫（ISSUE #3874）：single-flight 去重并发构建、
// 构建期间被失效的结果不回填。键名按用例隔离（store 是进程级单例，不互相清）。

import { describe, expect, it, vi } from "vitest";

import { cacheDel, cacheJson } from "./server-cache";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("cacheJson single-flight（ISSUE #3874）", () => {
  it("并发未命中只构建一次，所有等待者拿到同一结果", async () => {
    const key = "t:singleflight:1";
    const build = vi.fn(async () => {
      await sleep(20);
      return { n: 42 };
    });

    const [a, b, c] = await Promise.all([
      cacheJson(key, 10_000, build),
      cacheJson(key, 10_000, build),
      cacheJson(key, 10_000, build),
    ]);

    expect(build).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ n: 42 });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("构建期间被 cacheDel 失效的结果不回填：下一拍按新数据重建", async () => {
    const key = "t:invalidate:1";
    let source = "old";
    let calls = 0;
    const build = vi.fn(() => {
      calls += 1;
      const value = source;
      if (calls === 1) {
        // 模拟「构建进行中，写侧提交并失效了缓存」：这次构建基于旧数据。
        cacheDel(key);
      }
      return value;
    });

    const first = await cacheJson(key, 10_000, build);
    expect(first).toBe("old");

    source = "new";
    const second = await cacheJson(key, 10_000, build);
    // 旧构建被失效 ⇒ 没有回填 ⇒ 第二次调用真的重建，读到新数据。
    expect(build).toHaveBeenCalledTimes(2);
    expect(second).toBe("new");
  });

  it("正常回填后命中缓存，不再重复构建", async () => {
    const key = "t:hit:1";
    const build = vi.fn(() => ({ at: 1 }));
    await cacheJson(key, 10_000, build);
    await cacheJson(key, 10_000, build);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("build 抛错不缓存：错误透传，下一次调用重新构建", async () => {
    const key = "t:error:1";
    let calls = 0;
    const build = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        throw new Error("构建失败");
      }
      return "ok";
    });

    await expect(cacheJson(key, 10_000, build)).rejects.toThrow("构建失败");
    await expect(cacheJson(key, 10_000, build)).resolves.toBe("ok");
    expect(build).toHaveBeenCalledTimes(2);
  });
});
