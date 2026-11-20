/**
 * 就绪等待的拆分显示（ISSUE #4577）：「等待服务就绪」原来是一段黑盒 span，
 * 现拆成「等待端口应答」（首跳任意 HTTP 应答之前）与「等待健康检查」（到
 * /api/health 200 为止）两段。本组用例驱动真的 `waitForDevReady`（探测档位
 * 用 mock 序列喂），钉四件事：两段的切分点、首跳即就绪的 0 长度健康段、
 * dev 先退出时不虚开健康段、ctx 不带 timeline 照常工作（可选注入同口径）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { probeStateQueue, devExitedFlag } = vi.hoisted(() => ({
  probeStateQueue: [] as string[],
  devExitedFlag: { value: false },
}));

vi.mock("../scripts/launcher-core/orchestrator.mjs", () => ({
  /* 探测档位按脚本喂：真 classifyProbe 会发网络请求，这里只回答「这一跳是什么态」。
   * ready-wait.mjs 只从 orchestrator 取这三个出口，整模块替换成这三件即可。 */
  classifyProbe: () => Promise.resolve(probeStateQueue.shift() ?? "ready"),
  describeProbeState: (state: string) => `探测档位：${state}`,
  readDiagnosticsTail: () => "(无输出)",
}));

import { waitForDevReady } from "../scripts/launcher-core/ready-wait.mjs";
import { createLaunchTimeline } from "../scripts/launcher-core/timeline.mjs";

/** 静音 ctx：本组只关心 span 读数与返回值，日志 / 进度 / 重启都不看。 */
function buildCtx(timeline: ReturnType<typeof createLaunchTimeline> | null) {
  return {
    log: () => {
      /* 静音 */
    },
    status: () => {
      /* 静音 */
    },
    devExited: () => devExitedFlag.value,
    respawnDev: async () => {
      /* 静音：本组不触发自愈路径 */
    },
    timeline,
  };
}

const target = {
  port: 3100,
  host: "127.0.0.1",
  staleShell: null,
  nextOut: "nextjs-stdout.log",
  nextErr: "nextjs-stderr.log",
  panelDir: "panel",
  startedAt: Date.now(),
};

describe("就绪等待的拆分显示（ISSUE #4577）", () => {
  afterEach(() => {
    probeStateQueue.length = 0;
    devExitedFlag.value = false;
    vi.unstubAllGlobals();
  });

  it("两段拆分：首跳应答前记「等待端口应答」，之后到就绪记「等待健康检查」，首尾相接", async () => {
    probeStateQueue.push("not-up", "not-up", "schema-not-ready", "schema-not-ready", "ready");
    vi.stubGlobal("setTimeout", (fn: () => void) => {
      fn();
      return 0;
    });
    const timeline = createLaunchTimeline(Date.now());
    const result = await waitForDevReady(buildCtx(timeline), target);

    expect(result.ready).toBe(true);
    const spans = timeline.snapshot();
    expect(spans.map((s) => s.key)).toEqual(["ready-port", "ready-health"]);
    expect(spans.map((s) => s.label)).toEqual(["等待端口应答", "等待健康检查"]);
    // 两条出口都在本次调用内收口，不留「进行中」的悬挂段。
    for (const span of spans) {
      expect(span.endMs).not.toBeNull();
    }
    // 健康段从「首个应答」那一刻起跑：与端口段的终点同刻（首尾相接，不重叠不留缝）。
    expect(spans[1]!.startMs).toBe(spans[0]!.endMs);
    expect(spans[1]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("首跳即就绪：健康段是接近 0 长度的完成段，不挂着", async () => {
    probeStateQueue.push("ready");
    vi.stubGlobal("setTimeout", (fn: () => void) => {
      fn();
      return 0;
    });
    const timeline = createLaunchTimeline(Date.now());
    const result = await waitForDevReady(buildCtx(timeline), target);

    expect(result.ready).toBe(true);
    const spans = timeline.snapshot();
    expect(spans.map((s) => s.key)).toEqual(["ready-port", "ready-health"]);
    expect(spans[1]!.durationMs).toBeLessThan(5);
    expect(spans[1]!.endMs).not.toBeNull();
  });

  it("dev 先退出：只记端口段并收口，不虚开健康段", async () => {
    devExitedFlag.value = true;
    const timeline = createLaunchTimeline(Date.now());
    const result = await waitForDevReady(buildCtx(timeline), target);

    expect(result.ready).toBe(false);
    expect(result.lastProbeState).toBe("not-up");
    const spans = timeline.snapshot();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.key).toBe("ready-port");
    expect(spans[0]!.label).toBe("等待端口应答");
    expect(spans[0]!.endMs).not.toBeNull();
  });

  it("ctx 不带 timeline：照常等就绪，不记 span 也不抛错（可选注入同口径）", async () => {
    probeStateQueue.push("not-up", "route-404", "ready");
    vi.stubGlobal("setTimeout", (fn: () => void) => {
      fn();
      return 0;
    });
    const result = await waitForDevReady(buildCtx(null), target);
    expect(result.ready).toBe(true);
    expect(result.lastProbeState).toBe("ready");
  });
});
