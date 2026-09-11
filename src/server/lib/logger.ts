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

export interface PinoLoggerOptions {
  /** 日志目标流。显式传入时走 JSON 直写（不经 pino-pretty worker transport），便于测试/定制输出。 */
  destination?: DestinationStream;
  /** 覆盖日志级别；缺省读 `LOG_LEVEL`，再回退 info。 */
  level?: string;
}

/**
 * 构造 pino logger 的工厂——同一份 level/redact 配置，生产与测试共用，
 * 保证「格式/脱敏契约」只在 logger.ts 一处定义、处处一致。
 */
export function createPinoLogger(opts: PinoLoggerOptions = {}) {
  const { destination, level } = opts;
  const base: LoggerOptions = {
    level: level ?? process.env.LOG_LEVEL ?? "info",
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
            const ns = typeof args[1] === "string" ? args[1] : "server";
            const payload =
              args[0] && typeof args[0] === "object"
                ? (args[0] as Record<string, unknown>)
                : undefined;
            appRuntimeLog.error(renderServerLogMessage(payload), {
              ns,
              level: "error",
            });
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
  return pino({ ...base, transport: { target: "pino-pretty", options: { colorize: true } } });
}

/** 全局默认 logger（Next 服务端 runtime / dev 用 pretty，prod 用 JSON）。 */
export const logger = createPinoLogger();

/* ── ERROR 行镜像进「应用日志」面板 ────────────────────────────────────────
 * 面板只轮询 launcher / dev-launcher / app-runtime 三个文件；pino 的输出落在
 * nextjs 文件与 stdout，因此「服务端有 ERROR、面板却一片空白」是常态。
 *
 * 镜像只做两件事：取一句可读的 msg（pino 的 msg 字段或该条键值），附上事件名。
 * 敏感字段已被 base.redact 在源头上擦掉，且这里只取 msg/err.message 文本，
 * 不整包透传 payload——避免把 prompt / PII 之类的字段二次落盘。
 */

/** 从结构化字段里取一句可读文案（优先 msg / err 的 message）。 */
function renderServerLogMessage(payload?: Record<string, unknown>): string {
  if (!payload) return "服务端错误";
  const raw = payload.msg ?? payload.message;
  if (typeof raw === "string" && raw.length > 0) return raw;
  const err = payload.err as { message?: unknown } | undefined;
  if (err && typeof err.message === "string" && err.message.length > 0) {
    return err.message;
  }
  try {
    const compact = JSON.stringify(payload);
    return compact.length > 300 ? `${compact.slice(0, 300)}…` : compact;
  } catch {
    return "服务端错误";
  }
}
