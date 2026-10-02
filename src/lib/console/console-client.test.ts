import { describe, expect, it } from "vitest";

import {
  clampOutput,
  consumeSseChunk,
  parseConsoleFrame,
  runConsoleCommand,
} from "./console-client";
import { MAX_OUTPUT_CHARS } from "./console-limits";

/** 造一个 SSE 帧文本（与路由的 `data: <json>\n\n` 同形）。 */
const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

/** 每收到一帧什么都不做的回调（多数用例只关心结局，不关心帧）。 */
const noop = () => undefined;

/** 替换 `globalThis.fetch` 并返回恢复函数 —— 每条用例自己收尾，别靠顺序。 */
function stubFetch(handler: () => Promise<Response>) {
  const real = globalThis.fetch;
  // 被读的只有响应形状（`ok` / `status` / `json` / `body`），调用参数无人关心。
  globalThis.fetch = () => handler();
  return () => {
    globalThis.fetch = real;
  };
}

/** 用手工 chunk 列表造一条真 `ReadableStream`（分块粒度是判据本身：
 *  「半个帧被续接下一次」只有在 chunk 边界处才看得出来）。 */
function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i] ?? ""));
      i++;
    },
  });
}

describe("parseConsoleFrame", () => {
  it("认四种帧并窄化字段", () => {
    expect(
      parseConsoleFrame({
        type: "start",
        runId: "r1",
        command: "pnpm test",
        cwd: "/x",
        startedAt: 123,
      }),
    ).toEqual({
      type: "start",
      runId: "r1",
      command: "pnpm test",
      cwd: "/x",
      startedAt: 123,
    });
    expect(
      parseConsoleFrame({ type: "out", stream: "stderr", text: "e" }),
    ).toEqual({ type: "out", stream: "stderr", text: "e" });
    expect(
      parseConsoleFrame({
        type: "exit",
        code: 1,
        signal: null,
        killed: false,
        truncatedNote: null,
        durationMs: 9,
      }),
    ).toEqual({
      type: "exit",
      code: 1,
      signal: null,
      killed: false,
      truncatedNote: null,
      durationMs: 9,
    });
    expect(parseConsoleFrame({ type: "error", message: "boom" })).toEqual({
      type: "error",
      message: "boom",
    });
  });

  it("缺失/错型的字段走有损兜底，不抛（流上不该因为一格坏掉整条断）", () => {
    const exit = parseConsoleFrame({ type: "exit" });
    expect(exit).toEqual({
      type: "exit",
      code: null,
      signal: null,
      killed: false,
      truncatedNote: null,
      durationMs: 0,
    });
    // out 缺 text 是**没有可展示内容**的帧：判 null（丢掉），而不是展示 "undefined"。
    expect(parseConsoleFrame({ type: "out" })).toBeNull();
    // start 缺 runId 同理：认不出是哪一次运行。
    expect(parseConsoleFrame({ type: "start", command: "x" })).toBeNull();
  });

  it("非对象 / 未知类型 / 缺 type 一律 null", () => {
    expect(parseConsoleFrame(null)).toBeNull();
    expect(parseConsoleFrame("x")).toBeNull();
    expect(parseConsoleFrame([])).toBeNull();
    expect(parseConsoleFrame({ type: "whatever" })).toBeNull();
    expect(parseConsoleFrame({})).toBeNull();
  });
});

describe("consumeSseChunk", () => {
  it("切出完整帧，并把不完整的一帧作为残余返回", () => {
    const frames: unknown[] = [];
    const rest = consumeSseChunk(
      `${frame({ type: "out", text: "a" })}data: {"type":"out","te`,
      (p) => frames.push(p),
    );
    expect(frames).toEqual([{ type: "out", text: "a" }]);
    // 残余原样带回来（**不能丢** —— 丢了就是「最后一行神秘消失」）。
    expect(rest).toBe('data: {"type":"out","te');
  });

  it("残余续接后能拼出一帧（跨 chunk 的 JSON 不会被切断）", () => {
    const frames: unknown[] = [];
    const rest1 = consumeSseChunk('data: {"type":"out","text":"he', (p) =>
      frames.push(p),
    );
    const rest2 = consumeSseChunk(`${rest1}llo"}\n\n`, (p) => frames.push(p));
    expect(frames).toEqual([{ type: "out", text: "hello" }]);
    expect(rest2).toBe("");
  });

  it("一次 chunk 里的多帧按顺序全部回调", () => {
    const frames: unknown[] = [];
    consumeSseChunk(
      frame({ type: "out", text: "1" }) + frame({ type: "out", text: "2" }),
      (p) => frames.push(p),
    );
    expect(frames).toEqual([
      { type: "out", text: "1" },
      { type: "out", text: "2" },
    ]);
  });

  it("畸形 JSON 的帧被丢掉，不影响后续帧", () => {
    const frames: unknown[] = [];
    consumeSseChunk(
      `data: {oops\n\n${frame({ type: "out", text: "ok" })}`,
      (p) => frames.push(p),
    );
    expect(frames).toEqual([{ type: "out", text: "ok" }]);
  });

  it("忽略非 data: 行与空 data 行（SSE 的注释与心跳）", () => {
    const frames: unknown[] = [];
    consumeSseChunk(": ping\ndata:\n\n", (p) => frames.push(p));
    expect(frames).toEqual([]);
  });
});

describe("clampOutput", () => {
  it("未超上限时原样返回", () => {
    expect(clampOutput("abc")).toBe("abc");
  });

  it("超上限时从**头部**裁（尾部才是结论）", () => {
    // 必须明显超过上限：只超一点点时裁掉的头还不如加的那行说明长。
    const huge = `${"x".repeat(MAX_OUTPUT_CHARS * 2)}TAIL`;
    const clamped = clampOutput(huge);
    expect(clamped.endsWith("TAIL")).toBe(true);
    expect(clamped).toContain("更早的输出已裁剪");
    // 结果长度 ≈ 上限 + 那行说明（远小于原文）。
    expect(clamped.length).toBeLessThan(MAX_OUTPUT_CHARS + 100);
    expect(clamped.length).toBeLessThan(huge.length);
  });
});

describe("runConsoleCommand", () => {
  it("非 2xx 读服务端信封的文案 → rejected（这是用户能修的那一类）", async () => {
    const restore = stubFetch(
      async () =>
        new Response(
          JSON.stringify({ error: "已有一条命令在运行：pnpm test" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    const events: unknown[] = [];
    const outcome = await runConsoleCommand({
      command: "x",
      onEvent: (e) => events.push(e),
    });
    expect(outcome).toEqual({
      kind: "rejected",
      reason: "已有一条命令在运行：pnpm test",
    });
    expect(events).toEqual([]);
    restore();
  });

  it("非 JSON 的失败体也给可读文案（不吐 `Unexpected token '<'`）", async () => {
    const restore = stubFetch(
      async () => new Response("<!DOCTYPE html>", { status: 500 }),
    );
    const outcome = await runConsoleCommand({ command: "x", onEvent: noop });
    expect(outcome.kind).toBe("rejected");
    expect(outcome.kind === "rejected" && outcome.reason).toContain("500");
    restore();
  });

  it("正常流：逐帧回调，最后 flush 掉不完整帧（尾行不丢）", async () => {
    const restore = stubFetch(
      async () =>
        new Response(
          streamFrom([
            frame({
              type: "start",
              runId: "r",
              command: "pnpm test",
              cwd: "/x",
              startedAt: 1,
            }),
            frame({ type: "out", stream: "stdout", text: "hello\n" }),
            // 故意不带结尾的 \n\n：模拟断流时的最后一个半帧。
            'data: {"type":"exit","code":0,"killed":false,"durationMs":5}',
          ]),
        ),
    );
    const events: unknown[] = [];
    const outcome = await runConsoleCommand({
      command: "pnpm test",
      onEvent: (e) => events.push(e),
    });
    expect(outcome).toEqual({ kind: "ok" });
    expect(events).toEqual([
      {
        type: "start",
        runId: "r",
        command: "pnpm test",
        cwd: "/x",
        startedAt: 1,
      },
      { type: "out", stream: "stdout", text: "hello\n" },
      {
        type: "exit",
        code: 0,
        signal: null,
        killed: false,
        truncatedNote: null,
        durationMs: 5,
      },
    ]);
    restore();
  });

  it("用户中止 → aborted（不是 failed —— 界面不该报红）", async () => {
    const restore = stubFetch(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const outcome = await runConsoleCommand({ command: "x", onEvent: noop });
    expect(outcome).toEqual({ kind: "aborted" });
    restore();
  });

  it("网络错误 → failed 且翻成人话（不是把浏览器原文甩给用户）", async () => {
    const restore = stubFetch(async () => {
      throw new Error("Failed to fetch");
    });
    const outcome = await runConsoleCommand({ command: "x", onEvent: noop });
    /* ISSUE #1327 现场：面板结论条只写着 `Failed to fetch`，用户看不出是应用服务
     * 没起来还是命令写错。文案走 `~/lib/error-message` 的唯一出口翻成中文。 */
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.reason).toContain("网络请求失败");
    expect(outcome.reason).not.toBe("Failed to fetch");
    restore();
  });

  it("响应没有 body → failed（有出口，不静默卡住）", async () => {
    const restore = stubFetch(async () => new Response(null, { status: 200 }));
    const outcome = await runConsoleCommand({ command: "x", onEvent: noop });
    expect(outcome.kind).toBe("failed");
    restore();
  });

  it("读流中途出错 → failed", async () => {
    const restore = stubFetch(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              throw new Error("stream broke");
            },
          }),
        ),
    );
    const outcome = await runConsoleCommand({ command: "x", onEvent: noop });
    expect(outcome).toEqual({ kind: "failed", reason: "stream broke" });
    restore();
  });
});
