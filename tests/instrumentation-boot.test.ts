/**
 * instrumentation 启动分支的接线行为（ISSUE #4137）。
 *
 * `src/instrumentation.ts::register()` 是应用服务侧的启动编排：Next 在首个请求被
 * 响应**之前**会等它返回，所以它的 await 面直接决定「启动页 → 主界面」要等多久。
 * 本文件钉住它的耗时契约（不能靠读源码形状 —— 那类判据拦得住「忘了写」，拦不住
 * 「写成了串行」）：
 *   ① 串行段有且只有两步：产物根搬迁 → 流捕获（两者有先后契约）；
 *   ② 五支后台分支（reaper / dispatch / film 恢复 / 事件循环观测 / Sentry）互不依赖，
 *      **并行踢出、不阻塞 register 返回**；
 *   ③ film 恢复必须排在产物搬迁完成之后（它读镜头视频）；
 *   ④ 单支失败只记日志，不许把 register 变成拒绝（自愈/观测网失效不该拖垮首请求）。
 *
 * 七个动态 import 目标全部 vi.mock：真实模块要么 import "server-only"（在 vitest
 * 的纯 Node 环境下会 throw），要么加载即带副作用 —— 这里只验接线的时序与失败语义。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/** 七个分支目标的替身。**全部收进 vi.hoisted 并在 beforeEach 里显式重置**：
 *  vi.restoreAllMocks 只恢复 vi.spyOn 造的 spy，对模块工厂里的 vi.fn 不承担
 *  重置义务 —— 跨测试的实现残留（上一条用例塞的 deferred / 永不 resolve）会让
 *  下一条用例挂在无关的 await 上，这类红看起来像超时，实际是状态泄漏。 */
const branchFns = vi.hoisted(() => ({
  migrateLegacyArtifactRoot: vi.fn(() => Promise.resolve()),
  installStreamCapture: vi.fn(),
  startReaper: vi.fn(),
  startDispatchLoop: vi.fn(),
  resumeStalledFilms: vi.fn(() => Promise.resolve()),
  startEventLoopWatch: vi.fn(),
}));

vi.mock("../src/lib/media/artifact-root-migration.server", () => ({
  migrateLegacyArtifactRoot: branchFns.migrateLegacyArtifactRoot,
}));
vi.mock("../src/lib/log/capture-streams.server", () => ({
  installStreamCapture: branchFns.installStreamCapture,
}));
vi.mock("../src/lib/comfyui/reaper", () => ({ startReaper: branchFns.startReaper }));
vi.mock("../src/lib/comfyui/executor-dispatch", () => ({
  startDispatchLoop: branchFns.startDispatchLoop,
}));
vi.mock("../src/server/film/orchestrator", () => ({
  resumeStalledFilms: branchFns.resumeStalledFilms,
}));
vi.mock("../src/lib/log/event-loop-watch.server", () => ({
  startEventLoopWatch: branchFns.startEventLoopWatch,
}));
vi.mock("../src/sentry.server.config", () => ({}));

beforeEach(() => {
  process.env.NEXT_RUNTIME = "nodejs";
  /* 静音控制台：汇总行与失败读数走 console.*，断言时取的是 spy 本体。 */
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  /* 串行两步的默认实现必须「会完成」：搬迁 / film 恢复的真身是异步任务，
   * 替身不 resolve 的话 register 永远等不到串行段结束。 */
  branchFns.migrateLegacyArtifactRoot.mockReset();
  branchFns.migrateLegacyArtifactRoot.mockImplementation(() => Promise.resolve());
  branchFns.installStreamCapture.mockReset();
  branchFns.startReaper.mockReset();
  branchFns.startDispatchLoop.mockReset();
  branchFns.resumeStalledFilms.mockReset();
  branchFns.resumeStalledFilms.mockImplementation(() => Promise.resolve());
  branchFns.startEventLoopWatch.mockReset();
});

afterEach(() => {
  delete process.env.NEXT_RUNTIME;
  vi.restoreAllMocks();
});

/** 动态 import + then 链落在微任务里；register 的两步串行 await 各占若干跳，
 *  连排几轮宏任务把它们全部排干，别赌单跳深度。 */
const flushAsync = async (): Promise<void> => {
  for (let hop = 0; hop < 6; hop += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 这里的语义就是「逐跳排干微任务」，并行化反而排不干净
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

const loadRegister = async () => (await import("../src/instrumentation.ts")).register;

/** 永不 resolve 的替身 promise（「register 不等后台分支」那条用例的道具）。 */
const neverResolves = (): Promise<void> =>
  new Promise<void>(() => {
    /* 刻意不调 resolve：register 若等了它，用例的超时就是判决。 */
  });

describe("instrumentation register —— 启动分支的耗时契约（ISSUE #4137）", () => {
  it("串行段只有搬迁与流捕获两步；五支后台分支全部被踢出且各恰好一次", async () => {
    const register = await loadRegister();
    await register();
    await flushAsync();

    expect(branchFns.migrateLegacyArtifactRoot).toHaveBeenCalledTimes(1);
    expect(branchFns.installStreamCapture).toHaveBeenCalledTimes(1);
    expect(branchFns.startReaper).toHaveBeenCalledTimes(1);
    expect(branchFns.startDispatchLoop).toHaveBeenCalledTimes(1);
    expect(branchFns.resumeStalledFilms).toHaveBeenCalledTimes(1);
    expect(branchFns.startEventLoopWatch).toHaveBeenCalledTimes(1);
  });

  it("film 恢复排在产物搬迁之后（搬迁没完成不许读产物）", async () => {
    const register = await loadRegister();
    let resolveMigration!: () => void;
    branchFns.migrateLegacyArtifactRoot.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveMigration = resolve;
        }),
    );

    const pending = register();
    await flushAsync();
    expect(branchFns.resumeStalledFilms, "搬迁未完成时 film 恢复不许先跑").not.toHaveBeenCalled();

    resolveMigration();
    await pending;
    await flushAsync();
    expect(branchFns.resumeStalledFilms).toHaveBeenCalledTimes(1);
  });

  it("register 不等后台分支：一支永不完成也不阻塞它返回", async () => {
    const register = await loadRegister();
    branchFns.startEventLoopWatch.mockImplementation(neverResolves);

    const pending = register();
    await flushAsync();
    expect(branchFns.startEventLoopWatch, "分支已被踢出").toHaveBeenCalledTimes(1);

    // register 的 promise 若被这支分支拖住，这一 await 会一直挂到用例超时（= 红）。
    await pending;
  });

  it("流捕获先于各分支安装：并行分支的失败读数要能进面板", async () => {
    const register = await loadRegister();
    let captureCalled!: () => void;
    const captureCalledPromise = new Promise<void>((resolve) => {
      captureCalled = resolve;
    });
    branchFns.installStreamCapture.mockImplementation(() => {
      captureCalled();
    });

    const pending = register();
    await captureCalledPromise;
    expect(branchFns.startReaper, "流捕获未装好时分支不许先跑").not.toHaveBeenCalled();

    await pending;
    await flushAsync();
    expect(branchFns.startReaper).toHaveBeenCalledTimes(1);
  });

  it("单支失败只记日志：register 照常返回，其余分支照常被踢", async () => {
    const register = await loadRegister();
    const errorSpy = vi.mocked(console.error);
    branchFns.startReaper.mockImplementation(() => {
      throw new Error("boom-reaper");
    });

    await expect(register()).resolves.toBeUndefined();
    await flushAsync();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[boot] reaper 启动分支失败"));
    expect(branchFns.resumeStalledFilms).toHaveBeenCalledTimes(1);
  });

  it("edge runtime 不进任何 Node-only 分支", async () => {
    const register = await loadRegister();
    process.env.NEXT_RUNTIME = "edge";
    await register();
    await flushAsync();
    expect(branchFns.migrateLegacyArtifactRoot).not.toHaveBeenCalled();
    expect(branchFns.startReaper).not.toHaveBeenCalled();
  });
});
