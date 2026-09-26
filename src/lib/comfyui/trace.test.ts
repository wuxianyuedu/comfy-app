import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { redactSecretShaped } from "~/lib/core/redact-secret";
import {
  TRACE_MAX_LINE,
  traceStringify,
  historyTraceSummary,
  historyOutputKeys,
  queueTraceSummary,
  trace,
  configureTraceLogPath,
} from "./trace";

describe("traceStringify — 任意回执都能落成可读文本", () => {
  it("字符串原样、null 归一", () => {
    expect(traceStringify("hi")).toBe("hi");
    expect(traceStringify(null)).toBe("null");
    expect(traceStringify(undefined)).toBe("null");
  });

  it("Error 带 stack", () => {
    const out = traceStringify(new Error("boom"));
    expect(out).toContain("Error: boom");
  });

  it("循环引用不抛错（兜底 String）", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => traceStringify(a)).not.toThrow();
  });
});

describe("historyTraceSummary — 把 /history 结论抽成「有没有结果、为什么没有」", () => {
  it("无条目 → found=false", () => {
    expect(historyTraceSummary("p1", {})).toEqual({
      found: false,
      outputNodeCount: 0,
    });
    expect(historyTraceSummary("p1", null).found).toBe(false);
  });

  it("有条目 → 报 status / completed / 输出节点数", () => {
    const v = historyTraceSummary("p1", {
      p1: {
        outputs: { "9": { images: [{ filename: "a.png" }] } },
        status: { status_str: "success", completed: true },
      },
    });
    expect(v).toEqual({
      found: true,
      outputNodeCount: 1,
      statusStr: "success",
      completed: true,
    });
  });

  it("execution_error → 抽出 exception_message", () => {
    const v = historyTraceSummary("p1", {
      p1: {
        outputs: {},
        status: {
          status_str: "error",
          messages: [
            ["execution_start", {}],
            ["execution_error", { exception_message: "CUDA OOM" }],
          ],
        },
      },
    });
    expect(v.executionError).toBe("CUDA OOM");
    expect(v.statusStr).toBe("error");
  });
});

describe("historyOutputKeys — 「跑完了，输出去哪了」", () => {
  it("列出每个节点的输出键", () => {
    expect(
      historyOutputKeys(
        {
          p1: {
            outputs: { "3": { images: [] }, "7": { text: "x", gifs: [] } },
          },
        },
        "p1",
      ),
    ).toEqual([
      { nodeId: "3", keys: ["images"] },
      { nodeId: "7", keys: ["text", "gifs"] },
    ]);
  });

  it("没有 outputs → 空数组（不抛）", () => {
    expect(historyOutputKeys({ p1: {} }, "p1")).toEqual([]);
    expect(historyOutputKeys(null, "p1")).toEqual([]);
  });
});

describe("queueTraceSummary — 失败收口时回答「任务其实还在跑吗」", () => {
  it("拆出 running / pending 的 prompt_id", () => {
    expect(
      queueTraceSummary({
        queue_running: [[1, "r1", {}]],
        queue_pending: [
          [2, "p1", {}],
          [3, "p2", {}],
        ],
      }),
    ).toEqual({ running: ["r1"], pending: ["p1", "p2"] });
  });

  it("空队列与非预期结构都归零", () => {
    expect(queueTraceSummary({})).toEqual({ running: [], pending: [] });
    expect(queueTraceSummary(null)).toEqual({ running: [], pending: [] });
  });
});

describe("trace 落盘前过值形状守卫（与 pino 镜像共用一份实现）", () => {
  it("原始回执里的 PEM / JWT / 高熵串被擦成 [Redacted]", () => {
    // trace 直写文件、不经 pino，因此脱敏必须在写入边界自己做一次。
    // 这里断言的是「写入前的那次变换」（trace() 本身会真实写盘，测试不触发它）。
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(traceStringify(redactSecretShaped({ err: pem }))).toContain(
      "[Redacted]",
    );
    expect(traceStringify(redactSecretShaped({ header: jwt }))).toContain(
      "[Redacted]",
    );
  });

  it("正常回执（stdout chunk / prompt_id / 文件名）原样保留", () => {
    const payload = {
      chunk: "Prompt executed in 3.2 seconds",
      promptId: "a1b2",
    };
    expect(redactSecretShaped(payload)).toEqual(payload);
  });
});

describe("TRACE_MAX_LINE", () => {
  it("有显式上限（单行不会把诊断文件写成 MB 级）", () => {
    expect(TRACE_MAX_LINE).toBeGreaterThan(1000);
    expect(TRACE_MAX_LINE).toBeLessThanOrEqual(64 * 1024);
  });
});

/** `trace()` + `configureTraceLogPath` 的落盘契约：
 *  P3 迁移第 1 期·第三步（trace 摘 server-only）之后，落盘路径不再由模块顶层
 *  静态值 import 决定——dynamic import 是否落地、或 executor host 是否
 *  `configureTraceLogPath()`，共同决定 `trace()` 是否写盘。测试写在**自己的
 *  临时目录**里，绝不落到仓库 `log/` （见 MEMORY 的「写日志类用例给自己的临时
 *  目录」条）。 */
describe("trace() 与 configureTraceLogPath 的落盘契约", () => {
  it("configureTraceLogPath 指向可写临时目录后，trace 追加一行、匹配格式", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "comfy-trace-"));
    try {
      const file = path.join(tmp, "comfyui-trace.log");
      configureTraceLogPath(file);
      trace("cli", "t-1", "hello 世界", { extra: "meta" });

      expect(existsSync(file)).toBe(true);
      const content = readFileSync(file, "utf-8");
      // 行格式：`[本地时间戳] [INFO] [trace] <channel> [<taskId>] <text>[ metaText]\n`
      expect(content).toMatch(
        /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] /,
      );
      expect(content).toContain("[INFO] [trace] cli [t-1] hello 世界");
      expect(content).toContain('"extra":"meta"');
      expect(content.endsWith("\n")).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("configureTraceLogPath 覆盖生效：第二次写入换目的地、第一份文件不追加", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "comfy-trace-"));
    try {
      const fileA = path.join(tmp, "a.log");
      const fileB = path.join(tmp, "b.log");
      configureTraceLogPath(fileA);
      trace("ws", "t-a", "first");
      configureTraceLogPath(fileB);
      trace("ws", "t-b", "second");

      const a = readFileSync(fileA, "utf-8");
      const b = readFileSync(fileB, "utf-8");
      expect(a).toContain("first");
      expect(a).not.toContain("second");
      expect(b).toContain("second");
      expect(b).not.toContain("first");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("路径不可写时 trace 静默 skip（旧契约：诊断通道不得把业务带崩）", () => {
    // 指向一个不存在的目录树（且父目录不可创建：给一个已经作为文件存在的路径
    // 当父目录用，`fs.mkdirSync({recursive:true})` 会抛 EEXIST/ENOTDIR）。
    const tmp = mkdtempSync(path.join(tmpdir(), "comfy-trace-"));
    try {
      const blocker = path.join(tmp, "blocker");
      // 用 `trace()` 自己的写入路径先造出一个**文件**，再让下一次 trace 把它当
      // 目录用；`fs.mkdirSync(dirname(blocker-file/blocker2), {recursive:true})`
      // 会撞 ENOTDIR / EEXIST，被外层 `try { } catch { }` 咽下。
      configureTraceLogPath(blocker);
      trace("http", "t-ok", "warm"); // 先建 blocker（作为文件）
      const nested = path.join(blocker, "deeper", "trace.log");
      configureTraceLogPath(nested);
      // 不抛、不 crash——契约就是「写不进去就静默」。
      expect(() => trace("http", "t-skip", "should not throw")).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
