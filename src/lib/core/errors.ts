/**
 * `errors.ts` — 应用级错误体系（错误契约 + 信封）
 * ===========================================================================
 *
 * 为什么需要统一错误类型
 * --------------------
 * 散落的 `throw new Error("xxx")` 无法可靠地区分「用户输入错误」
 * 与「服务器内部错误」，导致：前端拿不到稳定的错误码、监控无法按类型聚合、
 * 安全细节（堆栈）可能泄露给客户端。本文件定义唯一的 `AppError` 基类，
 * **每个错误自带 `code`（稳定字符串，给前端/日志用）与 `httpStatus`**，
 * 并由 {@link normalizeError} 把任意异常归一化到这条契约上。
 *
 * 这里只放**有生产调用方**的错误类
 * --------------------------------
 * 本文件曾按「HTTP 状态各配一个类」铺开九个子类（400/401/403/404/405/409/422/502），
 * 实测其中七个**零生产调用方** —— 它们唯一的「消费方」是本文件的测试。那是
 * 「为将来准备的分类树」：错误路径实际以 `TRPCError` 与 route 内的 `AuthError` /
 * `NotFoundError` 各自为政，多出来的类只是让人以为有分类。
 *
 * 裁决（ISSUE #573）：**契约（`AppError` + `code` + `httpStatus` + 归一化 + 信封）
 * 保留，未被消费的子类删掉**。新增一个状态码时不必先建类 —— 直接
 * `new AppError(message, code, status)` 即可，它会走同一条归一化与信封路径。
 * 反过来，**只有出现第一个真实调用方**才值得为某个状态码立一个具名类。
 *
 * 配合 {@link toErrorEnvelope}：错误被序列化为
 * `{ error: { code, message, details? } }`，**绝不**把堆栈下发到客户端。
 * REST Route Handler 用 `~/server/lib/error-response` 的 {@link errorResponse}
 * 一步产出该信封（含 HTTP 状态），不要各自手写 `{ error: { code, message } }`
 * 字面量。
 *
 * 与 tRPC 的分工
 * -------------
 * tRPC 侧的错误走它自己的 `TRPCError` + `errorFormatter`（`~/server/api/trpc.ts`），
 * **不经**本文件 —— 这是刻意的：两套框架的错误出口各自有契约，强行统一只会让
 * 其中一侧多一层无意义的转换。本文件服务的是 REST Route Handler。
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
    details?: unknown,
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

/** 未登录 / 会话失效 → 401。 */
export class AuthError extends AppError {
  constructor(
    message = "未登录或会话已失效",
    code = "auth.required",
    details?: unknown,
  ) {
    super(message, code, 401, details);
  }
}

/** 资源不存在 → 404。 */
export class NotFoundError extends AppError {
  constructor(message = "资源不存在", code = "not_found", details?: unknown) {
    super(message, code, 404, details);
  }
}

/**
 * 把任意异常归一化为 {@link AppError}：
 * - 已是 `AppError` → 原样返回；
 * - 其余 → 包装为基类 `AppError`（保持 500，不泄露内部细节）。
 */
export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  const message = err instanceof Error ? err.message : "未知内部错误";
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
