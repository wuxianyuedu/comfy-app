/**
 * 追加写日志的会话切分契约（设置页「启动日志」下拉的判据）。
 *
 * 用例刻意**用真实的横幅构造器**（`buildSessionBanner`）造数据，而不是手写
 * 一份「长得像横幅」的字符串：切分与横幅是同一件事的两端，横幅格式一变
 * （如分隔线宽度、颜色码），这里必须跟着红 —— 手写的夹具只会一起漂移过去。
 */
import { describe, expect, it } from "vitest";

import { buildSessionBanner } from "~/lib/session-banner.server";
import {
  formatSessionLabel,
  parseLogSessions,
  type LogSessionChunk,
} from "./log-sessions";

/** 造一份「早期日志 + 两次启动」的文件内容（与 appendFileSync 的拼法一致）。 */
function twoSessionsLog(): string {
  return [
    "2026-09-18 10:00:00 旧行（横幅机制上线前写的）\n",
    buildSessionBanner("start", "▶ ComfyUI 启动会话"),
    "2026-09-18 10:01:00 [spawn] pid=1\n",
    buildSessionBanner("end", "■ ComfyUI 进程已退出（code=0）"),
    "2026-09-18 10:02:00 ComfyUI 进程退出（code=0）\n",
    buildSessionBanner("start", "▶ ComfyUI 启动会话"),
    "2026-09-18 10:03:00 [spawn] pid=2\n",
  ].join("");
}

/** 断言辅助：某段文本里有/没有哪些行。 */
function texts(chunks: LogSessionChunk[]): string[] {
  return chunks.map((chunk) => chunk.text);
}

describe("parseLogSessions", () => {
  it("按 start 横幅切分：早期内容单独成项，每次启动各成一项", () => {
    const chunks = parseLogSessions(twoSessionsLog());
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.title).toBe("更早的日志（无会话标记）");
    expect(texts(chunks)[0]).toContain("旧行（横幅机制上线前写的）");
    expect(chunks[1]!.title).toBe("▶ ComfyUI 启动会话");
    expect(chunks[2]!.title).toBe("▶ ComfyUI 启动会话");
    expect(texts(chunks)[1]).toContain("[spawn] pid=1");
    expect(texts(chunks)[2]).toContain("[spawn] pid=2");
    /* 关键判据：多次启动不混在一条时间线上 */
    expect(texts(chunks)[2]).not.toContain("pid=1");
    expect(texts(chunks)[1]).not.toContain("pid=2");
  });

  it("end 横幅只标记终点，不切分：退出说明仍留在同一次启动里", () => {
    const chunks = parseLogSessions(twoSessionsLog());
    /* 结束横幅与其后的退出说明都属于「第一次启动」那一段 */
    expect(texts(chunks)[1]).toContain("■ ComfyUI 进程已退出");
    expect(texts(chunks)[1]).toContain("ComfyUI 进程退出（code=0）");
  });

  it("会话起点从横幅那行开始（下拉切过去就能看见边界）", () => {
    const chunks = parseLogSessions(twoSessionsLog());
    expect(texts(chunks)[1]!.startsWith("\u001b[1;32m\u2500")).toBe(true);
  });

  it("每条会话带自己的开始时刻（取段内第一条带时刻的行）", () => {
    const chunks = parseLogSessions(twoSessionsLog());
    expect(chunks[1]!.startedAt).toBe(
      new Date(2026, 8, 18, 10, 1, 0).getTime(),
    );
    expect(chunks[2]!.startedAt).toBe(
      new Date(2026, 8, 18, 10, 3, 0).getTime(),
    );
  });

  it("一条横幅都没有时退化成单条会话（不返回空列表）", () => {
    const chunks = parseLogSessions("只有一行普通日志\n再来一行\n");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.title).toBe("更早的日志（无会话标记）");
    expect(chunks[0]!.text).toContain("再来一行");
    expect(chunks[0]!.startedAt).toBeNull();
  });

  it("孤立的 box 字符行不算横幅（必须「线 / 标题 / 线」三行连续）", () => {
    const chunks = parseLogSessions(
      "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n不是横幅\n",
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.title).toBe("更早的日志（无会话标记）");
  });

  it("超上限时取**尾部窗口**并掐头对齐到行边界（不留半行）", () => {
    const body = Array.from(
      { length: 40 },
      (_, i) => `2026-09-18 10:00:${String(i).padStart(2, "0")} 第 ${i} 行`,
    ).join("\n");
    const chunks = parseLogSessions(body, 200);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.truncated).toBe(true);
    expect(chunks[0]!.text.length).toBeLessThanOrEqual(200);
    /* 起点必须是完整行（第 N 行的行首），不能从半行中间切进去 */
    expect(chunks[0]!.text.startsWith("2026-09-18 10:00:")).toBe(true);
    expect(chunks[0]!.text).toContain("第 39 行");
  });

  it("未超上限时不标记截断，且去掉尾部空白", () => {
    const chunks = parseLogSessions("a\nb\n\n\n");
    expect(chunks[0]!.truncated).toBe(false);
    expect(chunks[0]!.text).toBe("a\nb");
  });

  it("整段没有换行时截断退化为尾部片段（对齐不到行边界也不报错）", () => {
    const chunks = parseLogSessions("x".repeat(500), 100);
    expect(chunks[0]!.text).toBe("x".repeat(100));
    expect(chunks[0]!.truncated).toBe(true);
  });

  it("横幅标题为空时给兜底标题（横幅只划了边界，标题没写内容）", () => {
    const chunks = parseLogSessions(
      buildSessionBanner("start", "") + "2026-09-18 10:00:00 一行\n",
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.title).toBe("启动会话");
  });
});

describe("formatSessionLabel", () => {
  it("时刻在前 + 横幅标题（同一通道每次启动的标题逐字相同，只有时刻能区分）", () => {
    expect(
      formatSessionLabel({
        id: "12",
        title: "▶ ComfyUI 启动会话",
        startedAt: new Date(2026, 8, 18, 10, 1, 3).getTime(),
      }),
    ).toBe("10:01:03 · ▶ ComfyUI 启动会话");
  });

  it("读不到时刻时只给标题（不给一个假时刻）", () => {
    expect(
      formatSessionLabel({
        id: "0",
        title: "更早的日志（无会话标记）",
        startedAt: null,
      }),
    ).toBe("更早的日志（无会话标记）");
  });
});
