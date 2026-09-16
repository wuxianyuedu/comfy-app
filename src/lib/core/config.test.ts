import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* `config.ts` 是**模块级单例**（`export const config = buildConfig()`），
 * 所以每个用例都要重置模块缓存后再 import —— 不这样做的话第二个用例
 * 读到的是第一个用例的进程环境，默认值与校验分支全测不到。
 *
 * 用例只对准两件事：
 *   ① 默认值必须来自 CONFIG_ENV_DEFAULTS / endpoints（规范 §12.14 的口径单一）；
 *   ② 非法值 fail-fast，且错误信息里带**字段名**（否则排障时只知道「配置错了」）。
 */

const KEYS = [
  "NODE_ENV",
  "LOG_LEVEL",
  "DATABASE_URL",
  "COMFYUI_BASE_URL",
  "COMFYAPP_PORT",
  "REAPER_ENABLED",
  "DEBUG_MODE_DEFAULT",
] as const;

const saved: Record<string, string | undefined> = {};

async function loadConfig() {
  vi.resetModules();
  return await import("./config");
}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  // `NODE_ENV` 在 @types/node 里是**只读**的，所以统一走 `vi.stubEnv` 读写；
  // 其余键用 saved 快照还原（含「原本不存在 → 删掉」这一支）。
  vi.unstubAllEnvs();
  for (const k of KEYS) {
    if (k === "NODE_ENV") continue;
    if (saved[k] === undefined) delete process.env[k];
    else vi.stubEnv(k, saved[k]);
  }
});

describe("默认值", () => {
  it("变量全空时用默认值，且端口 / 地址与 CONFIG_ENV_DEFAULTS 同源", async () => {
    const { config, CONFIG_ENV_DEFAULTS } = await loadConfig();
    expect(config.port).toBe(CONFIG_ENV_DEFAULTS.port);
    expect(config.comfyuiBaseUrl).toBe(CONFIG_ENV_DEFAULTS.comfyuiBaseUrl);
    expect(config.env).toBe("development");
    expect(config.logLevel).toBe("info");
    expect(config.databaseUrl).toBe("file:./dev.db");
    expect(config.features.reaperEnabled).toBe(true);
    expect(config.features.debugModeDefault).toBe(false);
  });

  it("COMFYUI_BASE_URL 默认值必须回环 + endpoints 的默认端口（不许写 localhost）", async () => {
    const { CONFIG_ENV_DEFAULTS } = await loadConfig();
    const { COMFYUI_DEFAULT_PORT } = await import("../endpoints");
    // Node fetch 会先把 localhost 解析成 ::1，回环必须写 127.0.0.1。
    expect(CONFIG_ENV_DEFAULTS.comfyuiBaseUrl).toContain("127.0.0.1");
    expect(CONFIG_ENV_DEFAULTS.comfyuiBaseUrl).not.toContain("localhost");
    expect(CONFIG_ENV_DEFAULTS.comfyuiBaseUrl).toContain(
      String(COMFYUI_DEFAULT_PORT),
    );
  });
});

describe("环境三态", () => {
  it.each([
    ["development", true, false, false],
    ["test", false, false, true],
    ["production", false, true, false],
  ] as const)(
    "%s → isDev/isProd/isTest 互斥且正确",
    async (env, isDev, isProd, isTest) => {
      vi.stubEnv("NODE_ENV", env);
      const { config } = await loadConfig();
      expect(config.env).toBe(env);
      expect(config.isDev).toBe(isDev);
      expect(config.isProd).toBe(isProd);
      expect(config.isTest).toBe(isTest);
    },
  );

  it("非法 NODE_ENV 走 fail-fast 而不是静默当开发环境", async () => {
    vi.stubEnv("NODE_ENV", "staging");
    await expect(loadConfig()).rejects.toThrow(/nodeEnv/);
  });
});

describe("logLevel", () => {
  it.each(["debug", "info", "warn", "error"] as const)(
    "%s 合法",
    async (level) => {
      process.env.LOG_LEVEL = level;
      const { config } = await loadConfig();
      expect(config.logLevel).toBe(level);
    },
  );

  it("非法级别 fail-fast 且错误里带字段名", async () => {
    process.env.LOG_LEVEL = "verbose";
    await expect(loadConfig()).rejects.toThrow(/logLevel/);
  });
});

describe("port", () => {
  it("合法端口按数字解析（env 是字符串，必须强转）", async () => {
    process.env.COMFYAPP_PORT = "3456";
    const { config } = await loadConfig();
    expect(config.port).toBe(3456);
  });

  it.each(["0", "-1", "70000", "abc", "31.5"])(
    "%s 一律 fail-fast",
    async (bad) => {
      process.env.COMFYAPP_PORT = bad;
      await expect(loadConfig()).rejects.toThrow(/port/);
    },
  );
});

describe("comfyuiBaseUrl", () => {
  it("合法 URL 原样使用，WS 地址由它推导（http → ws）", async () => {
    process.env.COMFYUI_BASE_URL = "http://127.0.0.1:8188";
    const { config } = await loadConfig();
    expect(config.comfyuiBaseUrl).toBe("http://127.0.0.1:8188");
    expect(config.comfyuiWsUrl).toBe("ws://127.0.0.1:8188");
  });

  it("https 推导出 wss", async () => {
    process.env.COMFYUI_BASE_URL = "https://comfy.example";
    const { config } = await loadConfig();
    expect(config.comfyuiWsUrl).toBe("wss://comfy.example");
  });

  it("非 URL 的字符串 fail-fast（带字段名）", async () => {
    process.env.COMFYUI_BASE_URL = "not-a-url";
    await expect(loadConfig()).rejects.toThrow(/comfyuiBaseUrl/);
  });

  it("校验失败信息是可读清单，包含字段名与原始提示", async () => {
    process.env.COMFYUI_BASE_URL = "nope";
    process.env.COMFYAPP_PORT = "xyz";
    await expect(loadConfig()).rejects.toThrow(/应用配置校验失败/);
  });
});

describe("开关型配置", () => {
  it("「false」字面量被解析为 true —— 这是现存缺陷，本用例钉住现状", async () => {
    process.env.REAPER_ENABLED = "false";
    const { config } = await loadConfig();
    // `z.coerce.boolean()` 等价于 `Boolean(value)`，而 `Boolean("false") === true`
    // —— 它按 **JS 真值**而非「常见环境变量字符串」布尔字面量解析。
    // 于是按惯例写 `REAPER_ENABLED=false` **无法关闭** reaper，且没有任何提示。
    // 修复见 ISSUE 回报，本批不改源码。
    expect(config.features.reaperEnabled).toBe(true);
  });

  it('"0" 同样被解析为 true（同一缺陷的另一面）', async () => {
    process.env.REAPER_ENABLED = "0";
    const { config } = await loadConfig();
    expect(config.features.reaperEnabled).toBe(true);
  });

  it("空串是唯一能被解析为 false 的写法（未设置的等价形态）", async () => {
    process.env.REAPER_ENABLED = "";
    const { config } = await loadConfig();
    expect(config.features.reaperEnabled).toBe(false);
  });

  it("DEBUG_MODE_DEFAULT=true 打开调试抽屉默认值", async () => {
    process.env.DEBUG_MODE_DEFAULT = "true";
    const { config } = await loadConfig();
    expect(config.features.debugModeDefault).toBe(true);
  });

  it("DATABASE_URL 为空串时 fail-fast（min(1) 会在 coerce 之后命中，落不到默认值）", async () => {
    process.env.DATABASE_URL = "";
    // 注意：zod 的 `.default()` 只在字段为 `undefined` 时生效，空串是一个
    // **已提供**的值，所以它会走 `min(1)` 并失败 —— 这是刻意的 fail-fast，
    // 避免「.env 里写了个空 DATABASE_URL」静默落成默认库。
    await expect(loadConfig()).rejects.toThrow(/databaseUrl/);
  });

  it("自定义 DATABASE_URL 原样使用", async () => {
    process.env.DATABASE_URL = "file:./custom.db";
    const { config } = await loadConfig();
    expect(config.databaseUrl).toBe("file:./custom.db");
  });
});

describe("CONFIG_ENV_DEFAULTS", () => {
  it("是只读契约（as const），字段与 config 默认值一致", async () => {
    const { CONFIG_ENV_DEFAULTS } = await loadConfig();
    expect(Object.keys(CONFIG_ENV_DEFAULTS).sort()).toEqual([
      "comfyuiBaseUrl",
      "port",
    ]);
  });
});
