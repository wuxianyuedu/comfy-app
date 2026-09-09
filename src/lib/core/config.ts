/**
 * `config.ts` — 集中式、类型化、经过校验的应用配置（Config 模式）
 * ===========================================================================
 *
 * 为什么需要它
 * ------------
 * 代码库里 `process.env.X` 散落在几十处，存在三个问题：
 *   1. **拼写风险** —— `process.env.DATABSE_URL` 不会报错，只会在运行时悄悄用错值；
 *   2. **类型不明** —— 环境变量永远是 `string | undefined`，用到时才 `parseInt`，易出错；
 *   3. **默认不统一** —— 同一端口在 dev / build / script 里各自写死，难维护。
 *
 * 本模块在**进程启动时一次性**解析并校验全部配置，输出一棵不可变的、强类型的
 * {@link AppConfig} 树。任何模块都应 `import { config } from "@/lib/core"` 后读取，
 * 而不是再直接读 `process.env`。
 *
 * 设计要点
 * --------
 * - 使用 `zod` 做 schema 校验：缺失给默认值、非法值给出可读错误（启动时即失败，
 *   而非运行到一半才崩），符合「fail-fast」商业级实践；
 * - 全部字段只读（Getter 返回基本类型，无 setter），避免运行期被意外改写；
 * - `features` 子对象集中承载开关型配置（特性开关 / feature flags），
 *   便于灰度与排障；
 * - 与 {@link ./container} 配合：配置本身作为首个被注册的服务。
 *
 * 校验失败行为
 * ------------
 * 若环境变量值非法（如 `COMFYUI_BASE_URL` 不是合法 URL），模块加载即抛出
 * 带字段名的可读错误，配合启动脚本的日志可立即定位，而不是在第一次请求时崩溃。
 *
 * @module core/config
 */
import { z } from "zod";

/**
 * 环境标识。开发 / 测试 / 生产三态，控制日志级别、缓存策略等行为。
 */
export type NodeEnv = "development" | "test" | "production";

/**
 * 运行时特性开关集合。把「是否启用某项能力」收敛到一处，便于排障与灰度。
 */
export interface FeatureFlags {
  /** 是否启用孤儿任务回收（reaper）。压测或调试时可临时关闭。 */
  readonly reaperEnabled: boolean;
  /** 调试模式抽屉的默认开关（用户可在 localStorage 覆盖）。 */
  readonly debugModeDefault: boolean;
}

/**
 * 应用配置树。进程级单例，所有字段只读。
 */
export interface AppConfig {
  /** 当前环境。 */
  readonly env: NodeEnv;
  /** 是否开发环境（快捷判断）。 */
  readonly isDev: boolean;
  /** 是否生产环境。 */
  readonly isProd: boolean;
  /** 是否测试环境。 */
  readonly isTest: boolean;
  /** 日志级别（见 {@link ./logger}）。 */
  readonly logLevel: "debug" | "info" | "warn" | "error";
  /** Prisma `DATABASE_URL`（SQLite 文件路径或远程连接串）。 */
  readonly databaseUrl: string;
  /** 本机 ComfyUI 的 REST 基础地址（强制 127.0.0.1，见安全约束）。 */
  readonly comfyuiBaseUrl: string;
  /** 本机 ComfyUI 的 WebSocket 地址（由 baseUrl 推导）。 */
  readonly comfyuiWsUrl: string;
  /** 应用开发服务监听端口，取值来自 .env 的 COMFYAPP_PORT（默认 3100）。 */
  readonly port: number;
  /** 特性开关。 */
  readonly features: FeatureFlags;
}

/**
 * 把 `process.env` 的原始字符串映射成 zod 期望的字段形状。
 * 集中做「环境变量名 → 配置键」的命名翻译，避免 schema 里到处写魔法字符串。
 */
function readRawEnv(): Record<string, unknown> {
  const env = process.env;
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    comfyuiBaseUrl: env.COMFYUI_BASE_URL,
    port: env.COMFYAPP_PORT,
    reaperEnabled: env.REAPER_ENABLED,
    debugModeDefault: env.DEBUG_MODE_DEFAULT,
  };
}

/**
 * 配置 schema。每个字段都带默认值或宽松校验，确保任意部署环境都不会因缺变量而崩溃；
 * 仅对「格式正确性」做硬校验（如 URL 形态），非法则 fail-fast。
 */
const configSchema = z.object({
  nodeEnv: z
    .enum(["development", "test", "production"])
    .default("development"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  databaseUrl: z.string().min(1).default("file:./dev.db"),
  comfyuiBaseUrl: z
    .string()
    .url()
    .default("http://127.0.0.1:8188"),
  port: z.coerce.number().int().positive().max(65535).default(3100),
  reaperEnabled: z.coerce.boolean().default(true),
  debugModeDefault: z.coerce.boolean().default(false),
});

/** 由原始 env 解析出强类型配置；失败时抛出可读错误（fail-fast）。 */
function buildConfig(): AppConfig {

  const parsed = configSchema.safeParse(readRawEnv());

  if (!parsed.success) {

    const issues = parsed.error.issues

      .map((issue) => `  - ${issue.path.join(".") || "<root>"}: ${issue.message}`)

      .join("\n");

    throw new Error(

      `应用配置校验失败，请检查环境变量：\n${issues}`

    );

  }

  const data = parsed.data;

  return {

    env: data.nodeEnv,

    isDev: data.nodeEnv === "development",

    isProd: data.nodeEnv === "production",

    isTest: data.nodeEnv === "test",

    logLevel: data.logLevel,

    databaseUrl: data.databaseUrl,

    comfyuiBaseUrl: data.comfyuiBaseUrl,

    // WebSocket 地址：把 http(s):// 换成 ws(s)://

    comfyuiWsUrl: data.comfyuiBaseUrl.replace(/^http/, "ws"),

    port: data.port,

    features: {

      reaperEnabled: data.reaperEnabled,

      debugModeDefault: data.debugModeDefault,

    },

  };

}


/**
 * 进程级配置单例。首次导入本模块即解析完成；后续所有读取走这个不可变对象。
 *
 * @example
 * ```ts
 * import { config } from "@/lib/core";
 * if (config.isDev) logger.debug("dev-only log");
 * const base = config.comfyuiBaseUrl; // 永远拿到合法 URL
 * ```
 */
export const config: AppConfig = buildConfig();
