import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TaskLogTimeline } from "./TaskLogTimeline";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";

afterEach(cleanup);

/**
 * 任务日志时间线的**级别筛选栏**回归判据（ISSUE #1925）：整排已交给 `ui/select-chip`。此前手搓
 * `Button ghost`：选中档没钉悬停值，`hover:bg-muted` 会改写已选中项（ISSUE #1423 那族），且
 * `bg-surface-2` 在浅色下与行头底色同值、选中本就弱。这里钉形态：单选语义 + 选中档四层俱在 + 悬停值回钉。
 */
const logs: Array<TaskLogEntry> = [
  { t: 1, level: "info", msg: "开始" },
  { t: 2, level: "warn", msg: "慢" },
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
