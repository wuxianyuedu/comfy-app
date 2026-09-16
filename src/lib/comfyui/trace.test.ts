import { describe, it, expect } from "vitest";
import { redactSecretShaped } from "@/lib/core/redact-secret";
import {
  TRACE_MAX_LINE,
  traceStringify,
  historyTraceSummary,
  historyOutputKeys,
  queueTraceSummary,
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
