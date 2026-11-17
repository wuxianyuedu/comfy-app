/**
 * POST /api/logs/app-runtime 的写入契约（ISSUE #4051）。钉四条：未登录一律 401 且不触达
 * logger；限流与 tRPC `rateLimitedProcedure` 同一套滑动窗口（窗口内超限 429）；
 * msg 超长钳到 `RUNTIME_LOG_MESSAGE_MAX`、fields 序列化超长整段换成截断标记（该日志文件
 * 只追加不轮转，行体积必须有界）；ns / level / msg 形状不合法一律 400 且不写。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isRecord } from "~/lib/is-record";

const { createAppRuntimeLoggerMock, loggerSpies } = vi.hoisted(() => {
  const loggerSpies = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  return {
    loggerSpies,
    createAppRuntimeLoggerMock: vi.fn(() => loggerSpies),
  };
});

vi.mock("~/lib/log/app-runtime-log", () => ({
  createAppRuntimeLogger: createAppRuntimeLoggerMock,
}));

let authed = true;
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => (authed ? { id: "u1", email: "t@example.com", name: null } : null),
}));

const { POST } = await import("./route");
const { resetRateLimitBuckets } = await import("~/server/api/middleware/rate-limit");
const { RUNTIME_LOG_FIELDS_MAX, RUNTIME_LOG_MESSAGE_MAX } = await import("~/lib/text-clamp");

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/logs/app-runtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  authed = true;
  resetRateLimitBuckets();
  createAppRuntimeLoggerMock.mockClear();
  loggerSpies.info.mockClear();
  loggerSpies.warn.mockClear();
  loggerSpies.error.mockClear();
});

describe("POST /api/logs/app-runtime 鉴权", () => {
  it("未登录不写入：401，且 logger 一次都不被触达", async () => {
    authed = false;
    const res = await post({ ns: "app", level: "info", msg: "悄悄写一条" });
    expect(res.status).toBe(401);
    expect(createAppRuntimeLoggerMock).not.toHaveBeenCalled();
    expect(loggerSpies.info).not.toHaveBeenCalled();
  });
});

describe("POST /api/logs/app-runtime 校验", () => {
  it("ns 不在白名单 → 400 且不写", async () => {
    const res = await post({ ns: "别的命名空间", level: "info", msg: "x" });
    expect(res.status).toBe(400);
    expect(createAppRuntimeLoggerMock).not.toHaveBeenCalled();
  });

  it("level 不在白名单 → 400 且不写", async () => {
    const res = await post({ ns: "app", level: "debug", msg: "x" });
    expect(res.status).toBe(400);
    expect(createAppRuntimeLoggerMock).not.toHaveBeenCalled();
  });

  it("msg 缺失 / 非字符串 / 空串 → 400 且不写", async () => {
    for (const bad of [{}, { msg: 1 }, { msg: "" }]) {
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      const res = await post({ ns: "app", level: "info", ...bad });
      expect(res.status).toBe(400);
    }
    expect(createAppRuntimeLoggerMock).not.toHaveBeenCalled();
  });

  it("合法写入 → ok:true，logger 按级别收到 msg 与 fields", async () => {
    const res = await post({
      ns: "settings",
      level: "warn",
      msg: "设置加载失败",
      fields: { a: 1 },
    });
    expect(res.status).toBe(200);
    const payload: unknown = await res.json();
    expect(payload).toEqual({ ok: true });
    expect(createAppRuntimeLoggerMock).toHaveBeenCalledWith("settings");
    expect(loggerSpies.warn).toHaveBeenCalledWith("设置加载失败", { a: 1 });
  });
});

describe("POST /api/logs/app-runtime 体积钳制", () => {
  it("msg 超长 → 传给 logger 的 msg 被钳到 RUNTIME_LOG_MESSAGE_MAX（不标记）", async () => {
    const res = await post({
      ns: "app",
      level: "info",
      msg: "长".repeat(RUNTIME_LOG_MESSAGE_MAX + 100),
    });
    expect(res.status).toBe(200);
    const written: unknown = loggerSpies.info.mock.calls[0]?.[0];
    if (typeof written !== "string") {
      throw new Error("logger 收到的 msg 不是字符串");
    }
    expect(written.length).toBe(RUNTIME_LOG_MESSAGE_MAX);
  });

  it("fields 序列化超长 → 整段替换为截断标记（日志行体积有界）", async () => {
    const res = await post({
      ns: "app",
      level: "info",
      msg: "带大字段",
      fields: { blob: "x".repeat(RUNTIME_LOG_FIELDS_MAX + 100) },
    });
    expect(res.status).toBe(200);
    const fields: unknown = loggerSpies.info.mock.calls[0]?.[1];
    if (!isRecord(fields)) {
      throw new Error("logger 收到的 fields 不是对象");
    }
    expect(fields.truncated).toBe(true);
    const originalChars: unknown = fields.originalChars;
    if (typeof originalChars !== "number") {
      throw new Error("截断标记没带上原始字符数");
    }
    expect(originalChars).toBeGreaterThan(RUNTIME_LOG_FIELDS_MAX);
    /* 反向断言：超长的原文一段都不落盘 */
    expect(JSON.stringify(fields).length).toBeLessThan(RUNTIME_LOG_FIELDS_MAX);
  });

  it("fields 在上限内 → 原样透传（不误伤正常调用方）", async () => {
    const fields = { path: "/settings", attempt: 2 };
    const res = await post({ ns: "app", level: "info", msg: "x", fields });
    expect(res.status).toBe(200);
    expect(loggerSpies.info).toHaveBeenCalledWith("x", fields);
  });
});

describe("POST /api/logs/app-runtime 限流", () => {
  it("窗口内超过 20 次 → 429（与 tRPC rateLimitedProcedure 同一套滑动窗口）", async () => {
    for (let i = 0; i < 20; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      const res = await post({ ns: "app", level: "info", msg: `第 ${i} 条` });
      expect(res.status).toBe(200);
    }
    const res = await post({ ns: "app", level: "info", msg: "超限的一条" });
    expect(res.status).toBe(429);
    /* 超限那条没写：logger 只被前 20 条成功写入各触达一次 */
    expect(createAppRuntimeLoggerMock).toHaveBeenCalledTimes(20);
  });
});
