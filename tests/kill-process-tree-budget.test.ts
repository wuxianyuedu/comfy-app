/**
 * 回收子进程的墙钟预算判据（#4422）：taskkill / pkill 自己不退出时，探活预算
 * （waitForPidGone 的 3s）罩不住它——没有这一层 reapAll / shutdown 永不返回，
 * Ctrl-C 收尾整个卡死。spawn 挂了 `timeout` 预算，close 的 signal 分支按
 * 「没量到结果」处理（ok:false），不冒充成功。
 *
 * 两层钉：行为层钉 close→结果映射的纯函数（不真起子进程）；源形态层钉两个
 * spawn 调用都挂了预算（与 tests/dispatch-startup-points.test.ts 同族）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { killCloseDispatch, treeKillBudgetMs } from "~/lib/process/kill-process-tree";

const SRC = readFileSync(
  path.resolve(import.meta.dirname, "../src/lib/process/kill-process-tree.ts"),
  "utf8",
);

afterEach(() => {
  delete process.env.COMFYAPP_TREE_KILL_BUDGET_MS;
});

describe("treeKillBudgetMs（#4422）", () => {
  it("默认 15s；COMFYAPP_TREE_KILL_BUDGET_MS 可注小（测试驱动超时分支）", () => {
    delete process.env.COMFYAPP_TREE_KILL_BUDGET_MS;
    expect(treeKillBudgetMs()).toBe(15_000);
    process.env.COMFYAPP_TREE_KILL_BUDGET_MS = "250";
    expect(treeKillBudgetMs()).toBe(250);
    /* 非法注入（0 / 负数 / 非数字）回落默认：判据不因坏注入变无界。 */
    process.env.COMFYAPP_TREE_KILL_BUDGET_MS = "0";
    expect(treeKillBudgetMs()).toBe(15_000);
    process.env.COMFYAPP_TREE_KILL_BUDGET_MS = "abc";
    expect(treeKillBudgetMs()).toBe(15_000);
  });
});

describe("killCloseDispatch（close → 结果读数）", () => {
  it("taskkill exit 0：成功，via 是命令原文", () => {
    const r = killCloseDispatch("taskkill", 0, null, "taskkill /PID 1 /T /F");
    expect(r).toEqual({ code: 0, ok: true, via: "taskkill /PID 1 /T /F" });
  });

  it("taskkill 非零退出：失败且 via 带退出码与可能原因（#4332 口径不变）", () => {
    const r = killCloseDispatch("taskkill", 1, null, "taskkill /PID 1 /T /F");
    expect(r.ok).toBe(false);
    expect(r.via).toContain("exit=1");
  });

  it("taskkill signal 在场（超预算被收）：ok:false，via 注明「没量到结果」——不冒充成功", () => {
    const r = killCloseDispatch("taskkill", null, "SIGTERM", "taskkill /PID 1 /T /F");
    expect(r.ok).toBe(false);
    expect(r.via).toContain("预算被收");
    expect(r.via).toContain("没量到结果");
  });

  it("pkill exit 1 = 没有匹配的进程：对回收语义是成功（目标已不在）", () => {
    const r = killCloseDispatch("pkill", 1, null, "pkill -x comfy");
    expect(r).toEqual({ code: 1, ok: true, via: "pkill -x comfy（exit=1）" });
  });

  it("pkill signal 在场：ok:false，不冒充成功", () => {
    const r = killCloseDispatch("pkill", null, "SIGTERM", "pkill -x comfy");
    expect(r.ok).toBe(false);
    expect(r.via).toContain("预算被收");
  });
});

describe("预算接线（源形态，#4422）", () => {
  it("taskkill 与 pkill 两个 spawn 都挂了 timeout 预算", () => {
    expect(SRC).toContain("timeout: treeKillBudgetMs()");
    /* 两处：dispatchTaskkillAwait 一处 + pkill 一处。 */
    expect(SRC.match(/timeout: treeKillBudgetMs\(\)/g)).toHaveLength(2);
  });
});
