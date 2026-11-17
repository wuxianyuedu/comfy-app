// 后台启动分支记账与自愈重试的契约（ISSUE #4257）。
//
// 重试的 30s 间隔用假时钟推进（真实等待会把用例拖到分钟级）；
// 落盘写在 run/（gitignore 的运行期目录）里，用例跑完即删。

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  bootBranchOutcomes,
  failedFunctionalBootBranches,
  persistBootBranches,
  readPersistedBootBranches,
  recordBootBranch,
  runBootBranchWithRetry,
} from "./boot-branches.server";

const persistedFile = path.join(process.cwd(), "run", "boot-branches.json");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(persistedFile, { force: true });
});

describe("runBootBranchWithRetry —— 功能分支的自愈重试（ISSUE #4257）", () => {
  it("首试成功：记账 ok，不重试", async () => {
    let calls = 0;
    await runBootBranchWithRetry("reaper-ok", () => {
      calls += 1;
      return Promise.resolve(null);
    });
    expect(calls).toBe(1);
    const outcome = bootBranchOutcomes().find((o) => o.name === "reaper-ok");
    expect(outcome?.ok).toBe(true);
  });

  it("失败重试至多 3 次（间隔 30s），仍失败记账并抛出", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const loop = runBootBranchWithRetry("reaper-fail", () => {
      calls += 1;
      return Promise.reject(new Error("必败"));
    }).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(30_000); // 第 2 次尝试
    await vi.advanceTimersByTimeAsync(30_000); // 第 3 次尝试
    const message = await loop;
    expect(calls).toBe(3);
    expect(message).toBe("必败");
    const outcome = bootBranchOutcomes().find((o) => o.name === "reaper-fail");
    expect(outcome?.ok).toBe(false);
    expect(outcome?.detail).toBe("必败");
  });

  it("第 2 次成功 → 自愈，记账 ok", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const loop = runBootBranchWithRetry("dispatch-heal", () => {
      calls += 1;
      return calls >= 2 ? Promise.resolve(null) : Promise.reject(new Error("首次失败"));
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await loop;
    expect(calls).toBe(2);
    const outcome = bootBranchOutcomes().find((o) => o.name === "dispatch-heal");
    expect(outcome?.ok).toBe(true);
  });
});

describe("failedFunctionalBootBranches —— 只报影响功能的失败（ISSUE #4257）", () => {
  it("观测类分支（event-loop-watch / sentry）的失败不进提示", () => {
    recordBootBranch("dispatch", false, "派发挂了");
    recordBootBranch("event-loop-watch", false, "观测挂了");
    const failed = failedFunctionalBootBranches().map((o) => o.name);
    expect(failed).toContain("dispatch");
    expect(failed).not.toContain("event-loop-watch");
  });
});

describe("落盘与读回（run/boot-branches.json）", () => {
  it("记账后可从盘上读回（消息中心与路由的数据源）", async () => {
    recordBootBranch("film-resume-persist", false, "恢复失败");
    /* 直接等落盘（生产里是 fire-and-forget；测试要确定性就显式 await）。 */
    await persistBootBranches();
    const outcomes = await readPersistedBootBranches();
    expect(outcomes.some((o) => o.name === "film-resume-persist" && !o.ok)).toBe(true);
  });
});
