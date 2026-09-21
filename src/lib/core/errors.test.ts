import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthError,
  NotFoundError,
  normalizeError,
  toErrorEnvelope,
} from "~/lib/core/errors";

describe("errors — AppError 契约", () => {
  it("基类携带稳定 code 与 httpStatus,且原型链正确", () => {
    const e = new AppError("boom", "internal", 500);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AppError);
    expect(e.name).toBe("AppError");
    expect(e.code).toBe("internal");
    expect(e.httpStatus).toBe(500);
    expect(e.details).toBeUndefined();
  });

  it("没有专用子类的状态码直接用基类表达(不必先建类)", () => {
    const e = new AppError("缺东西", "conflict", 409, { id: "x" });
    expect(e.httpStatus).toBe(409);
    expect(e.code).toBe("conflict");
    expect(e.details).toEqual({ id: "x" });
  });

  it("子类默认值正确映射 HTTP 状态", () => {
    expect(new AuthError().httpStatus).toBe(401);
    expect(new AuthError().code).toBe("auth.required");
    expect(new NotFoundError().httpStatus).toBe(404);
  });

  it("子类可携带结构化 details", () => {
    const e = new NotFoundError("x", "not_found", { field: "name" });
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
    const env = toErrorEnvelope(new AuthError("bad", "auth.required"));
    expect(env).toEqual({ error: { code: "auth.required", message: "bad" } });
  });

  it("details 存在时一并下发", () => {
    const env = toErrorEnvelope(new NotFoundError("bad", "v", { field: "x" }));
    expect(env.error.details).toEqual({ field: "x" });
  });
});

/**
 * 「本文件只放有生产调用方的错误类」的**机器判据**（ISSUE #573）。
 *
 * 本文件曾铺开九个错误类，其中六个零生产调用方 —— 唯一的「消费方」是上面
 * 这些用例本身。那是最难被发现的一类死代码：**测试让覆盖率看起来是绿的**，
 * 而生产路径上没有任何一处走到它。所以判据不能是「有没有测试」，只能是
 * 「`src/**` 的生产代码里有没有 `new <类名>(`」。
 *
 * 实现上用 `git grep`（比手写 AST 扫描稳，且与评审看到的同一份文本）；
 * 命中只统计 `new X(`，于是「只被 import 却从不实例化」同样算零调用方。
 */
describe("errors — 错误类清单：每个导出都必须有生产调用方", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../../..");

  /** 生产代码里出现 `new <name>(` 的次数（排除测试文件与本文件）。 */
  function productionCallSites(name: string): number {
    let out = "";
    try {
      out = execFileSync(
        "git",
        [
          "grep",
          "-n",
          `new ${name}(`,
          "--",
          "src/**/*.ts",
          "src/**/*.tsx",
          ":(exclude)**/*.test.ts",
          ":(exclude)**/*.test.tsx",
          `:(exclude)src/lib/core/errors.ts`,
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );
    } catch {
      // git grep 无命中时退出码为 1（不是错误）——零调用方正是我们要断言的形态
      return 0;
    }
    return out.split("\n").filter((line) => line.trim().length > 0).length;
  }

  it("在用的具名子类都有生产调用方", () => {
    // ValidationError 是活跃契约（errors.ts 定义、request-body.ts 用作 §10.9 的
    // errorResponse 形态），故归入"必须有调用点"一侧，而非"该删的分类树"。
    for (const name of ["AuthError", "NotFoundError", "ValidationError"]) {
      expect(
        productionCallSites(name),
        `${name} 在 src/** 生产代码里没有任何 new 调用点 —— 要么接线上它，要么按 ISSUE #573 删掉`,
      ).toBeGreaterThan(0);
    }
  });

  it("已删除的类不会再回来(它们零调用方,只让错误契约看起来像分类树)", () => {
    for (const name of [
      "ForbiddenError",
      "ConflictError",
      "DomainError",
      "MethodNotAllowedError",
      "IntegrationError",
    ]) {
      expect(productionCallSites(name)).toBe(0);
    }
  });
});
