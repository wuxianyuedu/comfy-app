/**
 * `errors.ts` — 应用级错误体系（商业级错误分类 + HTTP 映射）
 * ===========================================================================
 *
 * 为什么需要统一错误类型
 * --------------------
 * 散落的 `throw new Error("xxx")` 无法被 {@link ./api} 可靠地区分「用户输入错误」
 * 与「服务器内部错误」，导致：前端拿不到稳定的错误码、监控无法按类型聚合、
 * 安全细节（堆栈）可能泄露给客户端。本文件定义一棵**可扩展的错误类树**，
 * 每个错误自带 `code`（稳定字符串，给前端/日志用）与 `httpStatus`。
 *
 * 分类约定
 * --------
 * | 错误类                | HTTP | 触发场景                               |
 * |-----------------------|------|----------------------------------------|
 * | `ValidationError`     | 400  | 入参缺失/类型错误/业务规则不满足        |
 * | `AuthError`           | 401  | 未登录/会话失效                         |
 * | `ForbiddenError`      | 403  | 已登录但无权访问该资源（越权）          |
 * | `NotFoundError`       | 404  | 资源不存在或不属于当前用户              |
 * | `ConflictError`       | 409  | 唯一约束冲突/并发写冲突                  |
 * | `DomainError`         | 422  | 领域不变量被破坏（状态机非法迁移等）     |
 * | `IntegrationError`    | 502  | 依赖的外部服务（ComfyUI 等）不可用      |
 * | `AppError`(基类)      | 500  | 未分类的内部错误（兜底）                |
 *
 * 配合 {@link ./api} 的 `toErrorEnvelope()`：错误被序列化为
 * `{ error: { code, message, details? } }`，**绝不**把堆栈下发到客户端。
 *
 * @module core/errors
 */

/** 所有应用错误的基类，携带稳定的 `code` 与目标 HTTP 状态。 */
export class AppError extends Error {
  /** 稳定、可读的错误码（如 `"validation.required"`），前端据此做分支。 */
  public readonly code: string;
  /** 对应的 HTTP 状态码。 */
  public readonly httpStatus: number;
  /** 可选的结构化附加信息（字段级错误等），仅用于日志/调试前端提示。 */
  public readonly details?: unknown;

  constructor(
    message: string,
    code = "internal",
    httpStatus = 500,
    details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    // 修复原型链（extends 内置 Error 时 ES5 目标下的已知坑）
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 入参校验失败 → 400。 */
export class ValidationError extends AppError {
  constructor(message: string, code = "validation", details?: unknown) {
    super(message, code, 400, details);
  }
}

/** 未认证 → 401。 */
export class AuthError extends AppError {
  constructor(message = "未登录或会话已失效", code = "auth.required") {
    super(message, code, 401);
  }
}

/** 已认证但无权访问 → 403。 */
export class ForbiddenError extends AppError {
  constructor(message = "无权访问该资源", code = "auth.forbidden") {
    super(message, code, 403);
  }
}

/** 资源不存在/不属于当前用户 → 404。 */
export class NotFoundError extends AppError {
  constructor(message = "资源不存在", code = "not.found") {
    super(message, code, 404);
  }
}

/** 唯一约束/并发冲突 → 409。 */
export class ConflictError extends AppError {
  constructor(message = "资源冲突", code = "conflict", details?: unknown) {
    super(message, code, 409, details);
  }
}

/** 领域不变量被破坏（如非法状态迁移）→ 422。 */
export class DomainError extends AppError {
  constructor(message: string, code = "domain", details?: unknown) {
    super(message, code, 422, details);
  }
}

/** 外部依赖（ComfyUI / 对象存储等）不可用 → 502。 */
export class IntegrationError extends AppError {
  constructor(message = "外部服务不可用", code = "integration") {
    super(message, code, 502);
  }
}

/**
 * 把任意异常归一化为 {@link AppError}：
 * - 已是 `AppError` → 原样返回；
 * - Prisma 已知错误码 → 映射为对应 `AppError`；
 * - 其余 → 包装为基类 `AppError`（保持 500，不泄露内部细节）。
 */
export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  // Prisma 客户端错误携带 `code`（如 P2025 记录不存在、P2002 唯一冲突）
  const prismaCode = (err as { code?: string })?.code;
  if (prismaCode === "P2025") {
    return new NotFoundError("记录不存在或已被删除", "db.not_found");
  }
  if (prismaCode === "P2002") {
    return new ConflictError("唯一约束冲突", "db.unique");
  }

  const message =
    err instanceof Error ? err.message : "未知内部错误";
  return new AppError(message, "internal", 500);
}

/**
 * 把 {@link AppError} 序列化为下发给客户端的紧凑信封。
 * 故意**不包含** `stack`，避免泄露服务端实现细节。
 */
export function toErrorEnvelope(err: AppError): {
  error: { code: string; message: string; details?: unknown };
} {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  };
}
