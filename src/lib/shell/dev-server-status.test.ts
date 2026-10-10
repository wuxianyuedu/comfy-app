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
  lastExit: null,
};

/** 一条「上一次为什么结束」的通知（形态与 describeAppServiceExit 一致）。 */
const exitNotice = {
  why: "本地服务自身退出了（编译失败 / 端口被占 / pnpm 异常都会这样）",
  action: "看 log/nextjs/ 下最新一份输出；重新启动一次通常即可恢复",
  detail:
    "服务被 SIGKILL 结束：被强制结束（内存不足被系统结束、或任务管理器结束进程都会这样）",
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

  it("断开且原因已知 → 状态栏 title 说出**为什么**与**怎么办**（规范 §10.3.1）", () => {
    const s = deriveDevServerStatus({
      ...base,
      lastProbeOk: false,
      lastExit: exitNotice,
    });
    expect(s.state).toBe("offline");
    expect(s.title).toContain(exitNotice.why);
    expect(s.title).toContain(exitNotice.detail);
    expect(s.title).toContain(exitNotice.action);
    expect(s.exitNotice).toEqual(exitNotice);
  });

  it("断开但原因未知 → 保留原来的「怎么恢复」，不退回一句现象陈述", () => {
    const s = deriveDevServerStatus({ ...base, lastProbeOk: false });
    expect(s.title).toContain("恢复");
    expect(s.exitNotice).toBeNull();
  });

  it("刚重启且原因已知 → title 把「后果」与「为什么」接成一句（过去只有后果）", () => {
    const s = deriveDevServerStatus({
      ...base,
      restarted: true,
      lastRestartAt: Date.parse("2026-10-10T10:00:00"),
      lastExit: exitNotice,
    });
    expect(s.state).toBe("online");
    expect(s.title).toContain(exitNotice.why);
    expect(s.title).toContain("需要重新执行");
    expect(s.exitNotice).toEqual(exitNotice);
  });

  it("在线且没刚重启过 → 不挂上一次的原因（几小时前的旧结论不该贴住「运行中」）", () => {
    const s = deriveDevServerStatus({ ...base, lastExit: exitNotice });
    expect(s.state).toBe("online");
    expect(s.exitNotice).toBeNull();
    expect(s.title).not.toContain(exitNotice.why);
  });

  it("「连接中」不挂原因（还没探通过，谈不上「上一次结束」）", () => {
    const s = deriveDevServerStatus({
      ...base,
      everOnline: false,
      lastProbeOk: false,
      lastExit: exitNotice,
    });
    expect(s.state).toBe("starting");
    expect(s.exitNotice).toBeNull();
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
