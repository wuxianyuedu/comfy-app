/**
 * 契约测试那一族的 **mock 边界实现体**（ISSUE #2173）。抽实现体不抽 `vi.mock`：声明必须留在各文件顶层（vitest 在 import
 * 前 hoist），但工厂体可共用 —— 各文件只留一行 `vi.mock("~/server/db", async () => dbMockBoundary())`，hoist 不变而
 * 替身形状只一份。此前五处各写一遍且漂了不红：孪生判据按整文件算重合（≥75% 且两边 ≥60 行），十行样板到不了比例（§12.12）。
 */
import { vi } from "vitest";

/** 内存库替身：`~/server/db` 的 `db` 出口换成 `createTestDb()`。 */
export async function dbMockBoundary() {
  const { createTestDb } = await import("./test-db");
  return { db: createTestDb() };
}

/** 会话替身：`auth.api.getSession` 恒回 `null`（未登录那一支由用例自己走真 router）。 */
export function sessionMockBoundary() {
  return { auth: { api: { getSession: vi.fn(() => null) } } };
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
 * 里程碑日志改写到本进程临时路径：否则 `pnpm test` 在仓库根建 `log/` 并写行数（硬规则 4；目录由 logger 按需 mkdir）。不能再用
 * `vi.hoisted`（每个调用点要留三行样板），改在工厂首次调用时生成（mock 求值本就在被测模块 import 前），各用例各自 pid + `Date.now()`
 * 互不覆盖。`@param actual` 为 `importOriginal()` 结果；`@param tag` 临时目录名的一部分，每文件自取。
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
