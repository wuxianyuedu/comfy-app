/**
 * comfy-cli 子进程表（`cliProcs`）必须是**进程级单例**（挂在 globalThis 上）。
 *
 * 它是 QUEUED reaper 判定「任务是否仍被本进程认领」的信号之一：raw UI-format
 * 路径的任务在 comfy-cli 回传 `prompt_id` 之前，DB 行一直是
 * `QUEUED / promptId=null`，reaper 只能靠 `cliProcs.has(taskId)` 认出「它还在
 * 跑」。若该 Map 是模块级变量，Next.js/Turbopack 重新求值模块时会造出一个
 * **空 Map**——而正在跑的 comfy-cli 句柄仍留在旧 Map 上——reaper 就看不到
 * 在飞任务，把健康任务误判为孤儿并标 FAILED（ISSUE #378）。
 *
 * 同族单例（runner-state / reaper 定时器 / lifecycle 启动锁）都已挂在
 * globalThis 上；这里钉住最后一个漏网项，防止后续重构又把它改回模块级变量。
 */
import { describe, it, expect, vi } from "vitest";

/* executor-cli 的模块图会拉到 DB / 日志等副作用依赖，这里全部 mock 掉，
 * 只验证 cliProcs 的实例身份——与 reaper 测试的打桩方式一致。 */
vi.mock("../core/repository", () => ({ taskRepository: {} }));
vi.mock("./client", () => ({ resolveComfyBase: vi.fn() }));
vi.mock("./runner-state", () => ({
  state: () => ({}),
  log: vi.fn(),
}));
vi.mock("./executor-finalize", () => ({ complete: vi.fn(), fail: vi.fn() }));
vi.mock("~/lib/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe("cliProcs — 进程级单例（HMR 安全）", () => {
  it("模块重新求值后拿到同一个 Map，在飞任务不丢句柄", async () => {
    const first = await import("./executor-cli");
    first.cliProcs.set("t-1", {} as never);

    // 模拟 HMR 重新求值：清模块缓存后再 import。
    // 若 cliProcs 是模块级 `new Map()`，这里会拿到一个**不同且为空**的 Map。
    vi.resetModules();
    const second = await import("./executor-cli");

    expect(second.cliProcs).toBe(first.cliProcs);
    expect(second.cliProcs.has("t-1")).toBe(true);
  });
});
