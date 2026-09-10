// 「就绪」语义的单一事实：派生函数的行为契约（ISSUE #324 / 规范 11.2 行为测试）。
// 这里是全应用对「就绪」的唯一判据来源，用例名即语义文档。

import { describe, expect, it } from "vitest";

import { deriveComfyReadiness } from "./comfy-readiness";

describe("deriveComfyReadiness", () => {
  it("未连接 → offline，文案为「未连接」并说明无法提交任务", () => {
    const r = deriveComfyReadiness(false, false);
    expect(r.state).toBe("offline");
    expect(r.label).toBe("未连接");
    expect(r.title).toContain("无法读取显存/内存");
  });

  it("已连接但首个采样未回来 → connecting，不冒充就绪也不报未连接", () => {
    const r = deriveComfyReadiness(true, false);
    expect(r.state).toBe("connecting");
    expect(r.label).toBe("连接中");
  });

  it("已连接且指标可读 → ready，且明确声明队列空闲不参与判据", () => {
    const r = deriveComfyReadiness(true, true);
    expect(r.state).toBe("ready");
    expect(r.label).toBe("已就绪");
    expect(r.title).toContain("可以提交任务");
    // 队列空闲不属于就绪判据，必须在用户可见文案里说清，避免歧义回归
    expect(r.title).toContain("不代表队列空闲");
  });

  it("三态各有独立且非空的文案（标签不重复）", () => {
    const labels = [
      deriveComfyReadiness(false, false).label,
      deriveComfyReadiness(true, false).label,
      deriveComfyReadiness(true, true).label,
    ];
    expect(new Set(labels).size).toBe(3);
    labels.forEach((l) => expect(l.length).toBeGreaterThan(0));
    // 旧实现的写死「就绪」不再作为未连接时的文案
    expect(labels[0]).not.toBe("就绪");
  });
});
