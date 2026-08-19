/**
 * `result.ts` — 无依赖的 `Result` 类型（函数式错误处理基础件）
 * ===========================================================================
 *
 * 用途
 * ----
 * 在「可能失败」的边界（数据库访问、外部 HTTP 调用、JSON 解析等）用
 * {@link Result} 显式表达成功/失败，替代散落的 `try/catch` 与 `null` 约定，
 * 让调用方**必须**处理失败分支，从类型层面消除「吞异常」与「未定义字段」。
 *
 * 设计要点
 * --------
 * - 不引入任何第三方依赖，纯 TS 类型 + 工厂/守卫函数，server / client 通用。
 * - 成功为 `{ ok: true, value }`，失败为 `{ ok: false, error }`，均为不可变字面量。
 * - 配合 {@link isOk} / {@link isErr} 类型守卫，TS 可在 `if (isErr(r))` 后自动收窄。
 * - 与 {@link ./errors} 的 {@link AppError} 体系配合：业务错误统一以
 *   `Err(error)` 承载，由 {@link ./api} 统一映射为 HTTP 状态。
 *
 * 示例
 * ----
 * ```ts
 * function parseId(raw: unknown): Result<string, AppError> {
 *   if (typeof raw !== "string" || raw.length === 0)
 *     return Err(new ValidationError("id 必须为非空字符串"));
 *   return Ok(raw);
 * }
 *
 * const r = parseId(input);
 * if (isErr(r)) return fail(r.error);  // 编译期强制处理失败分支
 * useId(r.value);                       // 此处 r.value 一定是 string
 * ```
 *
 * @module core/result
 */

/** 表示「计算可能失败」的容器：成功携带 `value`，失败携带 `error`。 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** 成功工厂：构造 `Ok`。 */
export function Ok<T, E = Error>(value: T): Result<T, E> {
  return { ok: true, value };
}

/** 失败工厂：构造 `Err`。 */
export function Err<T = never, E = Error>(error: E): Result<T, E> {
  return { ok: false, error };
}

/** 类型守卫：判定结果为成功，同时把 `value` 的类型收窄给 TS。 */
export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

/** 类型守卫：判定结果为失败，同时把 `error` 的类型收窄给 TS。 */
export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/**
 * 若成功，用 `fn` 转换内部值返回新的 `Ok`；失败则原样透传 `Err`。
 * 支持 `map → map → ...` 链式组合，且不破坏错误上下文。
 */
export function mapResult<T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  return r.ok ? Ok(fn(r.value)) : r;
}

/**
 * 若成功，把内部值交给返回 `Result` 的 `fn`，实现「成功链」扁平化组合
 * （语义等同 `Promise.then` 中返回另一个 Promise）。
 */
export function flatMapResult<T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

/**
 * 失败时返回 `fallback`，成功时返回 `value`。用于给不出错的下游提供默认值。
 */
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}
