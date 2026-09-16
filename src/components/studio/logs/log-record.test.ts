import { describe, expect, it } from "vitest";

import {
  bracketDepthDelta,
  looksLikeJsonFragment,
  splitLogRecords,
  stripSgr,
} from "./log-record";
import { parseFileLogs } from "./log-store";

/** 记录头判据（与 log-store 的 isLogLine 同口径的简写，用于纯函数用例）。 */
const isLogLine = (line: string) =>
  /^\s*\[\d{2}:\d{2}:\d{2}\]/.test(line) ||
  /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]/.test(line);

/**
 * ISSUE #609 反馈第 4 条：「应用运行日志中还有这种将 json 拆成多个显示的，
 * 一个 json 需要能显示在一起」。
 *
 * 现场是一条被 pretty-print 的结构化 payload（zod 报错 / 异常对象）跟在消息
 * 后面：消息一行、`{` 顶格写在下一行、元素各自一行。按 `\n` 切分后每一行都成了
 * 独立日志，且都读不到时刻与级别 → 面板上是一屏 `"mask",`、`"depth",`，级别全
 * 显示 INFO（用户圈出的正是这一屏）。
 */
describe("多行 payload 归并", () => {
  it("括号深度只数结构里的括号，不数字符串字面量里的", () => {
    expect(bracketDepthDelta("{")).toBe(1);
    expect(bracketDepthDelta('{"a": "["}')).toBe(0);
    expect(bracketDepthDelta('"prompt"|"negative"')).toBe(0);
  });

  it("未闭合的括号让后续物理行并入同一条记录", () => {
    const records = splitLogRecords(
      [
        "[2026-01-01 10:00:00.000] [ERROR] [server] 失败",
        "{",
        '  "a": [',
        "    1",
        "  ]",
        "}",
      ].join("\n"),
      isLogLine,
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.rest.split("\n")).toHaveLength(5);
  });

  it("每条独立日志各自成一条记录（括号闭合后不再吞并）", () => {
    const records = splitLogRecords(
      [
        "[2026-01-01 10:00:00.000] [INFO] 第一条",
        "[2026-01-01 10:00:01.000] [WARN] 第二条",
      ].join("\n"),
      isLogLine,
    );
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.rest === "")).toBe(true);
  });

  it("紧随日志行的裸 `{` 才开启 payload，独立裸文本行不被吞并", () => {
    const records = splitLogRecords(
      [
        "[2026-01-01 10:00:00.000] [INFO] 第一条",
        "npm notice 这是独立的一行",
        "----- 应用服务输出 -----",
      ].join("\n"),
      isLogLine,
    );
    expect(records).toHaveLength(3);
  });

  it("窗口从记录中间开始时（开盘括号在窗口外）仍按片段续接", () => {
    const records = splitLogRecords(
      ['"path": [', '  "inputs",', "  1", "]", "独立一行"].join("\n"),
      isLogLine,
    );
    /* 前四行是一条片段记录，"独立一行" 因不呈片段形状而另起一条。 */
    expect(records).toHaveLength(2);
    expect(records[0]!.rest.split("\n")).toHaveLength(3);
  });

  it("片段形状判据只认 JSON 片段，不认普通句子", () => {
    expect(looksLikeJsonFragment('"a": 1')).toBe(true);
    expect(looksLikeJsonFragment("]")).toBe(true);
    expect(looksLikeJsonFragment("npm notice 升级可用")).toBe(false);
  });

  it("解析后：多行 payload 是**一条**日志，级别取自记录头", () => {
    const text = [
      `[2026-01-01 10:00:00.000] [ERROR] [server] Invalid option: expected one of "prompt"`,
      "{",
      '  "path": [',
      '    "inputs",',
      "    1",
      "  ],",
      '  "message": "bad"',
      `} {"ns":"server","level":"error"}`,
      "[2026-01-01 10:00:05.000] [INFO] [app] 下一条",
    ].join("\n");

    const out = parseFileLogs(text, undefined, "app-runtime");

    expect(out).toHaveLength(2);
    expect(out[0]!.level).toBe("error");
    expect(out[0]!.message).toContain('"inputs"');
    expect(out[0]!.message).toContain('{"ns":"server","level":"error"}');
    expect(out[1]!.message).toBe("[app] 下一条");
  });

  it("ANSI 在切记录之前剥掉，续行上的残留颜色码不会破坏结构", () => {
    const text = [
      "[2026-01-01 10:00:00.000] [INFO] 开始",
      "{",
      '\u001b[36m  "a": 1\u001b[0m',
      "}",
    ].join("\n");
    const out = parseFileLogs(text, undefined, "app-runtime");
    expect(out).toHaveLength(1);
    expect(out[0]!.message).not.toContain("[36m");
  });
});

describe("stripSgr", () => {
  it("剥掉完整 SGR 与残缺颜色码", () => {
    expect(stripSgr("\u001b[36m[OK]\u001b[0m [90m[OK[0m")).toBe("[OK] [OK");
  });
});

describe("空行与边界", () => {
  it("记录之间的空行不会造出空日志，也不合并两侧", () => {
    const out = parseFileLogs(
      [
        "[2026-01-01 10:00:00.000] [INFO] 第一条",
        "",
        "[2026-01-01 10:00:01.000] [INFO] 第二条",
        "",
      ].join("\n"),
      undefined,
      "app-runtime",
    );
    expect(out.map((e) => e.message)).toEqual(["第一条", "第二条"]);
  });

  it("crlf 行尾被剥掉，不残留 \\r", () => {
    const out = parseFileLogs(
      "[2026-01-01 10:00:00.000] [INFO] 唯一一行\r\n",
      undefined,
      "app-runtime",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.message.includes("\r")).toBe(false);
  });
});
