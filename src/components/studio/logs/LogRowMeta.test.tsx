/**
 * 日志行的元信息列显隐与行距档（ISSUE #4567）：隐藏时刻 / 级别 / 位置 / 来源后，
 * 鼠标框选到的就只有正文；行内复制按钮随同一开关只给正文（`includeMeta: false`）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { LogRow } from "./LogRow";
import { formatEntryForClipboard } from "./log-format";
import type { LogEntry } from "./log-store";
import { TooltipProvider } from "~/components/ui/tooltip";

function entry(): LogEntry {
  return {
    id: "e-1",
    seq: 1,
    time: 1_760_000_000_000,
    level: "info",
    message: "编排器互斥占坑: 已写入会话锚点（PID 74404）",
    source: "system",
    origin: "shell-launch",
  };
}

function renderRow(showDetails: boolean, density: "compact" | "standard" | "relaxed" = "standard") {
  render(
    <TooltipProvider delay={0}>
      <LogRow
        density={density}
        entry={entry()}
        expanded={false}
        keyword=""
        onToggleExpand={() => undefined}
        showDetails={showDetails}
        style={{}}
        wrap
      />
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("LogRow 元信息列显隐", () => {
  it("显示（默认）：时刻、级别徽标、来源都在场", () => {
    renderRow(true);
    expect(document.querySelector("time")).not.toBeNull();
    /* 徽标文本是级别原值（大写由 `uppercase` class 呈现），匹配按不区分大小写。 */
    expect(screen.getByText(/info/i)).toBeTruthy();
    expect(screen.getByText("shell-launch")).toBeTruthy();
    expect(screen.getByText(/编排器互斥占坑/)).toBeTruthy();
  });

  it("隐藏（精简列）：时刻 / 级别 / 来源整排收起，正文与复制按钮保留", () => {
    renderRow(false);
    expect(document.querySelector("time")).toBeNull();
    expect(screen.queryByText(/info/i)).toBeNull();
    expect(screen.queryByText("shell-launch")).toBeNull();
    expect(screen.getByText(/编排器互斥占坑/)).toBeTruthy();
    expect(screen.getByLabelText("复制本条日志")).toBeTruthy();
  });

  it("行距档改变行内边距（与 log-virtual 的行高常量同源）", () => {
    renderRow(true, "relaxed");
    expect(document.querySelector("div[class*='py-2']")).not.toBeNull();
    expect(document.querySelector("div[class*='py-1 ']")).toBeNull();
  });
});

describe("formatEntryForClipboard 的 includeMeta", () => {
  it("默认带完整元信息（时刻 / 级别 / 来源）", () => {
    const text = formatEntryForClipboard(entry());
    expect(text).toContain("[INFO]");
    expect(text).toContain("shell-launch");
    expect(text).toContain("编排器互斥占坑");
  });

  it("includeMeta: false 只给正文（精简列档的行内复制）", () => {
    expect(formatEntryForClipboard(entry(), { includeMeta: false })).toBe(
      "编排器互斥占坑: 已写入会话锚点（PID 74404）",
    );
  });
});
