/**
 * `redact-secret.ts` — 密钥形状守卫（值形状判据，唯一实现）
 * ===========================================================================
 *
 * 本模块原在服务端日志实现文件内（该实现现已合并到 `src/lib/core/logger.ts`）。
 * 抽成独立模块的**唯一理由**是「两条落盘通道都要用它，而其中一条在 `lib` 侧」。
 * 两条通道是：
 *
 *   1. pino 的 ERROR 镜像（`src/lib/core/logger.ts`）——镜像走 `appRuntimeLog`
 *      另一条写入路径，**不受 pino `redact` 保护**（规范 07 §7.18.2.1）；
 *   2. ComfyUI 原始回执 trace（`src/lib/comfyui/trace.ts`）——直写文件，同样不经 pino。
 *
 * 若各写一份，两份判据必然漂移（规范 12.12 孪生对）。本模块**零框架依赖**
 * （不 import pino、不 import `server-only`），因此两条通道都能用；
 * `src/lib/core/logger.ts` 与服务端转发层各按原样 re-export 保住既有导入路径。
 *
 * @module core/redact-secret
 */
/* ── 密钥形状守卫：比枚举字段名更可靠的那一层 ──────────────────────────────
 * pino 的 `redact` 只认**精确路径**（`a.b.c`）与**整段通配**（`a.*` / `*.b`）。
 * 实测（Next 16.3.2 / pino 10）：
 *   · `*secret` / `*_SECRET` / `*secret*` 全都**不匹配**「部分字符串」，
 *     即 `BETTER_AUTH_GITHUB_CLIENT_SECRET` 这类 `*_SECRET` 命名一条都挡不住；
 *   · `*` 会把**整条记录**（连 `msg` / `level` 一起）打成 `[Redacted]`，
 *     日志直接不可读，同样不能用。
 * 于是「名字没枚举到就泄露」成了这套配置的结构性问题——而密钥恰恰是
 * 「起个什么名字都可能」的东西。
 *
 * 这一层不问字段名，只问**值长啥样**：私钥块（PEM）、JWT、以及长度 ≥ 32 的
 * base64url/hex 高熵串。它工作在日志边界（对整条 payload 递归），因此
 * ① 不受 pino 我们无法表达的匹配限制；② 同时覆盖 ERROR 镜像那条**不经 pino
 * redact 的**落盘通道。
 *
 * 已知边界（别把它当万能）：熵判据不拦「短密钥」「有语义的长口令」与
 * 「恰好是散文的密钥」；这些仍要靠字段命名（见 REDACT_PATHS）与调用侧纪律。
 * 判据选取可读性优先于覆盖率——高召回会误伤正常日志，反而没人敢留这道守卫。
 */
const PEM_BLOCK_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const JWT_RE =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g;
/* 高熵候选：整条串都是 `[A-Za-z0-9_-]`、长度 ≥ 24、**自带数字**（口令/散文几乎
 * 不含数字）；命中的 token 再按 Shannon 熵（≥ 3.5 bit/char）复核，避免把
 * 「长长的一串英文短横线词」误判成密钥。 */
const HIGH_ENTROPY_CANDIDATE = /\b[A-Za-z0-9_-]{24,}\b/g;
const ENTROPY_MIN = 3.5;

function shannonEntropy(value: string): number {
  const freq = new Map<string, number>();
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of freq.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** 这一小段文本是否「长得像密钥」。 */
function isSecretShaped(text: string): boolean {
  if (PEM_BLOCK_RE.test(text)) return true;
  PEM_BLOCK_RE.lastIndex = 0;
  if (JWT_RE.test(text)) return true;
  JWT_RE.lastIndex = 0;
  for (const m of text.matchAll(HIGH_ENTROPY_CANDIDATE)) {
    if (/[0-9]/.test(m[0]) && shannonEntropy(m[0]) >= ENTROPY_MIN) return true;
  }
  return false;
}

/**
 * 递归把 payload 里「长得像密钥」的字符串替换成 `[Redacted]`。
 *
 * 只做替换、不改结构；深度有上限，环引用直接截断（守卫自己绝不能崩）。
 * Error 实例**保形**（原样返回）：`logger.error({ err: new Error(...) })` 是仓库里
 * 最常见的形态，把错误对象摊平成普通对象会丢掉 `message` —— 那是镜像存在的全部意义。
 * 形状守卫只管字符串，不做脱敏兜底，因此不与 pino redact 的职责重叠。
 */
export function redactSecretShaped(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > 6) return value;
  if (typeof value === "string") {
    if (!isSecretShaped(value)) return value;
    return value
      .replace(PEM_BLOCK_RE, "[Redacted]")
      .replace(JWT_RE, "[Redacted]")
      .replace(HIGH_ENTROPY_CANDIDATE, (m) =>
        /[0-9]/.test(m) && shannonEntropy(m) >= ENTROPY_MIN ? "[Redacted]" : m,
      );
  }
  if (value === null || typeof value !== "object") return value;
  // Error（含其子类）：原样返回，保住 message / stack 的形状（pino 的
  // stdSerializers 也依赖它）。错误消息里即便真带密钥，也由值形状这一层
  // 在 message 字符串上就地擦除——但**不能**在这里改成普通对象。
  if (value instanceof Error) return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((v) => redactSecretShaped(v, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactSecretShaped(v, depth + 1, seen);
  }
  return out;
}
