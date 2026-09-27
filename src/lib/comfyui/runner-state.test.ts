// runner-state 的宿主依赖注入接缝（P3 迁移第 1 期·第二步）的锁测：
//   · `configureRunner({ taskRepo })` 覆盖后，`persistLogs` 走注入侧、不再打
//     直连的 `taskRepository` 单例；
//   · `configureRunner({ log })` 覆盖后，DB 失败分支走注入侧、不再打 `logger`。
// 两条用例合起来把「接缝真的接上了」这件事钉死，兼作 `check-dead-exports`
// 眼里的消费方（同目录 `.test.ts` 算数，见 scripts/check-dead-exports.cjs
// `TEST_CONSUMER_EXT`）。

import { beforeEach, describe, expect, it, vi } from "vitest";

// 把 logger / taskRepository 都先 mock 掉，避免测试路径触到真库/真日志文件；
// 具体断言靠 configureRunner 注入的**第二层**替身完成，这两份 mock 只是「默认侧
// 的兜底哨兵」，用来证明「configureRunner 一覆盖，就走不到它们」。
const defaultTaskRepoMock = {
  replaceLogs: vi.fn(async () => undefined),
};
const defaultLoggerMock = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../core/repository", () => ({
  taskRepository: defaultTaskRepoMock,
}));
vi.mock("~/lib/core/logger", () => ({ logger: defaultLoggerMock }));

// 上面两条 mock 必须先声明，import 才生效（vitest 会把 vi.mock hoist 到文件顶，
// 但被 mock 的模块里的**变量**要能被下面用例引用，所以 import 放最后）。
const loadRunnerState = async () => import("./runner-state");

describe("runner-state 的宿主依赖注入接缝（P3 第 1 期·第二步）", () => {
  beforeEach(async () => {
    defaultTaskRepoMock.replaceLogs.mockClear();
    defaultLoggerMock.warn.mockClear();
    // 把 deps 复位回默认，避免用例间串味（configureRunner 是**累积**覆盖，
    // 上一例注入的 fake 会留在这轮的 `deps` 里）。用同一份 mock 作为「注入的默认」，
    // 相当于把 deps 重新指回 taskRepository / logger 的替身。
    const mod = await loadRunnerState();
    mod.configureRunner({
      taskRepo: defaultTaskRepoMock,
      log: defaultLoggerMock,
    });
  });

  it("configureRunner({ taskRepo }) 之后 persistLogs 走注入侧、不再打默认 taskRepository", async () => {
    const mod = await loadRunnerState();
    const injectedReplace = vi.fn(async () => undefined);
    mod.configureRunner({ taskRepo: { replaceLogs: injectedReplace } });

    await mod.persistLogs("t-di-ok");

    expect(injectedReplace).toHaveBeenCalledTimes(1);
    expect(injectedReplace).toHaveBeenCalledWith("t-di-ok", []);
    expect(defaultTaskRepoMock.replaceLogs).not.toHaveBeenCalled();
  });

  it("注入的 taskRepo 抛错时，configureRunner({ log }) 的 warn 收到「落库失败」消息", async () => {
    const mod = await loadRunnerState();
    const injectedReplace = vi.fn(async () => {
      throw new Error("db-on-fire");
    });
    const injectedWarn = vi.fn();
    mod.configureRunner({
      taskRepo: { replaceLogs: injectedReplace },
      log: { warn: injectedWarn },
    });

    await mod.persistLogs("t-di-fail");

    expect(injectedReplace).toHaveBeenCalledTimes(1);
    expect(injectedWarn).toHaveBeenCalledTimes(1);
    // 用 stringContaining 避开 `mock.calls[0]` 的 any 解构；两次断言各锁一个 substring，
    // 同一份调用参数会同时满足它们。
    expect(injectedWarn).toHaveBeenCalledWith(
      expect.stringContaining("persistLogs(t-di-fail) 落库失败"),
    );
    expect(injectedWarn).toHaveBeenCalledWith(
      expect.stringContaining("db-on-fire"),
    );
    // 默认 logger 不该被绕过：注入 log 后失败分支只走注入侧。
    expect(defaultLoggerMock.warn).not.toHaveBeenCalled();
  });

  it("configureRunner 传 Partial 时未覆盖的一侧仍沿用默认（防止误清空）", async () => {
    const mod = await loadRunnerState();
    const injectedReplace = vi.fn(async () => undefined);
    // 只注入 taskRepo；log 一侧留空。
    mod.configureRunner({ taskRepo: { replaceLogs: injectedReplace } });

    // 让 taskRepo 抛错，触发 log 分支。
    injectedReplace.mockRejectedValueOnce(new Error("boom"));
    await mod.persistLogs("t-partial");
    expect(injectedReplace).toHaveBeenCalledTimes(1);
    // 未覆盖侧应回到默认 logger 的替身（vitest mock），而不是抛「log undefined」。
    expect(defaultLoggerMock.warn).toHaveBeenCalledTimes(1);
    expect(defaultLoggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("落库失败"),
    );
  });
});
