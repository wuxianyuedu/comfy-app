/**
 * 回归护栏：运行期「陈旧路由表」自愈探测（**症状驱动 + 有界 + 懒归因**）。
 *
 * 判据只有一条：**曾经就绪过、现在连续 N 拍 `/api/health` 返回 404、且页面 `/`
 * 仍 200** → 轻量重启 dev server。其余一切状态都不动手。本用例钉死五条负例与
 * 两条边界：
 *   · health 200 → 零动作（HMR 已吸收的 pull 走的就是这条，探测毫不知情）；
 *   · 冷启动期（还没就绪过）的 404 → 不算「路由表坏了」；
 *   · 接口层非 404（连不上 / 503）→ 交给既有断开 / 恢复链路；
 *   · 页面 `/` 也非 200（服务半死）→ 不套用这条自愈；
 *   · 冷却期内不重复重启、超单会话上限后只提示不动手。
 * 归因是**懒的**：`describeRuntimeHealCause(root, null)` 不跑 git、直接退化为无归因。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRuntimeRouteWatch,
  describeRuntimeHealCause,
  readGitHead,
} from "../scripts/launcher-core/runtime-heal.mjs";

/** 内部 interval 设得极大：用例自己 `tick()` 驱动，不受定时器干扰。 */
const NO_INTERVAL_MS = 1_000_000;

/** 造一个可手动 tick 的 watcher；默认「就绪且页面 200」。 */
function makeWatch(overrides = {}) {
  const log = vi.fn();
  const onHeal = vi.fn().mockResolvedValue(undefined);
  const watch = createRuntimeRouteWatch({
    log,
    probeHealth: async () => "ready",
    probeRoot: async () => true,
    onHeal,
    beatMs: NO_INTERVAL_MS,
    ...overrides,
  });
  return { watch, log, onHeal };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createRuntimeRouteWatch：只认「页面 200 且接口 404」这一个签名", () => {
  it("health 200 → 零动作（HMR 已吸收的改动不会触发这条）", async () => {
    const { watch, onHeal } = makeWatch({ armedInitially: true });
    await watch.tick();
    await watch.tick();
    expect(onHeal).not.toHaveBeenCalled();
    expect(watch.stats()).toEqual({ armed: true, failures: 0, heals: 0 });
    watch.stop();
  });

  it("冷启动期（未就绪过）的 404 → 不算路由表坏，且不计失败拍", async () => {
    const { watch, onHeal } = makeWatch({
      armedInitially: false,
      probeHealth: async () => "route-404",
      threshold: 2,
    });
    for (let i = 0; i < 5; i += 1) await watch.tick();
    expect(onHeal).not.toHaveBeenCalled();
    expect(watch.stats().failures).toBe(0);
    expect(watch.stats().armed).toBe(false);
    watch.stop();
  });

  it("就绪过之后才武装：armed 由 ready 那一拍置真", async () => {
    let state = "route-404";
    const { watch } = makeWatch({
      armedInitially: false,
      probeHealth: async () => state,
    });
    await watch.tick();
    expect(watch.stats().armed).toBe(false);
    state = "ready";
    await watch.tick();
    expect(watch.stats().armed).toBe(true);
    watch.stop();
  });

  it("接口层非 404（not-up / 503）→ 交给既有链路，清零失败拍", async () => {
    for (const state of ["not-up", "schema-not-ready"]) {
      const { watch, onHeal } = makeWatch({
        armedInitially: true,
        probeHealth: async () => state,
        threshold: 2,
      });
      for (let i = 0; i < 5; i += 1) await watch.tick();
      expect(onHeal).not.toHaveBeenCalled();
      expect(watch.stats().failures).toBe(0);
      watch.stop();
    }
  });

  it("连续 N 拍 404 且页面仍 200 → 触发一次自愈重启", async () => {
    const { watch, onHeal } = makeWatch({
      armedInitially: true,
      probeHealth: async () => "route-404",
      probeRoot: async () => true,
      threshold: 3,
    });
    await watch.tick();
    await watch.tick();
    expect(onHeal).not.toHaveBeenCalled();
    await watch.tick();
    expect(onHeal).toHaveBeenCalledTimes(1);
    expect(watch.stats().heals).toBe(1);
    watch.stop();
  });

  it("页面 `/` 也非 200（服务半死）→ 不套用这条自愈，失败拍清零", async () => {
    const { watch, onHeal, log } = makeWatch({
      armedInitially: true,
      probeHealth: async () => "route-404",
      probeRoot: async () => false,
      threshold: 1,
    });
    await watch.tick();
    expect(onHeal).not.toHaveBeenCalled();
    expect(watch.stats().failures).toBe(0);
    expect(log).toHaveBeenCalled();
    watch.stop();
  });

  it("冷却期内不重复重启；冷却过后可再次自愈", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { watch, onHeal } = makeWatch({
      armedInitially: true,
      probeHealth: async () => "route-404",
      probeRoot: async () => true,
      threshold: 1,
      cooldownMs: 60_000,
      maxHeals: 10,
    });
    await watch.tick();
    expect(onHeal).toHaveBeenCalledTimes(1);
    await watch.tick(); // 同一时刻：冷却未过
    expect(onHeal).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    await watch.tick(); // 冷却已过
    expect(onHeal).toHaveBeenCalledTimes(2);
    watch.stop();
  });

  it("超过单会话上限 → 只提示不再自动重启", async () => {
    const { watch, onHeal, log } = makeWatch({
      armedInitially: true,
      probeHealth: async () => "route-404",
      probeRoot: async () => true,
      threshold: 1,
      cooldownMs: 0,
      maxHeals: 2,
    });
    await watch.tick();
    await watch.tick();
    await watch.tick();
    expect(onHeal).toHaveBeenCalledTimes(2);
    expect(watch.stats().heals).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("上限"), "WARN");
    watch.stop();
  });

  it("stop() 之后 tick 不再探测（收尾后不该再动手）", async () => {
    const probeHealth = vi.fn(async () => "route-404");
    const { watch, onHeal } = makeWatch({
      armedInitially: true,
      probeHealth,
      threshold: 1,
    });
    watch.stop();
    await watch.tick();
    expect(probeHealth).not.toHaveBeenCalled();
    expect(onHeal).not.toHaveBeenCalled();
  });
});

describe("懒归因：拿不到起点就直接退化，绝不跑 git", () => {
  it("headAtBoot 为 null → 返回 null（无归因，不影响自愈）", () => {
    expect(describeRuntimeHealCause(process.cwd(), null)).toBeNull();
  });

  it("非 git 检出 → readGitHead 返回 null", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heal-no-git-"));
    try {
      expect(readGitHead(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("以启动时 HEAD 为基准 → 无改动时给「偶发失效」那句", () => {
    const root = process.cwd();
    const head = readGitHead(root);
    // 极少数非 git 环境（无 git 可执行）：跳过这条，不假装有结论。
    if (head === null) return;
    expect(describeRuntimeHealCause(root, head)).toBe(
      "未检测到代码改动，属偶发失效",
    );
  });
});

/*
 * 接线形状：本探测的判据可单测，但「自愈动作」是 `dev-launcher.mjs` 里 `run()` 的
 * 闭包（`restartDevForReason`），外部拿不到实例 —— 于是这一层按仓库既有做法
 * （见 `tests/dev-launcher-dependency-sync.test.ts`）**读源码断形状**，把 v1/v2 都
 * 漏掉的实现要点钉住：
 *   · 就绪之后才挂探测（`armedInitially: true`），并复用 `classifyProbe` 的症状；
 *   · 自愈动作里**重启后重新武装退出监听**（否则「重启后 dev 崩了」不会被收尾）；
 *   · 归因经 `COMFYAPP_RESTART_DETAIL` 注入新进程；
 *   · 动作本身：清 `.next`（`syncNextCache`）+ 刷会话锚点（`writeSession`）。
 */
describe("接线形状：探测挂在就绪之后，自愈动作完整且可归因", () => {
  const launcherSrc = fs.readFileSync(
    path.join(process.cwd(), "scripts", "dev-launcher.mjs"),
    "utf8",
  );

  it("就绪之后挂常驻探测（复用 classifyProbe，armedInitially 为真）", () => {
    expect(launcherSrc).toContain("createRuntimeRouteWatch({");
    expect(launcherSrc).toContain("armedInitially: true");
    expect(launcherSrc).toMatch(/classifyProbe\(\{ port, host: args\.host \}\)/);
    // 归因只在决定自愈那一刻懒跑（这是 run() 内的调用点）。
    expect(launcherSrc).toContain('describeRuntimeHealCause(ROOT, headAtBoot)');
    expect(launcherSrc).toContain('restartDevForReason("route-404-heal", detail)');
  });

  it("自愈动作：回收旧 dev → 清 .next → 带归因重启 → 重新武装退出监听 → 刷会话锚点", () => {
    const start = launcherSrc.indexOf("async function restartDevForReason(");
    expect(start, "找不到自愈动作的实现").toBeGreaterThan(-1);
    const end = launcherSrc.indexOf("const waited = await waitForDevReady(", start);
    const region = launcherSrc.slice(start, end > start ? end : start + 2000);

    expect(region).toContain("reapProcessTree({"); // 回收旧 dev 整棵子树
    expect(region).toContain('syncNextCache(ROOT, { FORCE_CLEAN: "1" })'); // 清 .next
    expect(region).toContain("COMFYAPP_RESTART_REASON: reason");
    expect(region).toContain("COMFYAPP_RESTART_DETAIL = detail"); // 归因注入
    expect(region).toContain("watchDevChild(dev)"); // 重启后重新武装退出监听
    expect(region).toContain("writeSession(ROOT, {"); // 刷新会话锚点（新 dev 的 pid）
  });
});
