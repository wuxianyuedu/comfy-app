import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TooltipProvider } from "~/components/ui/tooltip";
import { CONSOLE_PRESETS } from "~/lib/console/console-catalog";

import { ConsolePresetList } from "./ConsolePresetList";

afterEach(cleanup);

function renderList(
  props: Partial<Parameters<typeof ConsolePresetList>[0]> = {},
) {
  return render(
    <TooltipProvider delay={0}>
      <ConsolePresetList
        onFill={props.onFill ?? vi.fn()}
        disabled={props.disabled ?? false}
      />
    </TooltipProvider>,
  );
}

/** Base UI 的 tooltip 浮层不带 `role="tooltip"`，按 `data-slot` 取那一层。 */
function popup() {
  return document.querySelector('[data-slot="tooltip-content"]');
}

describe("ConsolePresetList", () => {
  it("每一组都渲染出标题、分组说明与条目", () => {
    renderList();
    for (const group of CONSOLE_PRESETS) {
      expect(screen.getByText(group.label)).toBeTruthy();
      expect(screen.getByText(group.hint)).toBeTruthy();
      for (const item of group.items) {
        expect(
          screen.getByTestId(`console-preset-${item.id}`),
          `${item.id} 没渲染出来`,
        ).toBeTruthy();
      }
    }
  });

  it("点一下把命令填进输入框（而不是直接跑）", async () => {
    const user = userEvent.setup();
    const onFill = vi.fn();
    renderList({ onFill });
    await user.click(screen.getByTestId("console-preset-typecheck"));
    expect(onFill).toHaveBeenCalledWith("pnpm exec tsc --noEmit");
  });

  it("跑着命令时所有条目都禁用（不让用户以为点了会插队）", async () => {
    const user = userEvent.setup();
    const onFill = vi.fn();
    renderList({ onFill, disabled: true });
    await user.click(screen.getByTestId("console-preset-typecheck"));
    expect(onFill).not.toHaveBeenCalled();
  });

  it("悬停把**说明小字**补全 —— 被截断掉的正是它（ISSUE #1746）", async () => {
    const user = userEvent.setup();
    renderList();
    /* 「一键质量门禁」的说明小字在 240px 的侧栏里必然被 `truncate` 掉，
       而此前浮层只回显命令，用户悬停也读不到「跑的是哪个脚本」。 */
    const preset = CONSOLE_PRESETS.flatMap((g) => g.items).find(
      (i) => i.id === "check-all",
    )!;
    await user.hover(screen.getByTestId("console-preset-check-all"));
    const box = popup();
    expect(box).not.toBeNull();
    /* 三段都要在：展示名、说明小字、点下去会填进输入框的命令。
       `getByText` 对富文本子节点做整段匹配，所以这里按内容逐条判。 */
    expect(box!.textContent).toContain(preset.label);
    expect(box!.textContent).toContain(preset.desc);
    expect(box!.textContent).toContain(preset.command);
  });

  it("说明小字都在浮层里给全（不只挑一条）", async () => {
    const user = userEvent.setup();
    renderList();
    /* 逐条悬停成本高，这里只核「浮层的文案取自 desc 本身」这条口径：
       取一条 desc 最长的（最容易被截断的），它必须完整出现在浮层里。 */
    const longest = CONSOLE_PRESETS.flatMap((g) => g.items).reduce((a, b) =>
      a.desc.length >= b.desc.length ? a : b,
    );
    await user.hover(screen.getByTestId(`console-preset-${longest.id}`));
    expect(popup()!.textContent).toContain(longest.desc);
  });
});
