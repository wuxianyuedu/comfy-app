/**
 * 契约测试那一族的 **mock 边界实现体**（ISSUE #2173）。
 *
 * 为什么抽的是实现体而不是整块 `vi.mock`：`vi.mock` 的**声明**必须留在每个测试文件
 * 顶层（vitest 把它 hoist 到 import 之前），所以「同一块样板被抄五遍」一开始看起来
 * 没法共用 —— 但工厂函数体可以：各文件只留一行
 * `vi.mock("~/server/db", async () => dbMockBoundary())`，声明仍在本地、hoist 语义不变，
 * 而替身的**形状**只有一份。这一段此前在五份文件里各写一遍，漂了不会红：
 * 孪生判据按**整文件**算重合（≥75% 且两边 ≥60 行），十行的样板在两个各 200 行的
 * 文件里永远到不了那个比例（本批当场复算过，见 §12.12 那条边界）。
 *
 * 与 `./wire-contract`（同一族收「JSON 传输 + 少发列」两件）是同一个手法：
 * 抽的是**判据之间共享的那件机械事**，不抽断言。
 */
import { vi } from "vitest";

/** 内存库替身：`~/server/db` 的 `db` 出口换成 `createTestDb()`。 */
export async function dbMockBoundary() {
  const { createTestDb } = await import("./test-db");
  return { db: createTestDb() };
}

/** 会话替身：`auth.api.getSession` 恒回 `null`（未登录那一支由用例自己走真 router）。 */
export function sessionMockBoundary() {
  return { auth: { api: { getSession: vi.fn(async () => null) } } };
}

/**
 * 日志静音：`logger` 换成四只空函数，**其余出口原样保留**
 * （`importOriginal` 的结果由调用点传进来 —— 在替身里再 import 一次被测模块
 * 拿到的就是这份 mock 自己，那是自引用，不是「原始实现」）。
 */
export function loggerMockBoundary(actual: Record<string, unknown>) {
  return {
    ...actual,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

/**
 * 里程碑日志（`createAppRuntimeLogger`）改写到本进程专用的临时路径。
 *
 * 不隔离的现场是真实的：`pnpm test` 会在仓库根新建 `log/` 并写进行数
 * （硬规则 4 的「写日志类用例给自己的临时目录」）。目录本身由 logger 按需 mkdir。
 *
 * ⚠️ 路径**不能**再用 `vi.hoisted` 造：那样每个调用点还是各留三行样板。现在它
 * 落在工厂第一次被调用时（mock 的求值时机本来就在被测模块 import 之前），
 * 而且两个用例各自拿到自己的 pid + Date.now()，互不覆盖。
 *
 * @param actual `importOriginal()` 的结果（保留除 `createAppRuntimeLogger` 之外的出口）
 * @param tag 临时目录名的一部分 —— 每个测试文件给一个自己读得出的名字
 */
export function runtimeLogMockBoundary<
  T extends { createAppRuntimeLogger: (ns: string, file: string) => unknown },
>(actual: T, tag: string) {
  const runtimeLogFile = `${process.env.TMPDIR ?? "/tmp"}/${tag}-${process.pid}-${Date.now()}/app-runtime.log`;
  return {
    ...actual,
    createAppRuntimeLogger: (ns: string) => actual.createAppRuntimeLogger(ns, runtimeLogFile),
  };
}

/**
 * 派发续跑边界：`kickQueue` 由调用点给（用例要拿它断言「有没有被踢一脚」），
 * 其余三件是纯静音替身。
 */
export function continuationMockBoundary(kickQueue: unknown) {
  return {
    kickQueue,
    subscribe: vi.fn(),
    getLogs: vi.fn(),
    cancelTask: vi.fn(),
  };
}
