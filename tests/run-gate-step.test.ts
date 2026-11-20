/**
 * `runGateStep` —— 门禁判据子进程的统一同步执行器（ISSUE #4601）。
 *
 * 判据：正常收齐退出码与输出；墙钟预算到点把挂死的子进程砍掉（`timedOut` +
 * `outcome: "aborted"`，调用方按「未校验 ≠ 红」落 2，不冒充判据红）；起不来
 * （ENOENT）同样是 aborted；非零退出是「跑完了且红」（`ran` + `ok: false`）。
 * 这四态就是门禁链路从「无限卡住」里出来的全部出口。
 */
import { describe, expect, it } from "vitest";

import { GATE_STEP_DEFAULT_BUDGET_MS, runGateStep } from "../scripts/launcher-core/shell.mjs";

describe("runGateStep（ISSUE #4601）", () => {
  it("缺省预算是 600s（与 runSync/runNodeScript 同档）", () => {
    expect(GATE_STEP_DEFAULT_BUDGET_MS).toBe(600_000);
  });

  it("跑完：退出码与 stdout 收得齐，outcome=ran", () => {
    const r = runGateStep(process.execPath, ["-e", "console.log('gate-ok')"]);
    expect(r.outcome).toBe("ran");
    expect(r.ok).toBe(true);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("gate-ok");
    expect(r.timedOut).toBe(false);
  });

  it("预算到点：挂死的子进程被砍，timedOut=true、outcome=aborted、不冒充成功", () => {
    const r = runGateStep(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
      timeoutMs: 400,
    });
    expect(r.timedOut).toBe(true);
    expect(r.errorCode).toBe("ETIMEDOUT");
    expect(r.outcome).toBe("aborted");
    expect(r.ok).toBe(false);
    expect(r.status).not.toBe(0);
  }, 30_000);

  it("显式预算不被缺省值覆盖", () => {
    const r = runGateStep(process.execPath, ["-e", "process.exit(0)"], { timeoutMs: 1000 });
    expect(r.timeoutMs).toBe(1000);
  });

  it("起不来（ENOENT）：outcome=aborted 且带错误码，不抛异常", () => {
    const r = runGateStep("definitely-not-a-command-xyz-4601", [], { timeoutMs: 10_000 });
    expect(r.outcome).toBe("aborted");
    expect(r.errorCode).toBe("ENOENT");
    expect(r.ok).toBe(false);
  });

  it("非零退出：ran + ok=false（跑完了且红，与「没跑起来」分得开）", () => {
    const r = runGateStep(process.execPath, ["-e", "process.exit(3)"]);
    expect(r.outcome).toBe("ran");
    expect(r.status).toBe(3);
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(false);
  });

  it("stderr 也收得齐（判据的失败原因通道）", () => {
    const r = runGateStep(process.execPath, ["-e", "console.error('boom-4601'); process.exit(1)"]);
    expect(r.stderr).toContain("boom-4601");
    expect(r.status).toBe(1);
  });
});
