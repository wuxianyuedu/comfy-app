/**
 * `watchTask` 的落定状态机契约（P3 §5 ADR §13-3B1 手工端到端抓到的缺口）。
 *
 * 钉的行为：成功收口靠带 `images` 的 `state` 帧（SUCCEEDED）完成——此前该状态
 * 被静默跳过，界面卡在「生成中」、按钮不复位、SSE 重连风暴。同时守住两条反向：
 * 终态只落定一次（同一行可能被轮询读到两次）、非终态不落定。
 *
 * 进程内 `done` / `error` 帧已随 P3 §5 ADR §14 D1 退役，所以这里不再有「两条
 * 路径谁先到」的组合：`/api/tasks/[id]/stream` 只发 `log` 与 `state`。
 *
 * 用假 EventSource（本文件唯一的运行时替身）：watchTask 只依赖
 * `new EventSource(url)` + `onmessage/onerror/onclose` 面，不碰其它浏览器 API。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { watchTask, type TaskWatchHandlers } from "./generation-client";

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  url: string;
  readyState = 1;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = 2;
  });
  constructor(url: string) {
    this.url = url;
    instances.push(this);
  }
  /** 测试侧喂一帧。 */
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

let instances: FakeEventSource[] = [];

beforeEach(() => {
  instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

function startWatch(partial: Partial<TaskWatchHandlers> = {}) {
  const handlers: TaskWatchHandlers = {
    onSettled: vi.fn(),
    onOutput: vi.fn(),
    onProgress: vi.fn(),
    onLog: vi.fn(),
    ...partial,
  };
  watchTask("t-host-1", handlers);
  const es = instances[0];
  if (!es) throw new Error("watchTask 未建立 EventSource");
  return { es, handlers };
}

const IMAGES = [
  { localPath: "/api/generated/a.png", mediaType: "image" },
  { localPath: "/api/generated/b.mp4", mediaType: "video" },
];

describe("watchTask 的终态落定路径", () => {
  it("state 帧 SUCCEEDED + images：逐条 onOutput、settle(true)、关流", () => {
    const { es, handlers } = startWatch();
    es.emit({
      type: "state",
      status: "SUCCEEDED",
      progress: 100,
      images: IMAGES,
    });
    expect(handlers.onOutput).toHaveBeenCalledTimes(2);
    expect(handlers.onSettled).toHaveBeenCalledTimes(1);
    expect(handlers.onSettled).toHaveBeenCalledWith({ ok: true });
    expect(es.close).toHaveBeenCalled();
  });

  it("state 帧 SUCCEEDED 但无产出：按失败落定", () => {
    const { es, handlers } = startWatch();
    es.emit({ type: "state", status: "SUCCEEDED", progress: 100, images: [] });
    expect(handlers.onSettled).toHaveBeenCalledWith({
      ok: false,
      message: "任务完成但没有产出文件",
    });
    expect(es.close).toHaveBeenCalled();
  });

  it("非终态 state 帧（RUNNING）只刷进度、不落定", () => {
    const { es, handlers } = startWatch();
    es.emit({ type: "state", status: "RUNNING", progress: 42 });
    expect(handlers.onProgress).toHaveBeenCalled();
    expect(handlers.onSettled).not.toHaveBeenCalled();
    expect(es.close).not.toHaveBeenCalled();
  });

  it("终态被读到两次也只落定一次：产出回调不许重发", () => {
    const { es, handlers } = startWatch();
    es.emit({
      type: "state",
      status: "SUCCEEDED",
      progress: 100,
      images: IMAGES,
    });
    expect(handlers.onSettled).toHaveBeenCalledTimes(1);
    es.emit({
      type: "state",
      status: "SUCCEEDED",
      progress: 100,
      images: IMAGES,
    });
    expect(handlers.onSettled).toHaveBeenCalledTimes(1);
    expect(handlers.onOutput).toHaveBeenCalledTimes(IMAGES.length);
  });

  it("已退役的 done 帧即使从别处冒出来也只是被忽略", () => {
    const { es, handlers } = startWatch();
    es.emit({ type: "done", images: IMAGES });
    expect(handlers.onSettled).not.toHaveBeenCalled();
    expect(handlers.onOutput).not.toHaveBeenCalled();
  });

  it("state 帧 FAILED 带 error：按失败落定并用 DB 原因", () => {
    const { es, handlers } = startWatch();
    es.emit({ type: "state", status: "FAILED", error: "工作流校验未通过" });
    expect(handlers.onSettled).toHaveBeenCalledWith({
      ok: false,
      message: "工作流校验未通过",
    });
  });
});
