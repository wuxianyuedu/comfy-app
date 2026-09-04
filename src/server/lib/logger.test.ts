import { describe, expect, it, afterEach } from "vitest";
import { Writable } from "node:stream";
import { createPinoLogger, REDACT_PATHS } from "~/server/lib/logger";

/**
 * 可观测/日志契约测试（Issue #11）：
 * 断言 pino 服务端日志的「格式 + 脱敏」契约，防止格式漂移 / 敏感字段落盘。
 * - 契约 1：日志必须是单行合法 JSON，含 level/time/msg 标准字段（采集端友好）。
 * - 契约 2：redact 对密钥/认证头生效（password/token/secret/apiKey → [Redacted]）。
 * - 契约 3：PII 与 prompt 原文默认被脱敏（规范 §11.5 埋点纪律扩展到日志契约），
 *   即便代码误把 prompt/email 塞进结构化字段也不会原样落盘。
 */

/** 造一个可捕获输出的 Writable 目标流。 */
function capture(): { dest: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const dest = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  return { dest, lines: () => chunks.join("").trim().split("\n") };
}

/** 等到 pino 异步落盘完成（pino 底层异步写，给一小段时间）。 */
const flush = () => new Promise((r) => setTimeout(r, 30));

afterEach(() => {
  delete process.env.LOG_LEVEL;
});

describe("pino 输出格式契约", () => {
  it("每条日志是一行合法 JSON，含 level/time/msg 标准字段", async () => {
    const { dest, lines } = capture();
    const log = createPinoLogger({ destination: dest });
    log.info({ taskId: "t-1" }, "trpc_timing");
    await flush();

    expect(lines()).toHaveLength(1);
    const parsed = JSON.parse(lines()[0]!) as {
      level: number;
      time: number;
      msg: string;
      taskId: string;
    };
    // pino level 30 == info（数值编码，采集端靠数字分流）
    expect(parsed.level).toBe(30);
    expect(typeof parsed.time).toBe("number");
    expect(parsed.msg).toBe("trpc_timing");
    expect(parsed.taskId).toBe("t-1");
  });

  it("REDACT_PATHS 覆盖认证/密钥类敏感字段路径", () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining([
        "req.headers.authorization",
        "req.headers.cookie",
        "BETTER_AUTH_SECRET",
        "password",
        "*.password",
        "*.secret",
        "apiKey",
      ]),
    );
  });
});

describe("pino 脱敏契约（redact 生效）", () => {
  it("password/token/apiKey 顶层字段被 [Redacted]，明文绝不出现在日志", async () => {
    const { dest, lines } = capture();
    const log = createPinoLogger({ destination: dest });
    log.warn(
      {
        userId: "u-1",
        password: "p@ssw0rd-明文",
        token: "tok-明文",
        apiKey: "key-明文",
      },
      "audit",
    );
    await flush();

    const raw = lines()[0]!;
    expect(raw).not.toContain("p@ssw0rd-明文");
    expect(raw).not.toContain("tok-明文");
    expect(raw).not.toContain("key-明文");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.password).toBe("[Redacted]");
    expect(parsed.token).toBe("[Redacted]");
    expect(parsed.apiKey).toBe("[Redacted]");
  });

  it("嵌套字段（*.secret / apiSecret）与 req.headers 认证头被脱敏", async () => {
    const { dest, lines } = capture();
    const log = createPinoLogger({ destination: dest });
    log.info(
      {
        client: { secret: "nest-明文", apiSecret: "apisec-明文" },
        req: {
          headers: { authorization: "Bearer tok-明文", cookie: "sid=明文" },
        },
      },
      "http",
    );
    await flush();

    const raw = lines()[0]!;
    expect(raw).not.toContain("nest-明文");
    expect(raw).not.toContain("apisec-明文");
    expect(raw).not.toContain("tok-明文");
    expect(raw).not.toContain("sid=明文");
    const parsed = JSON.parse(raw) as {
      client: { secret: string; apiSecret: string };
      req: { headers: { authorization: string; cookie: string } };
    };
    expect(parsed.client.secret).toBe("[Redacted]");
    expect(parsed.client.apiSecret).toBe("[Redacted]");
    expect(parsed.req.headers.authorization).toBe("[Redacted]");
    expect(parsed.req.headers.cookie).toBe("[Redacted]");
  });

  it("BETTER_AUTH_SECRET 类全局密钥不进日志", async () => {
    const { dest, lines } = capture();
    const log = createPinoLogger({ destination: dest });
    log.error({ BETTER_AUTH_SECRET: "secret-明文" }, "cfg");
    await flush();

    const raw = lines()[0]!;
    expect(raw).not.toContain("secret-明文");
  });
});

describe("日志不落 PII / prompt 原文（§11.5 埋点纪律扩展到日志契约）", () => {
  it("prompt 原文作为结构化字段时被默认 [Redacted]，不会随日志泄露", async () => {
    const { dest, lines } = capture();
    const log = createPinoLogger({ destination: dest });
    log.info({ prompt: "一只在月球上的猫 wearing 蓝色围巾" }, "probe");
    await flush();

    const raw = lines()[0]!;
    expect(raw).not.toContain("一只在月球上的猫");
    const parsed = JSON.parse(raw) as { prompt: string };
    expect(parsed.prompt).toBe("[Redacted]");
  });

  it("嵌套 prompt / negativePrompt 同样被脱敏", async () => {
    const { dest, lines } = capture();
    const log = createPinoLogger({ destination: dest });
    log.info(
      { request: { prompt: "negative 明文", negativePrompt: "n-明文" } },
      "gen",
    );
    await flush();

    const raw = lines()[0]!;
    expect(raw).not.toContain("negative 明文");
    expect(raw).not.toContain("n-明文");
    const parsed = JSON.parse(raw) as {
      request: { prompt: string; negativePrompt: string };
    };
    expect(parsed.request.prompt).toBe("[Redacted]");
    expect(parsed.request.negativePrompt).toBe("[Redacted]");
  });

  it("PII（email/phone）不作为明文字段落盘", async () => {
    const { dest, lines } = capture();
    const log = createPinoLogger({ destination: dest });
    log.info({ email: "u@example.com", phone: "13800000000" }, "signup");
    await flush();

    const raw = lines()[0]!;
    expect(raw).not.toContain("u@example.com");
    expect(raw).not.toContain("13800000000");
    const parsed = JSON.parse(raw) as { email: string; phone: string };
    expect(parsed.email).toBe("[Redacted]");
    expect(parsed.phone).toBe("[Redacted]");
  });
});
