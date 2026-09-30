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
  startCalls.started = 0;
  startCalls.stopped = 0;
  resetComfyStatsStoreForTest();
});

afterEach(() => {
  resetComfyStatsStoreForTest();
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
describe("进程级判活（与 /api/comfy/queue 同口径）", () => {
  /** 路由在 HTTP 失败但进程快照判活时的返回形态。 */
  const ALIVE_BUT_NO_ANSWER: ComfyStatsPayload = {
    online: false,
    processAlive: true,
    vramUsed: 0,
    vramFree: 0,
    vramTotal: 0,
    ramUsed: 0,
    ramTotal: 0,
  };

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
