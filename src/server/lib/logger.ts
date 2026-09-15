import pino, { type DestinationStream, type LoggerOptions } from "pino";

import { appRuntimeLog } from "@/lib/app-runtime-log";

/**
 * 生产级结构化日志（pino）。
 *
 * - 生产输出 JSON 行（便于采集到 Datadog / Grafana / ELK）；
 *   本地开发用 pino-pretty 美化。
 * - redact 覆盖常见敏感字段（密钥/认证 + PII + 生成提示词原文），
 *   杜绝 password/token/secret 及 prompt 落盘（契约见 logger.test.ts）。
 * - 只记 userId 与事件类型，不把 PII 当明文字段。
 */

/** redact 脱敏路径（单一事实来源）：契约测试据此断言敏感字段永不落盘。 */
export const REDACT_PATHS = [
  // 认证/密钥类
  "req.headers.authorization",
  "req.headers.cookie",
  "BETTER_AUTH_SECRET",
  "password",
  "token",
  "*.password",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "apiSecret",
  "*.apiSecret",
  // 生成提示词原文 / 个人身份信息（PII）——埋点纪律 §11.5 扩展到日志契约：
  // 即便代码误把 prompt 等塞进结构化字段，也不会原样落盘。
  "prompt",
  "*.prompt",
  "negativePrompt",
  "*.negativePrompt",
  "email",
  "*.email",
  "phone",
  "phoneNumber",
] as const;

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

export interface PinoLoggerOptions {
  /** 日志目标流。显式传入时走 JSON 直写（不经 pino-pretty worker transport），便于测试/定制输出。 */
  destination?: DestinationStream;
  /** 覆盖日志级别；缺省读 `LOG_LEVEL`，再回退 info。 */
  level?: string;
  /**
   * 绑定的命名空间（pino 的 `bindings.ns`）。
   *
   * `lib/core/logger` 是**不带 `server-only`** 的核心层入口（它被纯 Node 宿主
   * 与 Next 服务端同时加载），它不能把命名空间塞进 `every log call` 的对象里，
   * 否则同一条日志的字段形状会随调用方漂移。绑定一次、处处带上，是 pino 的
   * 标准做法（`log.child({ ns })`）。
   */
  ns?: string;
  /**
   * 覆盖 ERROR 镜像的落盘目标（app-runtime 通道）。
   *
   * 默认走全局 `appRuntimeLog`（真实 `log/services/app-runtime.log`）。
   * 用例必须传自己的临时目录：镜像是一条**真实写盘**的副作用，不隔离就会
   * 往开发者/CI 的 `log/` 里写字（实测 `pnpm test` 会在仓库根新建 `log/`
   * 并写入 6 行，其中含被断言的「密钥原文」标记行）。
   */
  mirror?: { error(msg: string, fields?: Record<string, unknown>): void };
}

/**
 * 构造 pino logger 的工厂——同一份 level/redact 配置，生产与测试共用，
 * 保证「格式/脱敏契约」只在 logger.ts 一处定义、处处一致。
 */
export function createPinoLogger(opts: PinoLoggerOptions = {}) {
  const { destination, level, mirror, ns } = opts;
  const mirrorLog = mirror ?? appRuntimeLog;
  const base: LoggerOptions = {
    level: level ?? process.env.LOG_LEVEL ?? "info",
    ...(ns === undefined ? {} : { base: { ns } }),
    redact: [...REDACT_PATHS],
    /**
     * ERROR 级再镜像一条进「应用日志」面板（app-runtime 通道）。
     *
     * pino 输出落在 nextjs 文件 / stdout，而面板只轮询 launcher / dev-launcher /
     * app-runtime —— 服务端的 ERROR（tRPC 失败、任务落库失败、better-auth 报错）
     * 在面板里完全不可见，用户遇到「操作失败但日志空的」时无从排查（ISSUE #360）。
     * 这里只镜像 ERROR：INFO/DEBUG 属高频，进面板会把真正的问题挤出视野
     * （tRPC 计时已有自己的面板出口，见 trpc.ts 的 recordSlowQuery）。
     */
    hooks: {
      logMethod(args, method, levelNum) {
        if (levelNum >= 50) {
          try {
            // 先过密钥形状守卫：这条通道不经 pino redact（另一条写入路径），
            // 且字段名无法穷举 —— 只认「值长啥样」（见 redactSecretShaped）。
            const entry = renderServerLogEntry(args);
            mirrorLog.error(entry.msg, { ns: entry.ns, level: "error" });
          } catch {
            /* 镜像失败绝不影响日志主流程 */
          }
        }
        return method.apply(this, args as never);
      },
    },
  };

  // 显式指定目标流：JSON 直写，用于契约测试捕获输出（不启 worker transport）。
  if (destination) return pino(base, destination);

  // 生产：JSON 直写 stdout（采集端解析）。
  if (process.env.NODE_ENV === "production") return pino(base);

  // 本地开发：pino-pretty 美化。
  return pino({
    ...base,
    transport: { target: "pino-pretty", options: { colorize: true } },
  });
}

/** pino 实例类型（`createPinoLogger` 的返回；`lib/core/logger` 的薄封装据此包装）。 */
export type PinoLogger = ReturnType<typeof createPinoLogger>;

/** 全局默认 logger（Next 服务端 runtime / dev 用 pretty，prod 用 JSON）。 */
export const logger = createPinoLogger();

/* ── ERROR 行镜像进「应用日志」面板 ────────────────────────────────────────
 * 面板只轮询 launcher / dev-launcher / app-runtime 三个文件；pino 的输出落在
 * nextjs 文件与 stdout，因此「服务端有 ERROR、面板却一片空白」是常态。
 *
 * 镜像只做两件事：取一句可读的 msg（pino 的 msg 字段），附上事件名。
 *
 * **镜像必须自己保证「只有文本落盘」**：这条通道只取 `msg` / `err.message`
 * 这类**文本字段**，不整包透传 payload —— pino 的 `redact` 只作用于它自己的
 * 输出流，镜像走的是 `appRuntimeLog` 另一条写入路径，**不受 redact 保护**
 * （实测：`log.error({ BETTER_AUTH_SECRET: "MARKER" })` 在 pino 流里是
 * `[Redacted]`，镜像文件里却是明文）。因此这里绝不 `JSON.stringify(payload)`
 * 整包兜底：兜底会把「名字没被 redact 覆盖的任意字段」——包括密钥——原样写进
 * 面板可见的日志文件。对象既没有可读文本字段、又非空时，只输出**键名清单**
 * （键名本身不是值，不含密钥内容），把「有字段但没文案」这件事说清楚。
 */

/**
 * 把一条 pino 调用还原成「可读文案 + 命名空间」。
 *
 * pino 的调用签名有四种：`log.error(obj, msg)`、`log.error(msg)`、
 * `log.error(obj)`、`log.error(msg, ...args)`。历史上这里只认第一种——
 * **第一个参数不是对象时，整条 ERROR 的正文被丢弃**，镜像出去的只有一句
 * 无信息的「服务端错误」（形如 `[app] 服务端错误 {"ns":"server"}`）。
 * 而仓库里多条真实调用正是字符串形态（自定义 message 更易读，如
 * `logger.error("[upload] 503 ComfyUI unreachable — ...")`）。
 *
 * 现在四种签名都取得到正文：**字符串参数本身就是文案**，对象参数才走字段提取，
 * 对象里还带 `msg` 时（`log.error({ msg: "..." })`）以字段为准。
 * 命名空间依次尝试「字符串形态的第二个参数」与对象里的 `ns` /
 * `event`（结构化埋点两处都见过），都没有才回落 `server`。
 */
function renderServerLogEntry(rawArgs: unknown[]): { msg: string; ns: string } {
  // 二次防线（也覆盖直接调用本函数的路径）：先把 payload 里的密钥形状值擦掉再取文案。
  const args = rawArgs.map((a) => redactSecretShaped(a));
  const first = args[0];
  const second = args[1];
  // 两参形态（pino 的 (obj, msg) / (msg, ns)）：字符串里的正文优先取第二个参数
  const stringArg = typeof first === "string" ? first : undefined;
  const secondString = typeof second === "string" ? second : undefined;
  const payload =
    first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : undefined;

  // 空串按「没取到」处理：`??` 只挡 null/undefined，挡不住 ""（会写出空行）
  const firstNonEmpty = (...candidates: (string | undefined)[]) =>
    candidates.find((c) => c !== undefined && c.length > 0);

  const msg = payload
    ? (firstNonEmpty(renderServerLogMessage(payload), stringArg) ??
      "服务端错误")
    : // 没有结构化字段：字符串参数就是正文；再没有才回落占位文案
      (firstNonEmpty(stringArg, secondString) ?? "服务端错误");

  const payloadNs = [payload?.ns, payload?.event].find(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const ns = firstNonEmpty(payloadNs, secondString) ?? "server";
  return { msg, ns };
}

/** 从结构化字段里取一句可读文案（优先 msg / err 的 message）。
 *
 * 只取文本字段，**不做整包 JSON.stringify 兜底**——镜像通道不受 pino redact
 * 保护，整包兜底等于把任意字段（含未覆盖命名的密钥）写进面板可见的日志文件。
 */
function renderServerLogMessage(payload?: Record<string, unknown>): string {
  if (!payload) return "";
  const raw = payload.msg ?? payload.message;
  if (typeof raw === "string" && raw.length > 0) return raw;
  const err = payload.err as { message?: unknown } | undefined;
  if (err && typeof err.message === "string" && err.message.length > 0) {
    return err.message;
  }
  // 没有可读文案：只列键名（键名不是值，不含密钥内容），说明「有字段但没有
  // 正文」这一事实，而不是把字段值整包倒出来。
  const keys = Object.keys(payload);
  if (keys.length === 0) return "";
  return `（无可读文案；字段：${keys.join(", ")}）`;
}
