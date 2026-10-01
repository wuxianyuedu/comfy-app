// @vitest-environment jsdom
/**
 * 系统指标 store 的单点持有者语义（这一刀存在的理由）。
 *
 * 观测从 hook 移进 store 之后，必须钉住四件事，否则「收成单点」只是换个地方写：
 *   1. **两个订阅者共用一条轮询**（原来各挂一份 hook 就是两条独立 4s 轮询）；
 *   2. 没人订阅时不起表，最后一个退订即停表（不留「没人看还在打服务端」的白拉）；
 *   3. 快照身份稳定 —— `useSyncExternalStore` 按 `Object.is` 判等，每次新建对象
 *      会让所有订阅组件反复重渲染；
 *   4. 背压仍在：只认最新一次请求的回包，迟到的旧回包丢弃。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComfyStatsPayload } from "~/lib/comfy/comfy-stats-client";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/comfy/comfy-stats-client", () => ({
  fetchComfyStats: fetchMock,
}));

/* 进程退出事件的订阅回调（`subscribeComfyCrashes` 的替身）：jsdom 里没有
   `EventSource`，直接驱动 store 注册进来的那一个回调比造一条假连接确定。 */
const crashListeners = vi.hoisted(
  () =>
    [] as Array<
      (s: {
        seq: number;
        at: number;
        reason: string;
        userStopped: boolean;
      }) => void
    >,
);
vi.mock("~/lib/comfy/comfy-liveness-client", () => ({
  subscribeComfyCrashes: (l: (typeof crashListeners)[number]) => {
    crashListeners.push(l);
    return () => {
      const i = crashListeners.indexOf(l);
      if (i >= 0) crashListeners.splice(i, 1);
    };
  },
}));

/* 「忙不忙」的单点也桩掉：本文件测的是系统指标持有者的行为，不是那条账的语义
   （它自己的用例在 comfy-busy-store.test.ts）。 */
vi.mock("~/lib/comfy/comfy-busy-store", () => ({
  getComfyBusy: () => busyFlag.value,
}));
const busyFlag = vi.hoisted(() => ({ value: false }));

/* 记录 startPollTimer 的调用与每次返回的「停表」函数：轮询该不该起、起几条、
   什么时候停，全看这里。 */
const startCalls = vi.hoisted(() => ({ started: 0, stopped: 0 }));
vi.mock("~/lib/poll-timer", () => ({
  startPollTimer: vi.fn(() => {
    startCalls.started += 1;
    return () => {
      startCalls.stopped += 1;
    };
  }),
}));

import { startPollTimer } from "~/lib/poll-timer";

import {
  COMFY_STATS_POLL_MS,
  getComfyLivenessForTest,
  getComfyStatsServerSnapshot,
  getComfyStatsSnapshot,
  refreshComfyStats,
  resetComfyStatsStoreForTest,
  subscribeComfyStats,
} from "./comfy-stats-store";

const GIB = 1024 * 1024 * 1024;

/** 订阅占位回调（lint 不容空箭头函数，也避免每处写一遍 `{}`）。 */
function noop(): void {
  void 0;
}

function onlineStats(over: Partial<ComfyStatsPayload> = {}): ComfyStatsPayload {
  return {
    online: true,
    vramUsed: 2 * GIB,
    vramFree: 6 * GIB,
    vramTotal: 8 * GIB,
    ramUsed: 16 * GIB,
    ramTotal: 32 * GIB,
    ...over,
  };
}

const OFFLINE: ComfyStatsPayload = {
  online: false,
  vramUsed: 0,
  vramFree: 0,
  vramTotal: 0,
  ramUsed: 0,
  ramTotal: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  /* 假时钟只为「启动等待快档 → 慢档」那条换档用例（推进 11s 而不真等）；
   * 其余用例不受影响（它们不依赖真实时间流逝）。 */
  vi.useFakeTimers({ shouldAdvanceTime: true });
  startCalls.started = 0;
  startCalls.stopped = 0;
  crashListeners.length = 0;
  busyFlag.value = false;
  resetComfyStatsStoreForTest();
});

afterEach(() => {
  resetComfyStatsStoreForTest();
  vi.useRealTimers();
});

describe("单点持有者：轮询该起几条", () => {
  it("没人订阅时不起表", () => {
    expect(startCalls.started).toBe(0);
  });

  it("两个订阅者共用一条轮询；最后一个退订才停表", () => {
    const offFirst = subscribeComfyStats(noop);
    expect(startCalls.started).toBe(1);

    const offSecond = subscribeComfyStats(noop);
    /* 关键一条：第二个消费者不该再起一条轮询。 */
    expect(startCalls.started).toBe(1);

    offFirst();
    expect(startCalls.stopped).toBe(0); // 还有人订阅，不能停

    offSecond();
    expect(startCalls.stopped).toBe(1);

    /* 全部退订后再订阅，重新起一条（不是复活已经停掉的表）。 */
    subscribeComfyStats(noop)();
    expect(startCalls.started).toBe(2);
  });

  it("同一回调重复订阅两次 → 退订两次才停（不把另一方的轮询误停）", () => {
    const listener = noop;
    const offA = subscribeComfyStats(listener);
    const offB = subscribeComfyStats(listener);
    expect(startCalls.started).toBe(1);
    offA();
    expect(startCalls.stopped).toBe(0);
    offB();
    expect(startCalls.stopped).toBe(1);
  });
});

describe("快照与背压", () => {
  it("数据没变就复用同一份快照对象（订阅组件不该反复重渲染）", async () => {
    subscribeComfyStats(noop);
    const stats = onlineStats();
    fetchMock.mockResolvedValue(stats);
    await refreshComfyStats();
    const first = getComfyStatsSnapshot();
    /* 再拉一次同样的数值（同一个 stats 对象）：身份必须不变。 */
    fetchMock.mockResolvedValue(stats);
    await refreshComfyStats();
    expect(getComfyStatsSnapshot()).toBe(first);
  });

  it("数值变了才换快照身份", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValueOnce(onlineStats());
    await refreshComfyStats();
    const first = getComfyStatsSnapshot();
    fetchMock.mockResolvedValueOnce(onlineStats({ vramUsed: 5 * GIB }));
    await refreshComfyStats();
    expect(getComfyStatsSnapshot()).not.toBe(first);
    expect(getComfyStatsSnapshot().stats?.vramUsed).toBe(5 * GIB);
  });

  it("服务端快照与客户端快照同一个对象：SSR 首帧不制造第三种状态", () => {
    /* `getComfyStatsServerSnapshot` 只在 React 走 SSR 时被调用（jsdom 那一路不会），
     * 所以这条判的不是行数而是它的契约：必须与 `getComfyStatsSnapshot()` **同一身份**
     * —— `useSyncExternalStore` 按 `Object.is` 判等，服务端渲染返回一份新对象会让
     * hydration 之后立刻再渲染一次；而未观测过时它就是「无数据」那一档
     * （`stats:null / online:false / stale:false`），不能凭空造出「离线」或「连接中」。 */
    expect(getComfyStatsServerSnapshot()).toBe(getComfyStatsSnapshot());
    expect(getComfyStatsServerSnapshot()).toEqual({
      stats: null,
      online: false,
      stale: false,
      crashed: false,
    });
  });

  it("迟到的旧回包被丢弃：只认最新一次观测", async () => {
    subscribeComfyStats(noop);
    const deferred: { resolve?: (value: ComfyStatsPayload) => void } = {};
    const second = onlineStats({ vramUsed: 7 * GIB });
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<ComfyStatsPayload>((resolve) => {
            deferred.resolve = resolve;
          }),
      )
      .mockImplementationOnce(async () => second);

    const firstCall = refreshComfyStats();
    const secondCall = refreshComfyStats();
    await secondCall;
    // 第一拍迟到返回更旧的数据 —— 不该覆盖已经落定的新观测
    deferred.resolve?.(onlineStats({ vramUsed: 1 * GIB }));
    await firstCall;

    expect(getComfyStatsSnapshot().stats).toBe(second);
  });

  it("订阅者能被通知到读数变化", async () => {
    let notified = 0;
    subscribeComfyStats(() => {
      notified += 1;
    });
    fetchMock.mockResolvedValueOnce(onlineStats());
    await refreshComfyStats();
    expect(notified).toBe(1);
  });

  it("轮询动作抛错＝本轮没观测到：走同一条迟滞，不静默也不另开日志", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValueOnce(onlineStats());
    await refreshComfyStats();
    /* 直接触发一次「动作抛错」通道（不是回 offline）。要抓的是 store 有没有把
       onError 接到同一条迟滞上：一次抛错该等同「这一轮没观测到」—— 保留上一次
       好数据并打 stale。 */
    const [, options] = vi.mocked(startPollTimer).mock.calls[0] ?? [];
    const onError = options?.onError;
    if (typeof onError !== "function") {
      throw new Error("store 没把失败通道交给轮询（抛错会没人接）");
    }
    onError(new Error("bug in publish path"));
    expect(getComfyStatsSnapshot().stale).toBe(true);
    expect(getComfyStatsSnapshot().online).toBe(true); // 容忍期内不闪离线
  });

  it("提交离线后读数翻成不在线（而不是停在最后一次好数据）", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValueOnce(onlineStats());
    await refreshComfyStats();
    fetchMock.mockResolvedValue(OFFLINE);
    await refreshComfyStats(); // 容忍 1
    await refreshComfyStats(); // 容忍 2
    await refreshComfyStats(); // 第 3 次 → 提交离线
    const snapshot = getComfyStatsSnapshot();
    expect(snapshot.online).toBe(false);
    expect(snapshot.stale).toBe(false);
    /* 提交离线要翻成「明确的离线读数」，而不是留着最后一次好数据让人以为在跑。 */
    expect(snapshot.stats?.online).toBe(false);
    expect(snapshot.stats?.vramTotal).toBe(0);
  });
});

/**
 * 进程级判活：回包 `online:false` 但 `processAlive:true` 时**不是**「掉线」观测。
 * 口径与 `/api/comfy/queue` 同源（`queue-status.server.ts` 的快照回落）——进程在跑、
 * 只是这一拍 HTTP 没应答（跑图满载），顶栏不该闪「未运行」。
 */
/** 路由在 HTTP 失败但进程快照判活时的返回形态（两处用例都要用）。 */
const ALIVE_BUT_NO_ANSWER: ComfyStatsPayload = {
  online: false,
  processAlive: true,
  vramUsed: 0,
  vramFree: 0,
  vramTotal: 0,
  ramUsed: 0,
  ramTotal: 0,
};

describe("进程级判活（与 /api/comfy/queue 同口径）", () => {
  it("成功后连续「进程在但没应答」：在线保持、保留旧数据置 stale、不翻离线", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValueOnce(onlineStats());
    await refreshComfyStats();
    const goodStats = getComfyStatsSnapshot().stats;

    fetchMock.mockResolvedValue(ALIVE_BUT_NO_ANSWER);
    for (let i = 0; i < 5; i++) await refreshComfyStats(); // 远超离线阈值也不该翻

    const snapshot = getComfyStatsSnapshot();
    expect(snapshot.online).toBe(true);
    expect(snapshot.stats).toBe(goodStats); // 保留旧读数
    expect(snapshot.stale).toBe(true);
  });

  it("从没读到过数据 + 进程在跑：算在线（连接中），不报未运行", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValue(ALIVE_BUT_NO_ANSWER);
    for (let i = 0; i < 5; i++) await refreshComfyStats();

    const snapshot = getComfyStatsSnapshot();
    expect(snapshot.online).toBe(true);
    expect(snapshot.stats).toBeNull();
  });

  it("「进程在但没应答」清零计数：随后一次真离线不立刻翻（仍走迟滞）", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValueOnce(onlineStats());
    await refreshComfyStats();
    fetchMock.mockResolvedValueOnce(OFFLINE);
    await refreshComfyStats(); // 容忍 1
    fetchMock.mockResolvedValue(ALIVE_BUT_NO_ANSWER);
    await refreshComfyStats(); // 进程判活 → 计数清零
    fetchMock.mockResolvedValue(OFFLINE);
    await refreshComfyStats(); // 清零后的第 1 次失败，仍在容忍期
    expect(getComfyStatsSnapshot().online).toBe(true);
  });

  it("进程真没了（回包不带 processAlive）连续达阈值：翻离线", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValueOnce(onlineStats());
    await refreshComfyStats();
    fetchMock.mockResolvedValue(OFFLINE);
    await refreshComfyStats();
    await refreshComfyStats();
    await refreshComfyStats(); // 第 3 次 → 提交离线
    expect(getComfyStatsSnapshot().online).toBe(false);
  });
});

describe("事件驱动 + 连续失败阈值（ISSUE #1351）", () => {
  it("单次失败只累加、不判 crash；连续 3 次才判", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValue(OFFLINE);
    await refreshComfyStats();
    expect(getComfyStatsSnapshot().crashed).toBe(false);
    await refreshComfyStats();
    expect(getComfyStatsSnapshot().crashed).toBe(false);
    await refreshComfyStats();
    expect(getComfyStatsSnapshot().crashed).toBe(true);
  });

  it("成功一次就清零：出图高峰的单次超时不该把用户跑到一半的图杀掉", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValueOnce(OFFLINE);
    fetchMock.mockResolvedValueOnce(OFFLINE);
    await refreshComfyStats();
    await refreshComfyStats();
    fetchMock.mockResolvedValueOnce(onlineStats());
    await refreshComfyStats(); // 成功 → 清零
    expect(getComfyStatsSnapshot().crashed).toBe(false);
    fetchMock.mockResolvedValue(OFFLINE);
    await refreshComfyStats();
    await refreshComfyStats();
    // 清零后只失败 2 次 → 还没到阈值
    expect(getComfyStatsSnapshot().crashed).toBe(false);
  });

  it("收到进程退出信号 → 立刻复核一次（不等下一拍）", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValue(onlineStats());
    await refreshComfyStats();
    const callsBefore = fetchMock.mock.calls.length;

    /* 触发那条订阅（`subscribeComfyCrashes` 在 jsdom 下拿不到 EventSource，
       所以这里直接驱动 store 注册进监听集合的那一个回调）。 */
    crashListeners.forEach((l) =>
      l({ seq: 1, at: 0, reason: "exit 1", userStopped: false }),
    );

    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it("阶段与间隔按 `~/lib/comfyui/liveness` 给（没有可观测数据时用空闲档节奏）", () => {
    subscribeComfyStats(noop);
    const liveness = getComfyLivenessForTest();
    expect(liveness.phase).toBe("idle");
    /* 首帧（从未量到数据）用展示节奏，别让用户看 15 秒的空窗。 */
    expect(liveness.intervalMs).toBe(COMFY_STATS_POLL_MS);
  });

  it("进程在跑但接口未就绪 → 启动等待档（400ms，快档）", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValue(ALIVE_BUT_NO_ANSWER);
    await refreshComfyStats();
    const liveness = getComfyLivenessForTest();
    expect(liveness.phase).toBe("starting");
    expect(liveness.intervalMs).toBe(400);
  });
});

describe("收到崩溃信号后的复核与换档（ISSUE #1351）", () => {
  /** 驱动 store 注册进 `subscribeComfyCrashes` 的那个回调（即事件到达）。 */
  function emitExit(): void {
    crashListeners.forEach((l) =>
      l({ seq: 1, at: 1_000, reason: "exit 1", userStopped: false }),
    );
  }

  it("复核期间阶段是 verifying（间隔 0），复核完回到原档", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValue(onlineStats());
    await refreshComfyStats();
    expect(getComfyLivenessForTest().phase).toBe("idle");

    let release: ((v: ComfyStatsPayload) => void) | null = null;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<ComfyStatsPayload>((resolve) => {
          release = resolve;
        }),
    );
    emitExit();
    await vi.waitFor(() =>
      expect(getComfyLivenessForTest().phase).toBe("verifying"),
    );
    expect(getComfyLivenessForTest().intervalMs).toBe(0);

    release!(onlineStats());
    await vi.waitFor(() =>
      expect(getComfyLivenessForTest().phase).toBe("idle"),
    );
  });

  it("启动等待的起点参与换档：超过快档窗口后间隔从 400ms 变 1s", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValue(ALIVE_BUT_NO_ANSWER);
    await refreshComfyStats();
    /* 起点由第一拍写下；把时钟推过快档窗口，下一拍的间隔就该换挡。 */
    expect(getComfyLivenessForTest().intervalMs).toBe(400);
    vi.setSystemTime(Date.now() + 11_000);
    expect(getComfyLivenessForTest().intervalMs).toBe(1000);
  });

  it("没有订阅者时收到事件：复核照跑，但换档那一步不重建（没表可换）", async () => {
    /* 这条覆盖 `reschedule` 的早退：复核的收尾在「没人订阅 → 没有轮询表」时
       必须不做事，否则会凭空起一条没人要的轮询。
       注意要**先抓住**那个监听器 —— 退订会把 store 注册的回调从集合里摘掉，
       之后再 `emitExit()` 就驱动不到任何东西，这条用例会变成空转。 */
    resetComfyStatsStoreForTest();
    const off = subscribeComfyStats(noop);
    const listeners = [...crashListeners];
    fetchMock.mockResolvedValue(onlineStats());
    await refreshComfyStats();
    off(); // 最后一个订阅者退订：表已停
    const startedAfterOff = startCalls.started;
    listeners.forEach((l) =>
      l({ seq: 1, at: 1_000, reason: "exit 1", userStopped: false }),
    );
    /* 复核本身仍会发一次（事件那一路不依赖订阅），但不该把表拉起来：
       `reschedule` 见到「没有表」就该早退。 */
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1),
    );
    expect(startCalls.started).toBe(startedAfterOff);
  });

  it("忙（出图 / 排队）时降到 30s：GPU 繁忙，HTTP 会排队，这时探测最容易误判", async () => {
    subscribeComfyStats(noop);
    fetchMock.mockResolvedValue(onlineStats());
    await refreshComfyStats();
    busyFlag.value = true;
    expect(getComfyLivenessForTest().phase).toBe("generating");
    expect(getComfyLivenessForTest().intervalMs).toBe(30_000);
  });
});
