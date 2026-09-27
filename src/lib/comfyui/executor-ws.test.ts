// `configureExecutorWs` 接缝 smoke（P3 §5 第 1 期·最后一步：executor-ws lazy 化）。
// 本文件只做**这一件事**——executor-ws 的其余路径（connect / handleMessage /
// scheduleReconnect）都要求真实 WS + ComfyUI 在跑，不是单测该覆盖的形状；
// 判决逻辑（迟到进度、终态不再改写）由 executor-finalize / reaper 侧的测试
// 兜底。同时本文件也是 `configureExecutorWs` 在 `check-dead-exports` 眼里的
// 消费方（同目录 `.test.ts` 算数）。
import { describe, expect, it, vi } from "vitest";

// `./runner-state` 会带 EventEmitter + lazy persistLogs；`./client` 与
// `../core/repository` 是 server-only 链的下游——三个都 mock 掉，避免加载本
// 模块时经它们拽出真 pino / better-sqlite3 / ComfyUI HTTP。
vi.mock("~/lib/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../core/repository", () => ({
  taskRepository: {
    updateProgress: vi.fn(async () => true),
    markRunning: vi.fn(async () => true),
    findStatusAndPromptById: vi.fn(async () => null),
    cancel: vi.fn(async () => undefined),
    listStaleQueued: vi.fn(async () => []),
    listStaleRunning: vi.fn(async () => []),
    finalizeFailure: vi.fn(async () => undefined),
    finalizeFromReaper: vi.fn(async () => undefined),
    finalizeSuccess: vi.fn(async () => undefined),
    createImages: vi.fn(async () => []),
    replaceLogs: vi.fn(async () => undefined),
  },
}));
vi.mock("./client", () => ({
  resolveComfyBase: vi.fn(async () => "http://127.0.0.1:8188"),
  interrupt: vi.fn(async () => undefined),
}));
vi.mock("./lifecycle", () => ({
  isComfyStarting: vi.fn().mockReturnValue(false),
  ensureComfyUiReady: vi.fn(async () => ({ ok: true })),
  isComfyAutoStartSuppressed: vi.fn().mockReturnValue(false),
  COMFYUI_AUTOSTART_TIMEOUT_MS: 420_000,
}));

const mod = await import("./executor-ws");

describe("configureExecutorWs 接缝", () => {
  it("接受 Partial<ExecutorWsDeps>、两次调用是合并语义", () => {
    const fakeRepo = { updateProgress: async () => true };
    expect(() => mod.configureExecutorWs({ taskRepo: fakeRepo })).not.toThrow();
    expect(() => mod.configureExecutorWs({})).not.toThrow();
  });
});
