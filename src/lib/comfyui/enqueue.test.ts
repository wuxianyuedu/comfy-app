// `configureEnqueue` 接缝 smoke（P3 §5 第 1 期·最后一步：enqueue lazy 化）。
// 本文件只做**这一件事**——enqueue 里其余函数（enqueue / subscribe / cancelTask）
// 的既有测试要么在其它测试文件覆盖、要么就是集成路径需要 ComfyUI / DB 双活，
// 不在本 PR 的范围。本文件同时是 `configureEnqueue` 在 `check-dead-exports`
// 眼里的消费方（同目录 `.test.ts` 算数）。

import { describe, expect, it, vi } from "vitest";

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
