/**
 * `pnpm deps:guard` 的退出码三态：**判据读不到 ≠ 判过了且没问题**。
 *
 * 立案现场：归属判据在 Windows 上抛 TypeError，这个 CLI 没有 try/catch，
 * 直接把栈打到人脸上退 1 —— 看着像「判到有实例在跑」，其实一次也没判。
 * 反过来，若把异常吞成「没有实例在跑」就更坏：硬规则 9 那一问彻底失效。
 *
 * 这里把 `runningAppInstances` 换成假件，真跑一遍 CLI 顶层，逐态锁住
 * 退出码与话术。`process.exit` 顶成不真退出的假件，只为收走那一跳的码。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runningAppInstances: vi.fn() }));

vi.mock("../scripts/launcher-core/port-reap.mjs", () => ({
  runningAppInstances: mocks.runningAppInstances,
}));

/** 跑一次 CLI 顶层，收走这一轮的退出码与全部输出。
 *
 *  `process.exit` 用 `Reflect.set` 顶住：既不能真结束测试进程，也不能抛哨兵
 *  （CLI 把成功路径也包在 try 里，抛了会被它自己的 catch 念成「没给出结论」）。
 *  这样零类型断言 —— 全库 lint 的 `no-unsafe-type-assertion` 不放过 `as never`。
 */
async function runGuard() {
  const codes: Array<number | undefined> = [];
  const lines: string[] = [];
  const originalExit = process.exit.bind(process);
  Reflect.set(process, "exit", (code?: number) => {
    codes.push(code);
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    await import("../scripts/deps-install-guard.mjs");
  } finally {
    Reflect.set(process, "exit", originalExit);
  }
  return { code: codes[0] ?? null, text: lines.join("\n") };
}

beforeEach(() => {
  vi.resetModules();
  mocks.runningAppInstances.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deps-install-guard 退出码三态", () => {
  it("判据跑完且没有实例 ⇒ 0，明说可以装", async () => {
    mocks.runningAppInstances.mockResolvedValue({ running: false, pids: [], via: null });
    const result = await runGuard();
    expect(result.code).toBe(0);
    expect(result.text).toContain("可以执行 pnpm install");
  });

  it("判据跑完且确实有实例 ⇒ 1，给出 PID 与出口", async () => {
    mocks.runningAppInstances.mockResolvedValue({ running: true, pids: [4242], via: "port" });
    const result = await runGuard();
    expect(result.code).toBe(1);
    expect(result.text).toContain("PID 4242");
    expect(result.text).toContain("出口");
  });

  it("判据抛错 ⇒ 2「没给出结论」，绝不念成可以装", async () => {
    mocks.runningAppInstances.mockRejectedValue(new TypeError("out.split is not a function"));
    const result = await runGuard();
    expect(result.code).toBe(2);
    expect(result.text).toContain("没给出结论");
    expect(result.text).toContain("out.split is not a function");
    expect(result.text).not.toContain("可以执行 pnpm install");
  });

  it("判据读数形状走形 ⇒ 同样是 2，不被当成「没有实例在跑」", async () => {
    mocks.runningAppInstances.mockResolvedValue(undefined);
    const result = await runGuard();
    expect(result.code).toBe(2);
    expect(result.text).toContain("没给出结论");
    expect(result.text).not.toContain("可以执行 pnpm install");
  });
});
