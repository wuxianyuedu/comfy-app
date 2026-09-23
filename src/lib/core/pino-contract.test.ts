import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
  createPinoLogger,
  redactSecretShaped,
  REDACT_PATHS,
} from "~/lib/core/logger";
import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";

/**
 * 日志「格式 + 脱敏」契约测试（原 `src/server/lib/logger.test.ts`）。
 *
 * 断言实现层（`core/logger` 的 pino 工厂与 ERROR 镜像）的四条契约，防止格式
 * 漂移或敏感字段落盘：
 * - 契约 1：日志必须是单行合法 JSON，含 level/time/msg 标准字段（采集端友好）。
 * - 契约 2：redact 对密钥/认证头生效（password/token/secret/apiKey → [Redacted]）。
 * - 契约 3：PII 与 prompt 原文默认被脱敏（规范 §11.5 埋点纪律扩展到日志契约），
 *   即便代码误把 prompt/email 塞进结构化字段也不会原样落盘。
 * - 契约 4：ERROR 镜像（app-runtime 通道）**不经 pino redact**，只写文本字段 ——
 *   它必须自己过值形状守卫，且绝不整包 `JSON.stringify`（§7.18.2.1）。
 *
 * 随「日志实现合并为一份」从 `src/server/lib/logger.test.ts` 迁移至此：实现现在
 * 在 `src/lib/core/logger.ts`，测契约的用例跟着实现走（`src/server/lib/logger.ts`
 * 已降为转发层，对它测等于对同一份实现测两遍）。
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
        password: "sample-password-明文",
        token: "sample-token-明文",
        apiKey: "sample-key-明文",
      },
      "audit",
    );
    await flush();

    const raw = lines()[0]!;
    expect(raw).not.toContain("sample-password-明文");
    expect(raw).not.toContain("sample-token-明文");
    expect(raw).not.toContain("sample-key-明文");
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
        client: {
          secret: "sample-nested-明文",
          apiSecret: "sample-api-value-明文",
        },
        req: {
          headers: {
            authorization: "Bearer sample-token-明文",
            cookie: "sid=sample-session",
          },
        },
      },
      "http",
    );
    await flush();

    const raw = lines()[0]!;
    expect(raw).not.toContain("sample-nested-明文");
    expect(raw).not.toContain("sample-api-value-明文");
    expect(raw).not.toContain("sample-token-明文");
    expect(raw).not.toContain("sid=sample-session");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.client).toEqual({
      secret: "[Redacted]",
      apiSecret: "[Redacted]",
    });
    expect(parsed.req).toEqual({
      headers: { authorization: "[Redacted]", cookie: "[Redacted]" },
    });
  });

  it("BETTER_AUTH_SECRET 类全局密钥不进日志", async () => {
    const { dest, lines } = capture();
    // ERROR 级会触发镜像（真实写盘）→ 给个丢弃型目标，别污染仓库 log/
    const log = createPinoLogger({
      destination: dest,
      mirror: { error: () => undefined },
    });
    log.error({ BETTER_AUTH_SECRET: "sample-value-明文" }, "cfg");
    await flush();

    const raw = lines()[0]!;
    expect(raw).not.toContain("sample-value-明文");
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

/* ── ERROR 级镜像进「应用日志」面板（ISSUE #360）─────────────────
 * 面板只轮询 launcher / dev-launcher / app-runtime；pino 的输出落在 nextjs 文件与
 * stdout，服务端 ERROR 因此在面板里完全不可见——用户遇到「操作失败但日志空的」
 * 时无从排查。这里把镜像契约钉住：ERROR 一定进 app-runtime，INFO 一定不进
 * （否则高频调用把真正的问题挤出视野）。
 *
 * **落盘目标是临时目录**：镜像是一条真实写盘副作用，早先这组用例直接读真实的
 * `log/services/app-runtime.log`（`slice(before.length)` 增量断言），于是
 * `pnpm test` 会在仓库根新建 `log/` 并写入若干行——包括用例里的「密钥原文」标记
 * 行（开发者本机多几行、CI 上从无到有），既是污染也是环境耦合。现在统一落到
 * 每个用例自己的 mkdtemp 目录。 */
describe("服务端 ERROR 镜像进面板（app-runtime）", () => {
  let tmpDir: string;
  let mirrorFile: string;

  /** 造一个只写本用例临时文件的镜像 logger（等价于 app-runtime 落盘通道）。 */
  function makeMirror(): {
    mirror: { error(msg: string, fields?: Record<string, unknown>): void };
  } {
    return { mirror: createAppRuntimeLogger("app", mirrorFile) };
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "logger-mirror-"));
    mirrorFile = join(tmpDir, "app-runtime.log");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function readMirror(): string {
    try {
      return readFileSync(mirrorFile, "utf8");
    } catch {
      return "";
    }
  }

  it("logger.error 会额外写一条 ERROR 进 app-runtime 日志", async () => {
    const { dest } = capture();
    const log = createPinoLogger({ destination: dest, ...makeMirror() });
    log.error({ err: new Error("no such table: llmConfig") }, "trpc_error");
    await flush();

    const added = readMirror();
    expect(added).toContain("[ERROR]");
    expect(added).toContain("no such table: llmConfig");
  });

  /* ── 字符串形态的 ERROR 也要带正文（ISSUE #440）────────────────────
   * 用户报的日志行是 `[app] 服务端错误 {"ns":"server","level":"error"}`：
   * 明明发生了 ERROR，面板里却只有一句无信息占位文案，等于「有错但看不出是什么错」。
   * 根因是镜像此前只认 `(obj, msg)` 一种调用形态，`logger.error("字符串")`
   * 的正文被整个丢弃——而仓库里多条真实调用正是字符串形态。 */
  it("logger.error(字符串) 的正文进面板，不再是占位文案", async () => {
    const { dest } = capture();
    const log = createPinoLogger({ destination: dest, ...makeMirror() });
    log.error("[upload] 503 ComfyUI unreachable — http://127.0.0.1:8188");
    await flush();

    const added = readMirror();
    expect(added).toContain("[ERROR]");
    expect(added).toContain("[upload] 503 ComfyUI unreachable");
    // 正文取到了，就不该再出现「信息量为零」的占位句
    expect(added).not.toContain("服务端错误");
  });

  it("结构化埋点的 event 名同时充当命名空间", async () => {
    const { dest } = capture();
    const log = createPinoLogger({ destination: dest, ...makeMirror() });
    log.error(
      { event: "audit_write_failed", err: new Error("disk full") },
      "audit",
    );
    await flush();

    const added = readMirror();
    // 命名空间落在行尾的结构化字段里（面板据此显示 [ns] 前缀）
    expect(added).toContain('"ns":"audit_write_failed"');
    expect(added).toContain("disk full");
  });

  it("纯对象、无 msg/err 时给出可读文案（键名清单）且不整包倒出字段值", async () => {
    const { dest } = capture();
    const log = createPinoLogger({ destination: dest, ...makeMirror() });
    log.error({ ns: "comfyui", detail: "启动超时" });
    await flush();

    const added = readMirror();
    expect(added).toContain('"ns":"comfyui"');
    expect(added).toContain("[ERROR]");
    // 键名清单：说明「有字段但没有正文」，而不是空行
    expect(added).toContain("detail");
  });

  /* 镜像**不受 pino redact 保护**（它是另一条落盘通道）：早先这里用
   * `JSON.stringify(payload)` 整包兜底，于是「名字没被 redact 覆盖的字段」——
   * 包括密钥——以明文写进面板可见的日志文件。
   *
   * 两个标记分别对应两类真实密钥形状：
   *   · `BETTER_AUTH_SECRET` —— 名字被 REDACT_PATHS 枚举到（pino 流里就擦掉）；
   *   · `BETTER_AUTH_GITHUB_CLIENT_SECRET` —— **名字没被枚举到**，且值是真密钥
   *     形态（64 位 hex，`openssl rand -hex 32` 的产物）。pino 的 `*` 通配只支持
   *     「整段」不支持「部分字符串」（实测 `*secret` / `*_SECRET` 全无效，`*`
   *     会把整条记录打成 [Redacted]），所以它只能靠**值形状守卫**兜住。 */
  const HEX_SECRET = randomBytes(32).toString("hex");

  it("镜像文件里也不许出现密钥原文（redact 不覆盖这条通道）", async () => {
    const { dest, lines } = capture();
    const log = createPinoLogger({ destination: dest, ...makeMirror() });
    log.error({ BETTER_AUTH_SECRET: HEX_SECRET }, "cfg");
    log.error({ BETTER_AUTH_GITHUB_CLIENT_SECRET: HEX_SECRET }, "cfg2");
    await flush();

    // 镜像文件不得含明文。
    expect(readMirror()).not.toContain(HEX_SECRET);
    // pino 流侧：被 REDACT_PATHS 枚举到的名字必擦；`*_SECRET` 这类**没被枚举到**
    // 的名字 pino 侧擦不掉（这是 pino 通配语义的限制，见 REDACT_PATHS 上方注释），
    // 其防线是日志写入边界上的值形状守卫——镜像文件那一行就是它的证词。
    expect(lines().join("")).not.toContain(
      `BETTER_AUTH_SECRET":"${HEX_SECRET}`,
    );
  });

  /* 值形状守卫本身（不问字段名，只问值长啥样）——这是 `*_SECRET` 这类
   * 「名字无法穷举」的密钥唯一的兜底，因此单独钉住它的判据与边界。 */
  it("值形状守卫：私钥块 / JWT / 高熵串被擦，普通长句不误伤", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\n<示例私钥内容>\n-----END RSA PRIVATE KEY-----";
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.example-placeholder-signature";
    expect(redactSecretShaped(pem)).toContain("[Redacted]");
    expect(redactSecretShaped(jwt)).toContain("[Redacted]");
    expect(redactSecretShaped(HEX_SECRET)).toBe("[Redacted]");
    // 嵌套结构里同样生效，且不改结构
    expect(
      redactSecretShaped({ a: { b: HEX_SECRET }, list: [HEX_SECRET] }),
    ).toEqual({
      a: { b: "[Redacted]" },
      list: ["[Redacted]"],
    });
    // 普通可读长句（无数字 / 低熵）不误伤
    const plain =
      "任务卡在队列超过 Ns，无人重新认领，请检查 ComfyUI 是否在运行";
    expect(redactSecretShaped(plain)).toBe(plain);
    // Error 实例保形：message 必须还在（`logger.error({ err })` 是最常见形态）
    const err = new Error("no such table: task");
    expect(redactSecretShaped(err)).toBe(err);
    // 环引用不炸
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => redactSecretShaped(cyclic)).not.toThrow();
  });

  it("logger.info 不写面板（高频调用不刷屏）", async () => {
    const { dest } = capture();
    const log = createPinoLogger({ destination: dest, ...makeMirror() });
    log.info({ path: "setting.get" }, "trpc_timing");
    await flush();

    expect(readMirror()).toBe("");
  });
});
