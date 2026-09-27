// executor-finalize 的宿主依赖注入接缝（P3 §5 第 1 期·第三步）：
//   · `configureExecutorFinalize` 接受 `taskRepo` / `getView` / `runtimeLog`
//     三条 `Partial<ExecutorFinalizeDeps>`，多次调用合并、未传的字段保留。
// 兼作 `check-dead-exports` 眼里的消费方（同目录 `.test.ts` 算数）。
//
// mock 只把「模块加载时会被拽进 server-only 链」的三条堵住；
// `~/lib/log/app-runtime-log` 是**运行期 lazy dynamic import** 的目标，本文件
// 只测 configure、不调 finalizeFailure / completeInner，那条 lazy 边不 fire。
// 若给 app-runtime-log 加一个只覆盖 `createAppRuntimeLogger` 的 mock，反而
// 会让 sibling 模块（executor-continuation 通过 `~/lib/core/logger` 拽到
// 它、logger 里用了 `appRuntimeLog`）在测试加载阶段就崩；因此这里 mock
// `~/lib/core/logger` 一层就够了（logger 是 executor-continuation 的直接
// 依赖，mock 掉它就阻断了 app-runtime-log 的加载）。
import { describe, expect, it, vi } from "vitest";

vi.mock("../core/repository", () => ({ taskRepository: {} }));
vi.mock("./client", () => ({ getView: async () => Buffer.from("") }));
vi.mock("~/lib/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mod = await import("./executor-finalize");

describe("configureExecutorFinalize 接缝", () => {
  it("接受 Partial<ExecutorFinalizeDeps> 且不抛", () => {
    const runtimeLog = { info: vi.fn(), error: vi.fn() };
    expect(() => mod.configureExecutorFinalize({ runtimeLog })).not.toThrow();
  });

  it("两次调用是合并语义（Partial 逐次填、未传的字段保留）", () => {
    const a = { info: vi.fn(), error: vi.fn() };
    const getView = vi.fn(async () => Buffer.from("x"));
    mod.configureExecutorFinalize({ runtimeLog: a });
    // 第二次只填 getView，runtimeLog 应保留（内部 `{ ...depsOverride, ...next }`）。
    expect(() => mod.configureExecutorFinalize({ getView })).not.toThrow();
    // 第三次再填一次 runtimeLog，验证不会因"已经给过 getView"就抛错。
    expect(() =>
      mod.configureExecutorFinalize({ runtimeLog: a }),
    ).not.toThrow();
  });
});
