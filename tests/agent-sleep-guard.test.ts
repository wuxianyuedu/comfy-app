/**
 * `scripts/agent-hooks/sleep-guard.mjs` 的契约（ISSUE #4118）：PreToolUse 钩子拦
 * 「≥60s 的 sleep 命令」，把正确出口（`pnpm ship:wait` / 直接执行只读回读口）写在
 * stderr 里。<60s 的短退避放行；入参解析失败 fail-open 放行（这一格不是权限闸）。
 *
 * 真起进程喂 stdin（与平台调用钩子的方式同形），断言退出码：0 放行 / 2 拦下。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

const GUARD = path.resolve(process.cwd(), "scripts/agent-hooks/sleep-guard.mjs");

/** 喂一份 PreToolUse 入参，回退出码。 */
function run(command: string): number {
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
  });
  return r.status ?? -1;
}

describe("sleep-guard：拦 ≥60s 的 sleep，短退避放行（ISSUE #4118）", () => {
  it("sleep 300 ⇒ 拦（退 2），理由把出口指向 pnpm ship:wait", () => {
    const r = spawnSync(process.execPath, [GUARD], {
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "sleep 300 && pnpm ship --result" },
      }),
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    const err = r.stderr;
    expect(err).toContain("pnpm ship:wait");
    expect(err).toContain("硬规则 32");
  });

  it("短退避（<60s）⇒ 放行", () => {
    expect(run("sleep 5 && pnpm ship --result")).toBe(0);
    expect(run("sleep 0.5")).toBe(0);
  });

  it("带后缀与 PowerShell 形状都认：2m / 1h / Start-Sleep -Seconds 120 ⇒ 拦", () => {
    expect(run("sleep 2m")).toBe(2);
    expect(run("sleep 1h")).toBe(2);
    expect(run("Start-Sleep -Seconds 120")).toBe(2);
  });

  it("毫秒档按 1/1000 折算：Start-Sleep -Milliseconds 500 ⇒ 放行", () => {
    expect(run("Start-Sleep -Milliseconds 500")).toBe(0);
  });

  it("没有 sleep 的普通命令 ⇒ 放行；入参读不出来 ⇒ fail-open 放行", () => {
    expect(run("pnpm ship --result --json")).toBe(0);
    const bad = spawnSync(process.execPath, [GUARD], { input: "不是 JSON", encoding: "utf8" });
    expect(bad.status).toBe(0);
  });
});
