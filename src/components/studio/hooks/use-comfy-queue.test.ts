/**
 * 状态栏那一格说什么（`comfyQueueNotice` / `formatElapsed`）。
 *
 * 判据里有两档是「**不要**打扰用户」（ComfyUI 离线、空闲无排队），其余是「必须
 * 说清」：前面堵着几个、当前跑了多久、跑的是哪个工作流与模型。这一格是用户判断
 * 「它还在动吗」的地方，说错或漏说都会让人去翻日志面板。
 */
import { describe, expect, it } from "vitest";

import {
  comfyQueueNotice,
  formatElapsed,
  type ComfyQueueView,
} from "./use-comfy-queue";

function view(over: Partial<ComfyQueueView> = {}): ComfyQueueView {
  return {
    online: true,
    comfy: { running: 0, pending: 0 },
    running: null,
    queued: 0,
    elapsedMs: null,
    ...over,
  };
}

const RUNNING = {
  taskId: "t-1",
  workflowName: "文生图",
  model: "flux1-dev.safetensors",
  startedAt: 1_000_000,
  progress: 42,
  nodeType: "KSampler",
};

describe("formatElapsed", () => {
  it("一分钟以内是 mm:ss，超过一小时带小时", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(42_000)).toBe("00:42");
    expect(formatElapsed(9 * 60_000 + 5_000)).toBe("09:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
  });

  it("负数夹到 0（时钟回拨也不显示 -01:00）", () => {
    expect(formatElapsed(-5_000)).toBe("00:00");
  });
});

describe("comfyQueueNotice", () => {
  it("ComfyUI 离线时不占位（降级提示已有一条，不重复报）", () => {
    expect(comfyQueueNotice(view({ online: false }))).toBeNull();
    expect(
      comfyQueueNotice(view({ online: false, running: RUNNING })),
    ).toBeNull();
  });

  it("空闲且无排队时不占位（状态栏不该常驻一个「没事发生」的格子）", () => {
    expect(comfyQueueNotice(view())).toBeNull();
  });

  it("在跑：正文给出耗时 / 工作流 / 模型，title 里补进度与当前节点", () => {
    const notice = comfyQueueNotice(
      view({ running: RUNNING, elapsedMs: 65_000 }),
    );
    expect(notice?.text).toContain("01:05");
    expect(notice?.text).toContain("文生图");
    expect(notice?.text).toContain("flux1-dev.safetensors");
    expect(notice?.title).toContain("42%");
    expect(notice?.title).toContain("KSampler");
  });

  it("有排队时把队列数并进正文（含 ComfyUI 侧不是本应用提交的任务）", () => {
    const notice = comfyQueueNotice(
      view({
        running: RUNNING,
        elapsedMs: 1_000,
        queued: 1,
        comfy: { running: 1, pending: 2 },
      }),
    );
    expect(notice?.text).toContain("排队 3");
    expect(notice?.title).toContain("排队 2");
  });

  it("没在跑但有排队：只报队列，不编造一个「正在执行」", () => {
    const notice = comfyQueueNotice(
      view({ queued: 2, comfy: { running: 0, pending: 0 } }),
    );
    expect(notice?.text).toBe("排队 2");
    expect(notice?.text).not.toContain("▶");
  });

  it("工作流名 / 模型缺失时如实省略，不留空档", () => {
    const notice = comfyQueueNotice(
      view({
        running: { ...RUNNING, workflowName: null, model: null },
        elapsedMs: 5_000,
      }),
    );
    expect(notice?.text).toBe("▶ 00:05");
    expect(notice?.title).toContain("未能从本次工作流里识别");
  });
});
