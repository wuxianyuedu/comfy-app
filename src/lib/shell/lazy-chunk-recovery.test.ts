// @vitest-environment jsdom
// @vitest-environment jsdom 的理由：判据的两端都落在浏览器对象上 —— 刷新走
// `window.location.reload()`（happy-dom 里没有可替换的 reload），「只刷一次」的
// 标记走 `localStorage`。这两者是本模块的全部行为，用假的 window 反而测不到真形态。
//
// 为什么值得单独测：这条判据的两个方向都会「静默地错」，且错法正相反——
//   · 认得太宽（把普通业务错误也当分块失败）→ 刷新一次，用户手里的操作丢了、问题还在；
//   · 认得太窄（漏掉分块失败的某一种形态）→ 这一屏永远崩。
// 而它救的正是「dev server 换了一批分块、已渲染页面还指着旧的」这一类故障，
// 在真机上要制造它成本很高。所以只把「什么算分块失败、什么时候真刷」钉死。

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  isChunkLoadFailure,
  reloadOnceForChunkError,
} from "./lazy-chunk-recovery";

/** 一个可控的 `window.location.reload` 替身（jsdom 的 reload 未实现，会抛）。 */
function stubReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  return reload;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("isChunkLoadFailure — 辨认分块加载失败", () => {
  it("认出现场那句 Turbopack 报错（ChunkLoadError + Failed to load chunk）", () => {
    const err = new Error(
      "Failed to load chunk /_next/static/chunks/node_modules__pnpm_0rl90jt._.js from module [project]/src/components/settings/SettingsView.tsx [app-client] (ecmascript, next/dynamic entry, async loader)",
    );
    err.name = "ChunkLoadError";
    expect(isChunkLoadFailure(err)).toBe(true);
  });

  it("认出 webpack 的 Loading chunk N failed / CSS chunk 两种形态", () => {
    expect(isChunkLoadFailure(new Error("Loading chunk 7 failed."))).toBe(true);
    expect(isChunkLoadFailure(new Error("Loading CSS chunk 3 failed."))).toBe(
      true,
    );
  });

  it("认出浏览器原生 ESM 形态（Firefox / Safari）", () => {
    expect(
      isChunkLoadFailure(
        new Error("Failed to fetch dynamically imported module: /x.js"),
      ),
    ).toBe(true);
  });

  it("字符串形态也认（有些边界抛的是字符串而不是 Error）", () => {
    expect(isChunkLoadFailure("Failed to load chunk /a/b.js")).toBe(true);
  });

  /* 这一组是「认得太宽」的那半边：这些错误多半是业务/服务端故障，
   * 刷新救不了，白刷一次还会把用户手里的操作丢掉。 */
  it("不把业务错误当成分块失败", () => {
    expect(isChunkLoadFailure(new Error("数据库表不存在"))).toBe(false);
    expect(isChunkLoadFailure(new Error("请求被中断"))).toBe(false);
    expect(isChunkLoadFailure(new Error("Failed to fetch"))).toBe(false);
    expect(isChunkLoadFailure(new Error("加载失败，请重试"))).toBe(false);
    expect(isChunkLoadFailure(null)).toBe(false);
    expect(isChunkLoadFailure(undefined)).toBe(false);
    expect(isChunkLoadFailure("")).toBe(false);
  });
});

describe("reloadOnceForChunkError — 命中时整页刷新一次", () => {
  it("命中分块失败 → 刷新，并返回 true", () => {
    const reload = stubReload();
    const ok = reloadOnceForChunkError(new Error("Failed to load chunk /a.js"));
    expect(ok).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("同一轮里没有第二次：刷过之后再来一条分块失败不再刷（防刷新死循环）", () => {
    vi.useFakeTimers();
    const reload = stubReload();
    expect(
      reloadOnceForChunkError(new Error("Failed to load chunk /a.js")),
    ).toBe(true);
    vi.advanceTimersByTime(59_000);
    expect(
      reloadOnceForChunkError(new Error("Failed to load chunk /b.js")),
    ).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  /* 这条钉的是「自愈不是一次性的」：标记只写不清时，第一次故障之后就永久
   * 失去自愈能力 —— 而 dev server 每重建一次都会换一批分块，那是**新的一轮**
   * 故障，该给的机会必须还给（现场症状就是「点开某一屏整屏崩、怎么点都不恢复」）。 */
  it("冷却窗口之外是新的一轮：隔得更久再撞一次仍会刷", () => {
    vi.useFakeTimers();
    const reload = stubReload();
    expect(
      reloadOnceForChunkError(new Error("Failed to load chunk /a.js")),
    ).toBe(true);
    vi.advanceTimersByTime(61_000);
    expect(
      reloadOnceForChunkError(new Error("Failed to load chunk /c.js")),
    ).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("非分块失败不刷（返回 false，错误照旧抛给 error boundary）", () => {
    const reload = stubReload();
    expect(reloadOnceForChunkError(new Error("连接被拒绝"))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("生产构建不刷：那条路径该走「产物缺件」的显式暴露，不该被刷新掩盖", () => {
    const reload = stubReload();
    vi.stubEnv("NODE_ENV", "production");
    expect(
      reloadOnceForChunkError(new Error("Failed to load chunk /a.js")),
    ).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("刷新标记写在 localStorage（跨刷新存活）—— 它是「只有一次」的判据本身", () => {
    const reload = stubReload();
    reloadOnceForChunkError(new Error("ChunkLoadError: x"));
    expect(window.localStorage.getItem("chunkReload.doneAt")).not.toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
