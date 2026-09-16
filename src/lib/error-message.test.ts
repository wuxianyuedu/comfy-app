import { describe, expect, it } from "vitest";

import { errorMessage, rawErrorDetail } from "./error-message";

describe("errorMessage", () => {
  it("Error 取 message", () => {
    expect(errorMessage(new Error("炸了"), "兜底")).toBe("炸了");
  });

  it("带 message 字段的普通对象同样取出（tRPC 错误体不一定是 Error 实例）", () => {
    expect(errorMessage({ message: "网络错误" }, "兜底")).toBe("网络错误");
  });

  it("空串回落兜底——否则提示条是一片空白", () => {
    expect(errorMessage(new Error(""), "兜底")).toBe("兜底");
  });

  it("message 非字符串（数字/对象）时回落兜底", () => {
    expect(errorMessage({ message: 500 }, "兜底")).toBe("兜底");
    expect(errorMessage({ message: { code: "E" } }, "兜底")).toBe("兜底");
  });

  it("null / undefined / 原始值抛错一律回落兜底", () => {
    expect(errorMessage(null, "兜底")).toBe("兜底");
    expect(errorMessage(undefined, "兜底")).toBe("兜底");
    expect(errorMessage("boom", "兜底")).toBe("兜底");
    expect(errorMessage(0, "兜底")).toBe("兜底");
  });
});

describe("网络层报错翻译", () => {
  it("JSON 解析失败翻译成可读文案（ISSUE #220 设置页报错原文）", () => {
    const e = new Error(
      `Unexpected token '<', "<!DOCTYPE "...is not valid JSON`,
    );
    expect(errorMessage(e, "加载失败")).toBe(
      "服务返回了非预期内容（通常是应用服务正在重启或未就绪），请稍候重试",
    );
  });

  it("Failed to fetch 翻译成网络提示", () => {
    expect(errorMessage(new TypeError("Failed to fetch"), "兜底")).toBe(
      "网络请求失败，请检查应用服务是否正在运行",
    );
  });

  it("普通业务错误不受翻译影响，原样返回", () => {
    expect(errorMessage(new Error("模型名称已存在"), "兜底")).toBe(
      "模型名称已存在",
    );
  });

  it("翻译命中但配合空串仍走兜底", () => {
    expect(errorMessage(new Error(""), "兜底")).toBe("兜底");
  });
});

/* 回归 ISSUE #304：设置页只显示「请求被中断，应用服务可能正在重启」，但服务端
 * 真实报错是 `no such table: llmConfig`——用户按提示反复等重启，永远修不好。
 * 根因：tRPC 客户端在批量流式链路的失败里，顶层 message 是传输层包装
 * （`signal is aborted without reason`，React Query 重试中止上一轮请求所致），
 * 服务端原文只在 shape.message 里。取值时必须让位给服务端原文。 */
describe("tRPC 传输层包装文案让位给服务端原文", () => {
  it("顶层是 abort 包装 + shape.message 有服务端报错 → 用服务端报错", () => {
    const e = {
      name: "TRPCClientError",
      message: "signal is aborted without reason",
      shape: {
        message: "no such table: llmConfig",
        code: -32603,
      },
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
    };
    expect(errorMessage(e, "兜底")).toBe("no such table: llmConfig");
  });

  it("顶层与 shape 相同时不重复取，仍走翻译", () => {
    const e = {
      message: "Failed to fetch",
      shape: { message: "Failed to fetch" },
    };
    expect(errorMessage(e, "兜底")).toBe(
      "网络请求失败，请检查应用服务是否正在运行",
    );
  });

  it("只有顶层 abort 包装、没有服务端原文时，翻译成可读提示", () => {
    const e = { message: "signal is aborted without reason" };
    expect(errorMessage(e, "兜底")).toBe(
      "请求被中断，应用服务可能正在重启，请稍候重试",
    );
  });

  it("shape 为空对象时不误取，回落顶层 message", () => {
    const e = { message: "业务校验失败", shape: {} };
    expect(errorMessage(e, "兜底")).toBe("业务校验失败");
  });
});

/* 回归 ISSUE #304：面板只留翻译后的人话，服务端原文（code / httpStatus / stack
 * 首行）全丢，排查的人拿不到根因。rawErrorDetail 负责把原文拼出来落进日志的
 * `raw` 字段，与 errorMessage 各司其职。 */
describe("rawErrorDetail 保留原始报错供排查", () => {
  it("拼出 name / message / tRPC code / httpStatus", () => {
    const e = {
      name: "TRPCClientError",
      message: "no such table: llmConfig",
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
    };
    const out = rawErrorDetail(e);
    expect(out).toContain("TRPCClientError");
    expect(out).toContain("no such table: llmConfig");
    expect(out).toContain("code=INTERNAL_SERVER_ERROR");
    expect(out).toContain("http=500");
  });

  it("带上 cause 的底层错误（abort 包装场景）", () => {
    const cause = new Error("signal is aborted without reason");
    cause.name = "AbortError";
    const out = rawErrorDetail({
      message: "signal is aborted without reason",
      cause,
    });
    expect(out).toContain("cause=AbortError: signal is aborted without reason");
  });

  it("stack 只取头几行，不把整份堆栈塞进日志", () => {
    const e = {
      message: "boom",
      stack: [
        "boom",
        "at a (x.ts:1:1)",
        "at b (y.ts:2:2)",
        "at c (z.ts:3:3)",
      ].join("\n"),
    };
    const out = rawErrorDetail(e);
    // 头 3 行留在日志里，更深的帧不进（日志只需能定位入口）
    expect(out).toContain("at a (x.ts:1:1)");
    expect(out).toContain("at b (y.ts:2:2)");
    expect(out).not.toContain("at c (z.ts:3:3)");
  });

  it("超长内容截断，避免异常 payload 撑爆日志", () => {
    const out = rawErrorDetail({ message: "x".repeat(5000) }, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith("…")).toBe(true);
  });

  it("null / undefined / 无可提取信息时返回空串", () => {
    expect(rawErrorDetail(null)).toBe("");
    expect(rawErrorDetail(undefined)).toBe("");
    expect(rawErrorDetail({})).toBe("");
  });
});
