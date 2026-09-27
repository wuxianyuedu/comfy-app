// `configureEnqueue` 接缝 smoke（P3 §5 第 1 期·最后一步：enqueue lazy 化）。
// 本文件只做**这一件事**——enqueue 里其余函数（enqueue / subscribe / cancelTask）
// 的既有测试要么在其它测试文件覆盖、要么就是集成路径需要 ComfyUI / DB 双活，
// 不在本 PR 的范围。本文件同时是 `configureEnqueue` 在 `check-dead-exports`
// 眼里的消费方（同目录 `.test.ts` 算数）。

import { describe, expect, it, vi } from "vitest";
import type { TaskWriteOutcome } from "../core/repository-task-impl";

// `./reaper`（模块级副作用）与 `./executor`（barrel）会拉起 reaper 心跳 +
// WS 客户端；把 `../core/repository` 与 `./client` 都 mock 掉，保证本文件的
// import 路径不触真库 / 真 HTTP。
//
// 还要把 `~/lib/db`（`src/server/db` 的 re-export 垫片）也 mock 掉——
// barrel `../core/repository` 底下 12 个 `repository-*.ts` 都静态引 `~/lib/db`
// → `src/server/db.ts` → `~/env`；vitest 对 barrel 的 mock 不阻子模块被别的
// 静态边（例如 `./client` 经 `../endpoints` 与 `../app-settings/app-settings.server`
// 触到的路径）间接拽出，`src/env.js` 一旦跑就报 "Invalid environment variables"
// 变成 unhandled rejection。mock `~/lib/db` 后 `src/env.js` 根本不进。
vi.mock("~/lib/db", () => ({ db: {} }));
vi.mock("../core/repository", () => ({
  taskRepository: {
    findStatusAndPromptById: vi.fn(async () => null),
    cancel: vi.fn(async () => undefined),
  },
}));
vi.mock("./client", () => ({
  interrupt: vi.fn(async () => undefined),
  resolveComfyBase: vi.fn(async () => "http://127.0.0.1:8188"),
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("./lifecycle", () => ({
  isComfyStarting: vi.fn().mockReturnValue(false),
}));
vi.mock("./executor-cli", () => ({ cliProcs: new Map() }));

const mod = await import("./enqueue");
/* 下面两组用例要动到「注入接缝」与被 mock 的网络层，所以在模块顶层取句柄
 * （vitest 的 `vi.mock` 已被提升，这里拿到的是桩件而不是真实现）。 */
const client = await import("./client");
const runnerState = await import("./runner-state");
/* `enqueue.ts` 用的 `cliProcs` 来自 `./executor` → 再导出本文件 mock 掉的那份
 * Map，所以往这里塞句柄就等于「本进程正在执行该任务」。 */
const cli = await import("./executor-cli");

describe("configureEnqueue 接缝", () => {
  it("接受 Partial<EnqueueDeps>、两次调用是合并语义", () => {
    const fakeRepo = {
      findStatusAndPromptById: async () => null,
      cancel: async () => "written" as const,
    };
    expect(() => mod.configureEnqueue({ taskRepo: fakeRepo })).not.toThrow();
    // 再来一次空 Partial：合法、只是没覆盖任何东西。
    expect(() => mod.configureEnqueue({})).not.toThrow();
  });
});

/**
 * `cancelTask` 的条件性中断（P3 §5 ADR §14 D2）。
 *
 * 钉住的是「取消不许顺手打断别人的在飞任务」这条跨进程语义：ComfyUI 实例是共享
 * 的，而 `POST /api/interrupt` 不带 prompt 参数、一发就停**当前这一轮**。旧写法
 * 只要行上有 promptId 就 interrupt，于是取消一个「只是排在队列里」或「归另一个
 * 宿主在跑」的任务时，被停掉的是别人的活儿（而它随后会以失败收口）。
 *
 * 判据取「本进程是否握着这个任务的 comfy-cli 句柄」，不取 ComfyUI 的 `/queue`：
 * 实测 comfy-cli 提交的 prompt 在整轮执行期间不出现在 `queue_running`，用它当
 * 依据会退化成「永远不中断」。
 */
describe("cancelTask 的条件性中断（ADR §14 D2）", () => {
  const runnerLog = { warn: vi.fn() };
  let seq = 0;

  function setup(
    row: { status: string; promptId: string | null } | null,
    options: {
      cancelOutcome?: TaskWriteOutcome;
      /** true = 本进程握着该任务的 comfy-cli 子进程（正在执行）。 */
      inFlight?: boolean;
    } = {},
  ) {
    const { cancelOutcome = "written", inFlight = false } = options;
    const taskId = `cancel-${(seq += 1)}`;
    const repo = {
      findStatusAndPromptById: vi.fn(async () => row),
      cancel: vi.fn(async () => cancelOutcome),
      replaceLogs: vi.fn(async () => undefined),
    };
    mod.configureEnqueue({ taskRepo: repo });
    runnerState.configureRunner({ taskRepo: repo, log: runnerLog });
    vi.mocked(client.interrupt).mockReset().mockResolvedValue(undefined);
    const kill = vi.fn();
    if (inFlight) cli.cliProcs.set(taskId, { kill } as never);
    else cli.cliProcs.delete(taskId);
    return { taskId, repo, kill };
  }

  const logged = (taskId: string, needle: string): boolean =>
    mod.getLogs(taskId).some((entry) => String(entry.msg).includes(needle));

  it("本进程正在执行它：杀掉子进程并请求 ComfyUI 中断当前这一轮", async () => {
    const { taskId, repo, kill } = setup(
      { status: "RUNNING", promptId: "p-a" },
      { inFlight: true },
    );

    await mod.cancelTask(taskId);

    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(client.interrupt).toHaveBeenCalledTimes(1);
    expect(repo.cancel).toHaveBeenCalledWith(taskId);
    expect(logged(taskId, "已请求 ComfyUI 中断")).toBe(true);
  });

  it("本进程没在执行它（排队中 / 归另一宿主）：不发全局中断，状态照收", async () => {
    // 跨进程共享实例下的常见形态：行是 host 名下在跑的，Next 手里没有句柄。
    const { taskId, repo } = setup({ status: "RUNNING", promptId: "p-b" });

    await mod.cancelTask(taskId);

    expect(client.interrupt).not.toHaveBeenCalled();
    expect(repo.cancel).toHaveBeenCalledTimes(1);
    expect(logged(taskId, "不发送全局中断")).toBe(true);
  });

  it("中断请求失败：取消仍然落库，并告诉用户这一轮还会跑完", async () => {
    const { taskId, repo } = setup(
      { status: "RUNNING", promptId: "p-d" },
      { inFlight: true },
    );
    vi.mocked(client.interrupt).mockRejectedValue(new Error("ECONNREFUSED"));

    await mod.cancelTask(taskId);

    expect(repo.cancel).toHaveBeenCalledTimes(1);
    expect(logged(taskId, "中断请求失败")).toBe(true);
  });

  it("行已是终态：不补发合成的 CANCELLED 事件（不把「已完成」翻成取消）", async () => {
    const { taskId } = setup(
      { status: "SUCCEEDED", promptId: "p-e" },
      {
        cancelOutcome: "skipped-terminal",
      },
    );
    const seen: unknown[] = [];
    const off = mod.subscribe(taskId, (event) => seen.push(event));

    await mod.cancelTask(taskId);
    off();

    expect(
      seen.some(
        (event) => (event as { status?: string }).status === "CANCELLED",
      ),
    ).toBe(false);
    expect(client.interrupt).not.toHaveBeenCalled();
    expect(logged(taskId, "取消未改写终态")).toBe(true);
  });
});
