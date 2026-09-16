/**
 * 会话边界横幅的契约测试（ISSUE #592）。
 *
 * 背景：`log/services/` 下的 runtime 日志（comfyui / drizzle-studio / ollama /
 * app-runtime）都是**追加不轮转**的，同一个文件里混着多次运行的行。用户直接看
 * 文件时分不清「本次从哪开始」——条与条之间没有断点。
 *
 * 钉住三条契约：
 *   1. 横幅**两侧各留一个空行**（「每次启动之间需要行空白」的本体）；
 *   2. 横幅**不带时刻**（时刻只留在行首，见规范 07 §7.14.4）；
 *   3. 写入失败静默，不抛（日志子系统绝不阻塞主流程）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendSessionBanner,
  buildSessionBanner,
} from "~/lib/session-banner.server";

let tmpDir: string;
let logFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-banner-"));
  logFile = path.join(tmpDir, "runtime.log");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildSessionBanner", () => {
  it("两侧各留一个空行，且以换行收口（下一次 append 不粘在分隔线上）", () => {
    const banner = buildSessionBanner("start", "▶ 会话开始");
    const lines = banner.split("\n");
    expect(lines[0]).toBe(""); // 前导空行
    expect(lines.at(-1)).toBe(""); // 结尾换行产生的空串 → 文件里是多一个空行
    expect(banner).toContain("─".repeat(72));
    expect(banner).toContain("▶ 会话开始");
  });

  it("横幅本体不带时刻（时刻只留在每条行首）", () => {
    const banner = buildSessionBanner("start", "▶ 会话开始");
    // 形如 `<日期> <时刻>` 或裸 `HH:mm:ss` 的时刻串都不应出现
    expect(banner).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(banner).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("start 用亮绿、end 用亮黄（面板解析 SGR 后渲染成高亮）", () => {
    expect(buildSessionBanner("start", "x")).toContain("\x1b[1;32m");
    expect(buildSessionBanner("end", "x")).toContain("\x1b[1;33m");
    expect(buildSessionBanner("start", "x")).toContain("\x1b[0m");
  });
});

describe("appendSessionBanner", () => {
  it("目录不存在时自动建，并把横幅追加到文件", () => {
    const nested = path.join(tmpDir, "a", "b", "runtime.log");
    appendSessionBanner(nested, "start", "▶ 会话开始");
    expect(fs.readFileSync(nested, "utf-8")).toContain("▶ 会话开始");
  });

  it("多次追加的横幅之间保持空行分隔（多次运行累积的口径）", () => {
    appendSessionBanner(logFile, "start", "▶ 第一次");
    fs.appendFileSync(
      logFile,
      "[2026-09-15 10:00:00.000] [INFO] [x] 中间一行\n",
    );
    appendSessionBanner(logFile, "start", "▶ 第二次");

    const text = fs.readFileSync(logFile, "utf-8");
    const lines = text.split("\n");
    const infoAt = lines.findIndex((l) => l.includes("中间一行"));
    const secondAt = lines.findIndex((l) => l.includes("▶ 第二次"));
    // 上一次运行的末行与本次横幅的分隔线之间**至少有一个空行**
    expect(lines[secondAt - 1]).toContain("─");
    expect(lines.slice(infoAt + 1, secondAt - 1).every((l) => l === "")).toBe(
      true,
    );
    expect(lines[secondAt - 2]).toBe("");
    // 横幅自身以空行收口：下一次 append 的内容不会粘在分隔线上
    expect(lines[secondAt + 1]).toContain("─");
    expect(lines[secondAt + 2]).toBe("");
  });

  it("写入失败静默（不可写路径不抛）", () => {
    // 把一个**已存在的文件**当目录用 → mkdirSync 必然抛 EEXIST/ENOTDIR
    expect(() =>
      appendSessionBanner(logFile, "start", "▶ 会话开始"),
    ).not.toThrow();
  });
});
