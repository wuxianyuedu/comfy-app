/**
 * `logger.ts` — 全应用日志的**唯一实现**（pino）
 * ===========================================================================
 *
 * 本模块曾是「零依赖自研日志器」：自己拼行、走 `console.log/error`、**没有任何
 * 脱敏**。而仓库另一侧 `src/server/lib/logger.ts` 是 pino（带 `REDACT_PATHS` +
 * 密钥值形状守卫 + ERROR 镜像进应用日志面板）。于是同一件事出现两条互不相通的
 * 通道，直接后果有三条：
 *
 *   1. **同一件事两种口径**：`LOG_LEVEL` 的读法、级别集合、输出形态各自实现一遍；
 *   2. **安全契约不成立**：`repository-base.ts` 的 `log.debug("update", patch)`
 *      若某天多带一个 `token` 字段，旧实现会原文落盘 —— pino 那条通道有 redact
 *      兜底，这条什么都没有（规范 07 §7.18.2.1 的脱敏契约在这条通道上失效）；
 *   3. **观测通道不完整**：`console.*` 不进 ERROR 镜像（面板「应用运行」那一路
 *      看不到），排查时「明明有 error，面板却一片空白」。
 *
 * 上一轮把它改成「服务端 pino 的薄封装」，消除了通道分叉，但**实现仍是两份同层
 * 模块**（`lib/core/logger` ⇄ `server/lib/logger`），只是其中一份转发给另一份。
 * 本轮把实现（level/redact/镜像/pretty 的全部配置）合并到**本文件**，
 * `src/server/lib/logger.ts` 改为一层**兼容转发**（既有导入路径逐字不变）。
 *
 * 为什么实现落在 `lib/` 而不是 `server/`
 * -------------------------------------
 * `lib` 是被 `server` / `components` / `app` 共同依赖的**地基**，而日志是典型的
 * 横切关注点。放在 `server/` 会让地基反过来依赖上层：`lib` 侧每一处要写日志的
 * 模块只能 `import { logger } from "~/server/lib/logger"`（实测曾有 11 条这样的
 * 越界边，只能靠清单逐个登记，见 `tests/lib-server-imports.test.ts`）。实现落在
 * `lib/core` 后方向天然正确：`lib → lib`，`server → lib`。
 *
 * 本模块**不带 `server-only`**（规范 §18.4 第三类）：它被 Next 服务端与纯 Node
 * 宿主同时加载，加上 `server-only`（入口就是一句 `throw`）会让 `scripts/*.mjs`
 * 的启动编排直接崩 —— `tests/lib-node-only-declarations.test.ts` 会核这一条。
 *
 * 两条写入路径，脱敏各管一段
 * -------------------------
 *   · pino 流（nextjs 文件 / stdout）：由下面的 `REDACT_PATHS` 按字段名擦；
 *   · ERROR 镜像（`log/services/app-runtime.log`，面板可见）：**不经 pino
 *     redact**，由 `./redact-secret` 的**值形状守卫**在写入边界擦，且只写文本
 *     字段、绝不整包 `JSON.stringify`（规范 07 §7.18.2.1 / AGENTS 硬规则 16）。
 *
 * @module core/logger
 */
import pino, { type DestinationStream, type LoggerOptions } from "pino";

import { appRuntimeLog } from "~/lib/app-runtime-log";
import { redactSecretShaped } from "~/lib/core/redact-secret";

/**
 * 值形状守卫实现见 `./redact-secret`（零框架依赖的纯逻辑）。
 * 它必须被两条落盘通道共用（pino 镜像 + comfyui trace），因此实现落在地基一侧；
 * 这里按原样 re-export，保住既有导入路径（`~/server/lib/logger` 也转出它）。
 */
export { redactSecretShaped };

/* ── 配置：level / redact / 镜像 / 输出形态（唯一实现）──────────────────── */

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

export interface PinoLoggerOptions {
  /** 日志目标流。显式传入时走 JSON 直写（不经 pino-pretty worker transport），便于测试/定制输出。 */
  destination?: DestinationStream;
  /** 覆盖日志级别；缺省读 `LOG_LEVEL`，再回退 info。 */
  level?: string;
  /**
   * 绑定的命名空间（pino 的 `bindings.ns`）。
   *
   * 核心层入口**不带 `server-only`**（它被纯 Node 宿主与 Next 服务端同时加载），
   * 它不能把命名空间塞进 `every log call` 的对象里，否则同一条日志的字段形状
   * 会随调用方漂移。绑定一次、处处带上，是 pino 的标准做法（`log.child({ ns })`）。
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
 * 保证「格式/脱敏契约」只在这里一处定义、处处一致。
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

/** pino 实例类型（`createPinoLogger` 的返回；`createLogger` 的薄封装据此包装）。 */
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

/* ── 核心层门面：命名空间拼接语义（调用方零改动）────────────────────────── */

/**
 * 日志器接口（核心层调用方的既有形态）。
 *
 * 保留 `child(ns)`：pino 的 `child({ ns })` 只绑上下文、不改绑定名，因此这里
 * 显式包装成「命名空间拼接」的语义（`a:b`），与旧接口逐字一致 —— 调用方
 * （各 repository、workshop 生成日志等）无需改动。
 */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** 派生子日志器，命名空间拼接为 `parent:child`。 */
  child(ns: string): Logger;
}

/** 绑定名放在 `ns` 字段（pino 的 `bindings` 会带上它，便于采集端按命名空间过滤）。 */
function wrap(inner: PinoLogger): Logger {
  // pino 的 `bindings()` 类型是 `Record<string, unknown>` 之外的自由形状，
  // 这里显式窄化，避免把 any 带进后续字符串拼接（本仓库零 any 口径）。
  const binding: unknown = (inner.bindings() as Record<string, unknown>).ns;
  const ns = typeof binding === "string" ? binding : "";
  const next = (childNs: string) =>
    wrap(inner.child({ ns: ns ? `${ns}:${childNs}` : childNs }));
  return {
    debug: (msg, fields) => inner.debug(fields ?? {}, msg),
    info: (msg, fields) => inner.info(fields ?? {}, msg),
    warn: (msg, fields) => inner.warn(fields ?? {}, msg),
    error: (msg, fields) => inner.error(fields ?? {}, msg),
    child: next,
  };
}

/**
 * 创建根日志器（命名空间在 `ns` 绑定里）。
 *
 * `opts` 只用于把落盘目标换成调用方自己的流（测试断言 JSON 行、或宿主自定义
 * 目标流）；常规调用方不需要传。
 */
export function createLogger(
  namespace: string,
  opts: Omit<PinoLoggerOptions, "ns"> = {},
): Logger {
  return wrap(createPinoLogger({ ...opts, ns: namespace }));
}

/** 全局默认核心层日志器（命名空间 `app`）。 */
export const coreLogger: Logger = wrap(createPinoLogger({ ns: "app" }));
