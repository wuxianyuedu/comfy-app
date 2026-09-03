import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthError,
  ConflictError,
  DomainError,
  ForbiddenError,
  IntegrationError,
  MethodNotAllowedError,
  NotFoundError,
  ValidationError,
  normalizeError,
  toErrorEnvelope,
} from "~/lib/core/errors";

describe("errors — AppError 类树", () => {
  it("基类携带稳定 code 与 httpStatus,且原型链正确", () => {
    const e = new AppError("boom", "internal", 500);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AppError);
    expect(e.name).toBe("AppError");
    expect(e.code).toBe("internal");
    expect(e.httpStatus).toBe(500);
    expect(e.details).toBeUndefined();
  });

  it("子类默认值正确映射 HTTP 状态", () => {
    expect(new ValidationError("x").httpStatus).toBe(400);
    expect(new ValidationError("x").code).toBe("validation");
    expect(new AuthError().httpStatus).toBe(401);
    expect(new ForbiddenError().httpStatus).toBe(403);
    expect(new NotFoundError().httpStatus).toBe(404);
    expect(new ConflictError("x").httpStatus).toBe(409);
    expect(new DomainError("x").httpStatus).toBe(422);
    expect(new MethodNotAllowedError().httpStatus).toBe(405);
    expect(new IntegrationError().httpStatus).toBe(502);
  });

  it("子类可携带结构化 details", () => {
    const e = new ValidationError("x", "validation.required", { field: "name" });
    expect(e.details).toEqual({ field: "name" });
  });
});

describe("errors — normalizeError", () => {
  it("已是 AppError 则原样返回(同一引用)", () => {
    const e = new NotFoundError("nope");
    expect(normalizeError(e)).toBe(e);
  });

  it("Error 实例包装为 AppError(500,保留 message)", () => {
    const e = normalizeError(new Error("db down"));
    expect(e).toBeInstanceOf(AppError);
    expect(e.httpStatus).toBe(500);
    expect(e.code).toBe("internal");
    expect(e.message).toBe("db down");
  });

  it("非 Error 值统一为内部错误(不泄露细节)", () => {
    expect(normalizeError("str").message).toBe("未知内部错误");
    expect(normalizeError(null).httpStatus).toBe(500);
    expect(normalizeError(undefined).httpStatus).toBe(500);
  });
});

describe("errors — toErrorEnvelope", () => {
  it("不含 stack,details 缺省时不下发", () => {
    const env = toErrorEnvelope(new ValidationError("bad", "validation.required"));
    expect(env).toEqual({ error: { code: "validation.required", message: "bad" } });
  });

  it("details 存在时一并下发", () => {
    const env = toErrorEnvelope(new ValidationError("bad", "v", { field: "x" }));
    expect(env.error.details).toEqual({ field: "x" });
  });
});
