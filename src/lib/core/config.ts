/**
 * `config.ts` — 配置的**类型契约 + 默认值单一事实源**（不是「集中配置」）
 * ===========================================================================
 *
 * 本模块**不承诺**「所有配置都从这里读」。
 * --------------------------------------
 * 它的注释曾经写着「任何模块都应 `import { config } from "~/lib/core"` 后读取，
 * 而不是再直接读 `process.env`」—— 而实测这句承诺与现状**恰好相反**：
 *
 *   · `src/lib` 里直接读 `process.env` 的地方有 30+ 处（comfyui 实例端口与
 *     executor、llm 密钥、app-settings、kill-process-tree、open-in-browser …），
 *     其中绝大多数**改不动**：`config.ts` 自己的 schema 只覆盖 7 个变量，而
 *     真实用到的还有 `COMFYUI_PATH` / `COMFY_CLIENT_ID` / `LLM_*` / `FFMPEG_BIN`
 *     / `COMFYAPP_TASKKILL` 等一大批；
 *   · 于是「集中配置」只写在注释里，实际是**第 N 条口径** —— 下一个人照着改，
 *     只会再多一条。
 *
 * 裁决（ISSUE #568）：**删掉误导性承诺，把本模块降级为「契约 + 默认值」**，
 * 不假装收口。保留的三件事都是有消费方的：
 *
 *   1. {@link AppConfig} / {@link NodeEnv} 类型契约（`buildConfig()` 的产物形状）；
 *   2. **被复用变量**的类型化读取与默认值 —— `CONFIG_ENV_DEFAULTS` 导出的
 *      `COMFYUI_BASE_URL` / `COMFYAPP_PORT` 默认值，前端设置页与后端各自读
 *      `process.env` 时都从这里取（避免同一默认值在两侧漂移，规范 §12.14）；
 *   3. `features` 的开关型配置（`REAPER_ENABLED` / `DEBUG_MODE_DEFAULT`）——
 *      这两个变量的语义是「跑起来之后仍可能被读」的开关，与启动期固定的
 *      连接串不同，收在这里读是合适的。
 *
 * 校验失败行为
 * ------------
 * 若环境变量值非法（如 `COMFYUI_BASE_URL` 不是合法 URL），模块加载即抛出
 * 带字段名的可读错误（fail-fast），而不是在第一次请求时崩溃。
 *
 * > **新增配置项时怎么选**：与「连接 / 端口 / 库路径」有关的、**两侧都要读**的
 * > 变量，默认值放这里；纯启动期路径（如 `COMFYUI_PATH`）就地读 `process.env`
 * > 并写清为何不收口，不要为了「看起来集中」把它硬塞进来。
 *
 * @module core/config — 配置的**类型契约 + 默认值单一事实源**（不是「集中配置」）
 */
import { z } from "zod";

import { COMFYUI_DEFAULT_PORT, comfyUiBaseUrl } from "../endpoints";

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
  /** `DATABASE_URL`（SQLite 文件路径或远程连接串）。 */
  readonly databaseUrl: string;
  /** 本机 ComfyUI 的 REST 基础地址（强制 127.0.0.1，见安全约束）。 */
  readonly comfyuiBaseUrl: string;
  /** 本机 ComfyUI 的 WebSocket 地址（由 baseUrl 推导）。 */
  readonly comfyuiWsUrl: string;
  /** 应用开发服务监听端口，取值来自 .env 的 COMFYAPP_PORT。 */
  readonly port: number;
  /** 特性开关。 */
  readonly features: FeatureFlags;
}

/**
 * 各变量的**默认值**（唯一事实源）。
 *
 * 与 {@link configSchema} 共用这一份，是为了让「同一变量在别处也要读」的场景
 * 有处可取：前端设置页（浏览器侧，拿不到服务端 config 实例）与后端在读到空值时
 * 都必须落到同一个默认端口 / 回环地址，否则就是规范 §12.14 禁止的多份口径。
 */
export const CONFIG_ENV_DEFAULTS = {
  /**
   * 开发服务监听端口。
   *
   * **刻意不去 import `scripts/app-port.mjs` 的 `FALLBACK_PORT`**：那条链路的
   * 兜底是「检出路径推导失败」这种异常情况的最后一跳，而本值是
   * `COMFYAPP_PORT` 缺省时的正常默认 —— 两者当前同值（3100），语义不同。
   * `tests/comfyui-port-contract.test.ts` 一族用例负责核对「同一件事的几处口径
   * 不许漂移」，不靠把常量塞进一个模块来假装同源。
   */
  port: 3100,
  /** 本机 ComfyUI 的 REST 基础地址（回环主机 + `endpoints.ts` 的默认端口）。 */
  comfyuiBaseUrl: comfyUiBaseUrl(COMFYUI_DEFAULT_PORT),
} as const;

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
 * 环境变量里的**布尔字面量**解析（`REAPER_ENABLED` / `DEBUG_MODE_DEFAULT`）。
 *
 * 不用 `z.coerce.boolean()`：它等价于 `Boolean(value)`，按 **JS 真值**判断 ——
 * 而 `Boolean("false") === true`、`Boolean("0") === true`，于是按惯例写
 * `REAPER_ENABLED=false` **关不掉 reaper**，且没有任何提示。reaper 会**杀进程**，
 * 「想关掉但其实没关掉」的代价比一般配置项高得多。
 *
 * 认的形态（大小写不敏感，两侧空白先去掉）：真 = `1` / `true` / `yes` / `on`，
 * 假 = `0` / `false` / `no` / `off`，空串视为「没给」（落 default）。
 * **其余一律 fail-fast 且报出字段名**：拼错成 `ture` / `enable` 时静默取真值，
 * 等于把上面那个缺陷换个写法再犯一次 —— 宁可启动就报错，也不要一个猜错的开关。
 */
const ENV_BOOL_TRUE = new Set(["1", "true", "yes", "on"]);
const ENV_BOOL_FALSE = new Set(["0", "false", "no", "off"]);

/**
 * 把一个可选的环境变量字符串解析成布尔。
 *
 * 非法值走的是「两个分支都不匹配」而不是在 transform 里抛异常 —— zod **不捕获**
 * transform 抛出的异常，它会让 `safeParse` 直接 throw 出去，于是 `buildConfig()`
 * 的 fail-fast 分支被绕过、错误信息也丢掉了字段名。
 */
function envBool(field: string) {
  const normalize = (raw: string): string | false =>
    ENV_BOOL_TRUE.has(raw) ? "true" : ENV_BOOL_FALSE.has(raw) ? "false" : false;

  return z
    .string()
    .optional()
    .transform((raw) => (raw === undefined ? "" : raw.trim().toLowerCase()))
    .refine((raw) => raw === "" || normalize(raw) !== false, {
      message: "期望布尔字面量（true/false/1/0/yes/no/on/off），实际值非法",
    })
    .transform((raw) => (raw === "" ? undefined : normalize(raw) === "true"))
    .pipe(z.boolean().default(true))
    .describe(field);
}

/**
 * 配置 schema。每个字段都带默认值或宽松校验，确保任意部署环境都不会因缺变量而崩溃；
 * 仅对「格式正确性」做硬校验（如 URL 形态），非法则 fail-fast。
 */
const configSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  databaseUrl: z.string().min(1).default("file:./dev.db"),
  /* 默认值走 {@link CONFIG_ENV_DEFAULTS}（本机端点的单一事实源）：这里再写一遍
   * 裸地址/裸端口，就会出现「配置兜底值与连接侧/拉起侧各自漂移」的口径分叉
   * （规范 §12.14）。 */
  comfyuiBaseUrl: z.url().default(CONFIG_ENV_DEFAULTS.comfyuiBaseUrl),
  port: z.coerce
    .number()
    .int()
    .positive()
    .max(65535)
    .default(CONFIG_ENV_DEFAULTS.port),
  /* 开关型配置用 envBool() 解析字面量，不用 z.coerce.boolean() —— 后者按 JS
   * 真值判断，`REAPER_ENABLED=false` 会被读成 true（见 envBool 的说明）。 */
  reaperEnabled: envBool("REAPER_ENABLED"),
  debugModeDefault: envBool("DEBUG_MODE_DEFAULT").default(false),
});

/** 由原始 env 解析出强类型配置；失败时抛出可读错误（fail-fast）。 */
function buildConfig(): AppConfig {
  const parsed = configSchema.safeParse(readRawEnv());

  if (!parsed.success) {
    const issues = parsed.error.issues

      .map(
        (issue) => `  - ${issue.path.join(".") || "<root>"}: ${issue.message}`,
      )

      .join("\n");

    throw new Error(`应用配置校验失败，请检查环境变量：\n${issues}`);
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
 * 进程级单例：**只在真的需要「整棵配置树」时用**（当前唯一生产消费方是
 * `src/server/api/trpc.ts` 的 `t._config.isDev`）。只想知道某个变量的默认值时，
 * 用 {@link CONFIG_ENV_DEFAULTS}；只想读一个环境变量时，就地读 `process.env`。
 */
export const config: AppConfig = buildConfig();
