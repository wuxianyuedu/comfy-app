// 应用服务状态派生函数的行为契约（规范 11.2：用例名即语义文档）。
// 这是状态栏那一格的唯一判据来源：判据 = 「应用服务能不能应答」，
// 与 ComfyUI 是否运行无关。

import { describe, expect, it } from "vitest";

import { deriveDevServerStatus } from "./dev-server-status";

const base = {
  everOnline: true,
  lastProbeOk: true,
  restarted: false,
  lastRestartAt: null,
};

describe("deriveDevServerStatus", () => {
  it("探测通且无重启 → online，文案是「应用服务运行中」", () => {
    const s = deriveDevServerStatus(base);
    expect(s.state).toBe("online");
    expect(s.label).toBe("应用服务运行中");
    expect(s.title).toContain("应用服务");
  });

  it("从未探通 → starting，不冒充在线也不报故障", () => {
    const s = deriveDevServerStatus({
      ...base,
      everOnline: false,
      lastProbeOk: false,
    });
    expect(s.state).toBe("starting");
    expect(s.label).toBe("应用服务连接中");
  });

  it("曾是通的、现在探不通 → offline，并说明影响与恢复方式", () => {
    const s = deriveDevServerStatus({ ...base, lastProbeOk: false });
    expect(s.state).toBe("offline");
    expect(s.label).toBe("应用服务已断开");
    expect(s.title).toContain("不可达");
    expect(s.title).toContain("恢复");
  });

  it("检测到真正重启 → 仍在 online，但文案切到「已重启」并提示任务已丢", () => {
    const s = deriveDevServerStatus({
      ...base,
      restarted: true,
      lastRestartAt: Date.parse("2026-09-12T08:30:00"),
    });
    expect(s.state).toBe("online");
    expect(s.label).toBe("应用服务已重启");
    expect(s.title).toContain("需要重新执行");
  });

  it("三态文案互不相同且非空（状态必须一眼可辨）", () => {
    const labels = [
      deriveDevServerStatus({ ...base, everOnline: false, lastProbeOk: false })
        .label,
      deriveDevServerStatus(base).label,
      deriveDevServerStatus({ ...base, lastProbeOk: false }).label,
    ];
    expect(new Set(labels).size).toBe(3);
    labels.forEach((label) => expect(label.length).toBeGreaterThan(0));
  });

  it("不再出现 ComfyUI 相关文案（判据已与 ComfyUI 解耦）", () => {
    for (const input of [
      base,
      { ...base, lastProbeOk: false },
      { ...base, everOnline: false, lastProbeOk: false },
    ]) {
      expect(deriveDevServerStatus(input).title).not.toContain("ComfyUI");
    }
  });
});
