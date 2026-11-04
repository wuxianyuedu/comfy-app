/**
 * audit 审计日志「关键路径不静默」契约测试（Issue #11）：敏感操作（登录失败/提权/删除/导出…）必须留痕，且审计自身失败不能吞错 —— 用结构化日志（pino）兜底，保证可观测性不丢。
 * 断言：成功路径不抛错、不触发失败兜底；db 写入抛错时仍 `logger.error("audit_write_failed")`，杜绝静默失败。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { loggerErrorMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: () => {
        /* SAFETY: 类型断言已复核 */
        const rejectNow = (globalThis as { __REJECT_INSERT__?: boolean }).__REJECT_INSERT__;
        return rejectNow === true ? Promise.reject(new Error("db down")) : Promise.resolve();
      },
    })),
  },
}));
vi.mock("~/lib/core/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorMock,
  },
}));

import { audit } from "~/server/lib/audit";

function ctx() {
  return {
    session: null,
    headers: new Headers({ "x-forwarded-for": "1.2.3.4" }),
  };
}

/* SAFETY: 类型断言已复核 */
beforeEach(() => {
  (globalThis as { __REJECT_INSERT__?: boolean }).__REJECT_INSERT__ = false;
  loggerErrorMock.mockClear();
});

describe("audit 审计日志契约", () => {
  it("成功路径：审计写入不抛错、不触发失败兜底日志", async () => {
    await expect(audit("login_failed", ctx(), { email: "x@test.dev" })).resolves.toBeUndefined();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  /* SAFETY: 类型断言已复核 */
  it("失败路径：db 写入失败仍 logger.error('audit_write_failed')——关键路径不静默", async () => {
    (globalThis as { __REJECT_INSERT__?: boolean }).__REJECT_INSERT__ = true;
    // audit 内部 catch 住错误，不向调用方抛（不阻塞主流程）
    await expect(audit("role_changed", ctx(), { role: "admin" })).resolves.toBeUndefined();
    expect(loggerErrorMock).toHaveBeenCalled();
    /* SAFETY: 类型断言已复核 */
    const msg = loggerErrorMock.mock.calls[0]?.[1] as string;
    expect(msg).toBe("audit_write_failed");
    /* SAFETY: 类型断言已复核 */
    const fields = loggerErrorMock.mock.calls[0]?.[0] as {
      event?: string;
    };
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- fields 来自 mock.calls 经 `as` 断言，calls[0] 缺位时运行期为 undefined，`?.` 是防线
    expect(fields?.event).toBe("role_changed");
  });
});
