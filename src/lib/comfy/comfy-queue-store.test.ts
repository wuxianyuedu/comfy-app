// @vitest-environment jsdom
/**
 * `comfy-queue-store` —— 客户端这一格的持有者：事件为主、轮询兜底。
 *
 * 判这几件事：
 *   · 订阅即走**慢速兜底轮询**拉一次真值（SSE 掉线时的安全网）；
 *   · 收到 SSE「变了」就补一次真值拉取（事件为主）；
 *   · 最后一个退订即关掉 SSE（多组件共用一条、不空转）；
 *   · 探测失败（非 ok / 抛错）**不动状态** —— 瞬时抖动不该让那一格忽明忽暗；
 *   · 背压：迟到的旧回包丢弃，只认最新一次；
 *   · 解析：畸形 payload 走各自的兜底（running 非对象 → null 等）；
 *   · 离线迟滞：连续失败 3 次才翻离线，容忍期内保留上一次好状态。
 *
 * ⚠️ 顺序是判据的一部分：每一拍**必须先等它发布完**再喂下一拍 —— 否则新请求
 * 会让上一拍变成「迟到回包」而被背压丢掉，断言读到的就是没变的状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as mod from "./comfy-queue-store";

/** 假 SSE：记下构造 URL 与关闭动作，可手动投递一帧。 */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  static created = 0;
  onmessage: ((ev: { data: string }) => void) | null = null;
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
    FakeEventSource.created += 1;
  }

  close(): void {
    this.closed = true;
    if (FakeEventSource.last === this) FakeEventSource.last = null;
  }

  emit(data: string): void {
    this.onmessage?.({ data });
  }
}

const fetchMock = vi.fn();

function queueRes(payload: unknown): Response {
  return /* SAFETY: 类型断言已复核 */ {
    ok: true,
    json: async () => payload,
  } as unknown as Response;
}

/** 一把可以手动收口的 Promise —— 用来造「两拍重叠」的背压现场。 */
function deferred(): {
  promise: Promise<Response>;
  resolve: (value: Response) => void;
} {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** 把挂着的微任务跑完（mock 的 fetch 是立刻 resolve 的，几拍就够）。 */
async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const RUNNING = {
  taskId: "task-1",
  workflowName: "文生图",
  model: "sd_xl_base_1.0.safetensors",
  startedAt: 1_000,
  progress: 40,
  nodeType: "KSampler",
};

/** 一次「在线 + 有在跑任务」的观测（queued 用入参区分不同拍）。 */
function onlinePayload(queued: number): unknown {
  return {
    online: true,
    comfy: { running: 1, pending: 2 },
    running: RUNNING,
    queued,
  };
}

function offlinePayload(queued: number): unknown {
  return {
    online: false,
    comfy: { running: 0, pending: 0 },
    running: null,
    queued,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(queueRes(onlinePayload(3)));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", FakeEventSource);
  FakeEventSource.last = null;
  FakeEventSource.created = 0;
  mod.resetComfyQueueStoreForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("comfy-queue-store", () => {
  it("订阅即走兜底轮询拉一次真值", async () => {
    const onChange = vi.fn();
    const off = mod.subscribeComfyQueue(onChange);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const snap = mod.getComfyQueueSnapshot();
    expect(snap.online).toBe(true);
    expect(snap.queued).toBe(3);
    expect(snap.comfy).toEqual({ running: 1, pending: 2 });
    expect(snap.running?.taskId).toBe("task-1");
    expect(typeof snap.elapsedMs).toBe("number");
    expect(snap.elapsedMs).not.toBeNull();
    off();
  });

  it("收到 SSE 帧就补一次真值拉取（事件为主）", async () => {
    const onChange = vi.fn();
    const off = mod.subscribeComfyQueue(onChange);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

    FakeEventSource.last!.emit("{}");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    off();
  });

  it("SSE 只建一条：两个订阅者共用同一个连接", async () => {
    const a = mod.subscribeComfyQueue(vi.fn());
    const b = mod.subscribeComfyQueue(vi.fn());
    expect(FakeEventSource.created).toBe(1);
    expect(FakeEventSource.last?.url).toBe("/api/comfy/queue/events");
    b();
    a();
  });

  it("最后一个退订即关掉 SSE", async () => {
    const off = mod.subscribeComfyQueue(vi.fn());
    await vi.waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const es = FakeEventSource.last!;
    off();
    expect(es.closed).toBe(true);
    expect(FakeEventSource.last).toBeNull();
  });

  it("中间退订不关连接（等到最后一个才关）", async () => {
    const a = mod.subscribeComfyQueue(vi.fn());
    const b = mod.subscribeComfyQueue(vi.fn());
    await vi.waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const es = FakeEventSource.last!;
    b();
    expect(es.closed).toBe(false);
    a();
    expect(es.closed).toBe(true);
  });

  it("回包非 ok 时不动状态（保留上一次好数据）", async () => {
    const off = mod.subscribeComfyQueue(vi.fn());
    await vi.waitFor(() => expect(mod.getComfyQueueSnapshot().queued).toBe(3));

    fetchMock.mockResolvedValue({ ok: false });
    FakeEventSource.last!.emit("not-ok");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();

    expect(mod.getComfyQueueSnapshot().online).toBe(true);
    expect(mod.getComfyQueueSnapshot().queued).toBe(3);
    off();
  });

  it("探测抛错时不动状态（瞬时断网不闪）", async () => {
    const off = mod.subscribeComfyQueue(vi.fn());
    await vi.waitFor(() => expect(mod.getComfyQueueSnapshot().queued).toBe(3));

    fetchMock.mockRejectedValue(new Error("network down"));
    FakeEventSource.last!.emit("throw");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();

    expect(mod.getComfyQueueSnapshot().online).toBe(true);
    expect(mod.getComfyQueueSnapshot().queued).toBe(3);
    off();
  });

  it("背压：迟到的旧回包被丢弃，只认最新一次", async () => {
    const stale = deferred();
    const fresh = deferred();
    fetchMock
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise);

    const onChange = vi.fn();
    const off = mod.subscribeComfyQueue(onChange);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // 第二拍抢先发出 ⇒ 第一拍从此成为「迟到回包」
    FakeEventSource.last!.emit("overlap");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // 旧的先到：必须被丢弃（快照里不能出现 111）
    stale.resolve(queueRes(onlinePayload(111)));
    await flush();
    expect(mod.getComfyQueueSnapshot().queued).not.toBe(111);

    // 最新的一拍才生效
    fresh.resolve(queueRes(onlinePayload(222)));
    await vi.waitFor(() =>
      expect(mod.getComfyQueueSnapshot().queued).toBe(222),
    );

    off();
  });

  it("解析兜底：payload 不是对象 → 按探测失败走迟滞，达阈值后才提交无数据", async () => {
    const off = mod.subscribeComfyQueue(vi.fn());
    await vi.waitFor(() => expect(mod.getComfyQueueSnapshot().queued).toBe(3));

    fetchMock.mockResolvedValue(queueRes("not-a-record"));
    FakeEventSource.last!.emit("bad-payload");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();
    // 单拍畸形 ⇒ 容忍期内保留上一次好状态（不闪）
    expect(mod.getComfyQueueSnapshot().online).toBe(true);
    expect(mod.getComfyQueueSnapshot().queued).toBe(3);

    fetchMock.mockResolvedValue(
      queueRes({
        online: true,
        comfy: "bad",
        running: 7,
        queued: "x",
      }),
    );
    FakeEventSource.last!.emit("bad-comfy");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await flush();
    const snap = mod.getComfyQueueSnapshot();
    expect(snap.comfy).toEqual({ running: 0, pending: 0 });
    expect(snap.running).toBeNull();
    expect(snap.queued).toBe(0);
    off();
  });

  it("解析兜底：running 的字段类型不对时各自回落（null / 0）", async () => {
    const off = mod.subscribeComfyQueue(vi.fn());
    await vi.waitFor(() => expect(mod.getComfyQueueSnapshot().queued).toBe(3));

    fetchMock.mockResolvedValue(
      queueRes({
        online: true,
        comfy: { running: 0, pending: 0 },
        running: { taskId: 5, startedAt: "x" },
        queued: 0,
      }),
    );
    FakeEventSource.last!.emit("bad-task-id");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();
    expect(mod.getComfyQueueSnapshot().running).toBeNull();

    fetchMock.mockResolvedValue(
      queueRes({
        online: true,
        comfy: { running: 0, pending: 0 },
        running: {
          taskId: "task-2",
          startedAt: 5_000,
          workflowName: 1,
          model: 2,
          nodeType: 3,
          progress: "bad",
        },
        queued: 0,
      }),
    );
    FakeEventSource.last!.emit("partial-running");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await flush();
    expect(mod.getComfyQueueSnapshot().running).toEqual({
      taskId: "task-2",
      workflowName: null,
      model: null,
      startedAt: 5_000,
      progress: 0,
      nodeType: null,
    });
    off();
  });

  it("离线迟滞：连续失败达阈值才翻离线，容忍期内保留上一次好状态", async () => {
    const off = mod.subscribeComfyQueue(vi.fn());
    await vi.waitFor(() => expect(mod.getComfyQueueSnapshot().queued).toBe(3));

    fetchMock.mockResolvedValue(queueRes(offlinePayload(9)));

    // 第 1 次失败：容忍期内 ⇒ 保留上一次好状态（不闪）
    FakeEventSource.last!.emit("f1");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();
    expect(mod.getComfyQueueSnapshot().online).toBe(true);
    expect(mod.getComfyQueueSnapshot().queued).toBe(3);

    // 第 2 次失败：仍在容忍期
    FakeEventSource.last!.emit("f2");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await flush();
    expect(mod.getComfyQueueSnapshot().online).toBe(true);
    expect(mod.getComfyQueueSnapshot().queued).toBe(3);

    // 第 3 次失败：达阈值 ⇒ 提交离线
    FakeEventSource.last!.emit("f3");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await vi.waitFor(() =>
      expect(mod.getComfyQueueSnapshot().online).toBe(false),
    );
    expect(mod.getComfyQueueSnapshot().queued).toBe(9);
    expect(mod.getComfyQueueSnapshot().elapsedMs).toBeNull();
    off();
  });

  it("在线一次即清零迟滞：容忍期内回到在线，不会翻离线", async () => {
    const off = mod.subscribeComfyQueue(vi.fn());
    await vi.waitFor(() => expect(mod.getComfyQueueSnapshot().queued).toBe(3));

    fetchMock.mockResolvedValue(queueRes(offlinePayload(9)));
    FakeEventSource.last!.emit("f1");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();
    expect(mod.getComfyQueueSnapshot().online).toBe(true);

    // 回到在线 ⇒ 连续失败计数清零
    fetchMock.mockResolvedValue(queueRes(onlinePayload(4)));
    FakeEventSource.last!.emit("recover");
    await vi.waitFor(() => expect(mod.getComfyQueueSnapshot().queued).toBe(4));

    // 清零之后再失败两次，仍应在线（阈值未到）
    fetchMock.mockResolvedValue(queueRes(offlinePayload(9)));
    FakeEventSource.last!.emit("f1-again");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await flush();
    expect(mod.getComfyQueueSnapshot().online).toBe(true);
    expect(mod.getComfyQueueSnapshot().queued).toBe(4);

    FakeEventSource.last!.emit("f2-again");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    await flush();
    expect(mod.getComfyQueueSnapshot().queued).toBe(4);
    off();
  });

  it("publish 幂等：同一份观测再喂一次不重复通知（快照身份稳定）", async () => {
    /* running 为 null ⇒ elapsedMs 恒为 null ⇒ 两次观测字段全等 ⇒ publish 早退。
     * 这是 `useSyncExternalStore` 不无限重渲染的那一格。 */
    const steady = {
      online: true,
      comfy: { running: 1, pending: 2 },
      running: null,
      queued: 3,
    };
    fetchMock.mockResolvedValue(queueRes(steady));
    const onChange = vi.fn();
    const off = mod.subscribeComfyQueue(onChange);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    onChange.mockClear();

    FakeEventSource.last!.emit("steady");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    off();
  });

  it("本地秒表：有在跑的任务时 elapsedMs 随本地时钟推进（且不发请求）", async () => {
    const off = mod.subscribeComfyQueue(vi.fn());
    await vi.waitFor(() =>
      expect(mod.getComfyQueueSnapshot().running).not.toBeNull(),
    );
    const first = mod.getComfyQueueSnapshot().elapsedMs!;
    const before = fetchMock.mock.calls.length;

    await vi.waitFor(
      () =>
        expect(mod.getComfyQueueSnapshot().elapsedMs).toBeGreaterThan(
          first + 400,
        ),
      { timeout: 4000, interval: 100 },
    );
    // 秒表只走本地时钟，不新增探测请求
    expect(fetchMock.mock.calls.length).toBe(before);
    off();
  });

  it("服务端快照恒为「无数据」：首帧不制造第三种状态", () => {
    expect(mod.getComfyQueueServerSnapshot()).toEqual({
      online: false,
      comfy: { running: 0, pending: 0 },
      running: null,
      queued: 0,
      elapsedMs: null,
    });
  });
});
