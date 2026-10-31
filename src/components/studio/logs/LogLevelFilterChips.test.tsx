import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TaskLogTimeline } from "./TaskLogTimeline";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";

afterEach(cleanup);

/**
 * 任务日志时间线的**级别筛选栏**回归判据（ISSUE #1925 第三批收口）。
 *
 * 这一排此前是手搓的 `Button variant="ghost"` + 选中三元：
 *   选中 → `bg-surface-2 text-ink`
 *   未选 → `text-ink-muted hover:bg-subtle hover:text-ink-strong`
 *
 * 两处都坏：① 选中档没钉悬停值，`ghost` 自带的
 * `hover:bg-muted hover:text-foreground` 照旧生效 —— 划过**已选中**的那一枚时
 * 底色/字色被改写，看上去像「未选中」（ISSUE #1423 那一族）；
 * ② `bg-surface-2` 在浅色主题下与行头底色同值（`log-row-style.ts` 的
 * `FILTER_SELECTED_STYLES` 就是为这件事立的），选中本来就弱。
 *
 * 现在整排交给 `ui/select-chip`。这里钉的是**形态**：
 * 单选语义 + 选中档四层俱在 + 悬停值回钉。
 */
const logs: Array<TaskLogEntry> = [
  { level: "info", msg: "开始", t: 1 },
  { level: "warn", msg: "慢", t: 2 },
];

describe("任务日志级别筛选 chip（ISSUE #1925）", () => {
  it("是单选语义的 radiogroup（不再手搓 aria-pressed 按钮）", () => {
    render(<TaskLogTimeline logs={logs} />);
    expect(screen.getByRole("radiogroup", { name: "日志级别筛选" })).toBeTruthy();
    const chips = screen.getAllByRole("radio");
    expect(chips.length).toBeGreaterThan(1);
    /* 默认筛「全部」——恰好一枚勾选。 */
    expect(chips.filter((c) => c.getAttribute("aria-checked") === "true")).toHaveLength(1);
  });

  it("选中档四层俱在，且悬停值钉回常态", () => {
    render(<TaskLogTimeline logs={logs} />);
    const checked = screen
      .getAllByRole("radio")
      .find((c) => c.getAttribute("aria-checked") === "true")!;
    for (const layer of [
      "aria-checked:bg-primary-soft",
      "aria-checked:text-primary-strong",
      "aria-checked:border-primary",
      "aria-checked:font-semibold",
      "aria-checked:hover:bg-primary-soft",
    ]) {
      expect(checked.className).toContain(layer);
    }
    /* 反向：手搓时代那个「与行头同值」的选中底色不得残留。 */
    expect(checked.className).not.toContain("bg-surface-2");
  });
});
