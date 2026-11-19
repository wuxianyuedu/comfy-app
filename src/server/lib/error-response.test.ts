/**
 * REST 错误出口的唯一形态（ISSUE #573）：15 个 route / 18 处手写信封与 `AuthError` 默认值逐字相同，改文案要改 18 处、新 route 还会照抄。
 * 钉三件事：未登录 401 信封与 `AuthError` 是同一份；非 AppError 一律 500 / internal 且不泄露 stack；
 * REST route 里不再出现手写信封字面量（防回潮）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMocks } = vi.hoisted(() => {
  /* 带签名的 mock：mock.calls 的元素是 [fields, msg]，测试里解构不落 any。 */
  const logFn = () => vi.fn<(fields: Record<string, unknown>, msg: string) => void>();
  return {
    loggerMocks: { debug: logFn(), info: logFn(), warn: logFn(), error: logFn() },
  };
});

/* errorResponse 的日志分级是本文件要钉的契约之一：mock 掉 logger 实例，
 * 但保留模块其余真实导出（与 trpc.test.ts 同一口径）。 */
vi.mock("~/server/lib/logger", () => ({ logger: loggerMocks }));

import { AuthError, NotFoundError } from "~/lib/core/errors";
import { errorResponse, unauthorizedResponse } from "./error-response";

describe("errorResponse", () => {
  it("AppError 子类用其 code / httpStatus", async () => {
    const res = errorResponse(new NotFoundError("任务不存在"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: { code: "not_found", message: "任务不存在" },
    });
  });

  it("非 AppError 归一化为 500 / internal", async () => {
    const res = errorResponse(new Error("db down"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: { code: "internal", message: "db down" },
    });
  });

  it("不下发 stack 与内部细节", async () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n    at secret/path.ts:1:1";
    const payload = JSON.stringify(await errorResponse(err).json());
    expect(payload).not.toContain("secret/path");
    expect(payload).not.toContain("stack");
  });

  it("401 信封与 AuthError 是同一份，不是长得像的第二份", async () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(new AuthError().httpStatus);
    await expect(res.json()).resolves.toEqual({
      error: { code: new AuthError().code, message: new AuthError().message },
    });
  });
});

describe("REST route 不再手写错误信封（防回潮）", () => {
  it("src/app/api 下无 { error: { code: ... } } 字面量", () => {
    const offenders: Array<string> = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) {
          continue;
        }
        const src = readFileSync(full, "utf8");
        if (/error:\s*\{\s*code:/.test(src)) {
          offenders.push(full);
        }
      }
    };
    walk(join(process.cwd(), "src/app/api"));
    expect(offenders).toEqual([]);
  });
});

describe("errorResponse 日志分级契约（#4092）", () => {
  beforeEach(() => {
    loggerMocks.error.mockClear();
    loggerMocks.debug.mockClear();
  });

  it("≥500 → logger.error 带原始 err 与 code（堆栈只进日志，不进响应体）", () => {
    const err = new Error("db down");
    const res = errorResponse(err);
    expect(res.status).toBe(500);
    expect(loggerMocks.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = loggerMocks.error.mock.calls[0] ?? [];
    expect(msg).toBe("rest_error");
    expect(fields).toMatchObject({ code: "internal", httpStatus: 500 });
    expect(fields?.err).toBe(err);
    expect(typeof fields?.stack).toBe("string");
    expect(loggerMocks.debug).not.toHaveBeenCalled();
  });

  it("4xx → 只落 logger.debug（预期内的客户端错误，不进告警面）", () => {
    const res = errorResponse(new NotFoundError("任务不存在"));
    expect(res.status).toBe(404);
    expect(loggerMocks.debug).toHaveBeenCalledTimes(1);
    const [fields, msg] = loggerMocks.debug.mock.calls[0] ?? [];
    expect(msg).toBe("rest_error_client");
    expect(fields).toMatchObject({ code: "not_found" });
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it("401（unauthorizedResponse）走 debug 档，不打 error", () => {
    unauthorizedResponse();
    expect(loggerMocks.debug).toHaveBeenCalledTimes(1);
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });
});
