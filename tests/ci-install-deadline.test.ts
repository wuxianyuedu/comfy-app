/**
 * `Install dependencies` 那一跳的**墙钟出口**（ISSUE #2360）。
 *
 * 现场：平台那一跑上它挂到 **8640s 硬上限**才被掐断（`cnb-c6r-1k5osfdl8`），整格日志
 * 19 行、pnpm 的输出一行都没有（前一步的 `check-pnpm-available` 刚在同一秒打印过
 * pnpm 12.4.1），而同机同链上一跑是 `Done in 2m 42.7s`。那一句话
 * `timeout of 8640000ms exceeded` 既不说是谁挂的，也不给下一动作。
 *
 * 这一组钉的是**收场方式**，不是耗时数字：
 *   · 超时 ⇒ 退 2（**未判定**，不是红也不是绿，§13.6.2）、打印卡在第几秒、把子进程收掉；
 *   · 跑完 ⇒ 退出码原样透出（判据一个字不改）；
 *   · 起不来 ⇒ 也归 2，且带上错误原文（「跑完但非零」与「没起来」是两档）。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_INSTALL_BUDGET_MS,
  HEARTBEAT_MS,
  UNDECIDED_EXIT,
  installBudgetMs,
  runInstallWithBudget,
} from "../scripts/ci-install-deadline.mjs";

/** 假子进程：`close` / `error` 由用例按场景触发。 */
class FakeChild extends EventEmitter {
  killed = false;
  kill() {
    this.killed = true;
    return true;
  }
}

function harness(script: (child: FakeChild) => void) {
  const child = new FakeChild();
  const lines: string[] = [];
  const pending = runInstallWithBudget({
    command: "pnpm",
    args: ["install", "--frozen-lockfile"],
    /* 假定时器只需「别真等」：预算给 1ms、心跳索性关掉（见各条用例）。 */
    budgetMs: 30,
    heartbeatMs: 1_000_000,
    spawnImpl: /* SAFETY: 类型断言已复核 */ (() => {
      script(child);
      return child;
    }) as never,
    write: (s: string) => lines.push(s),
    now: () => Date.now(),
  });
  return { child, lines, pending };
}

describe("装依赖那一跳的墙钟", () => {
  it("跑完：退出码原样透出，不判超时", async () => {
    const { child, pending } = harness((c) => {
      setImmediate(() => c.emit("close", 0, null));
    });
    const out = await pending;
    expect(out.code).toBe(0);
    expect(out.timedOut).toBe(false);
    expect(child.killed).toBe(false);
  });

  it("跑完但非零：原样透出（这是红，不是未判定）", async () => {
    const { pending } = harness((c) => {
      setImmediate(() => c.emit("close", 1, null));
    });
    expect((await pending).code).toBe(1);
  });

  it("预算用尽：退 2（未判定）、收掉子进程，并把「下一动作」写在脸上", async () => {
    const { child, lines, pending } = harness(() => {
      /* 永不 close —— 这就是「挂住」的形态。 */
    });
    const out = await pending;
    expect(out.timedOut).toBe(true);
    expect(
      out.code,
      "超时是「没拿到结论」，折成 1 会让人去修一条并不存在的红",
    ).toBe(UNDECIDED_EXIT);
    expect(child.killed, "光是判红不收子进程，下一次照样挂在那里").toBe(true);
    const text = lines.join("");
    expect(text).toContain("预算用尽");
    expect(text).toContain("下一动作");
    /* 那句「不要抬 timeout 换绿」不是客套：§11.13 明令禁止用抬预算掩盖负载。 */
    expect(text).toContain("§11.13");
  });

  it("起不来：归 2 且带错误原文（与「跑完但非零」分开）", async () => {
    const { pending } = harness((c) => {
      setImmediate(() => c.emit("error", new Error("ENOENT")));
    });
    const out = await pending;
    expect(out.code).toBe(UNDECIDED_EXIT);
    expect(out.error).toContain("ENOENT");
    expect(out.timedOut).toBe(false);
  });

  it("预算与心跳都有默认值，且 `COMFY_INSTALL_BUDGET_MS` 能覆盖", () => {
    expect(installBudgetMs({})).toBe(DEFAULT_INSTALL_BUDGET_MS);
    expect(installBudgetMs({ COMFY_INSTALL_BUDGET_MS: "1234" })).toBe(1234);
    /* 配错不是红：这一格的存在是为了早报，不是为了再加一条能被手滑弄红的输入面。 */
    for (const bad of ["", "abc", "0", "-5"]) {
      expect(installBudgetMs({ COMFY_INSTALL_BUDGET_MS: bad })).toBe(
        DEFAULT_INSTALL_BUDGET_MS,
      );
    }
    /* 预算必须比心跳大：反过来的话心跳一行都打不出来，这一格又回到「卡住了但没读数」。 */
    expect(DEFAULT_INSTALL_BUDGET_MS).toBeGreaterThan(HEARTBEAT_MS);
    /* 而它必须显著小于平台硬上限（8640s）—— 卡死要在十几分钟报出来，不是两小时。 */
    expect(DEFAULT_INSTALL_BUDGET_MS).toBeLessThan(86_400_00);
  });
});
