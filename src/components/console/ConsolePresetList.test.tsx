import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TooltipProvider } from "~/components/ui/tooltip";
import { CONSOLE_PRESETS } from "~/lib/console/console-catalog";

import { ConsolePresetList } from "./ConsolePresetList";

afterEach(cleanup);

function renderList(props: Partial<Parameters<typeof ConsolePresetList>[0]> = {}) {
  return render(
    <TooltipProvider delay={0}>
      <ConsolePresetList disabled={props.disabled ?? false} onFill={props.onFill ?? vi.fn()} />
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
    const preset = CONSOLE_PRESETS.flatMap((g) => g.items).find((i) => i.id === "check-all")!;
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

/* ── 按分组折叠（ISSUE #1902 评论）──────────────────────────────
 * 这几条用例守折叠的语义：默认折起、开合只动自己那一组、折起时组名与分组
 * 说明仍在。折起的 DOM 判据是面板的 hidden 属性（`ui/disclosure` 用
 * `hidden="until-found"` 隐藏、不是卸载 DOM），不是「节点在不在」。 */
describe("ConsolePresetList · 按分组折叠", () => {
  /** 某一组的折叠开关（`ui/disclosure` 的 trigger 是个 `<button>`）。 */
  function groupTrigger(groupId: string) {
    return screen.getByTestId(`console-preset-group-${groupId}`);
  }

  /** 某条预设所在的面板；`null` = 这一组还没渲染出面板。 */
  function panelOf(itemId: string): HTMLElement | null {
    return (
      screen.getByTestId(`console-preset-${itemId}`).closest('[data-slot="disclosure-panel"]') ??
      null
    );
  }

  it("默认全部折起：每一组的面板都是 hidden，组名与分组说明留在头上", () => {
    renderList();
    for (const group of CONSOLE_PRESETS) {
      const head = groupTrigger(group.id);
      /* 组名与分组说明在折起时**必须留下** —— 否则用户看不到这一组是什么，
         也就没有理由去展开它。 */
      expect(head.textContent).toContain(group.label);
      expect(head.textContent).toContain(group.hint);
      for (const item of group.items) {
        expect(panelOf(item.id)?.hasAttribute("hidden"), `${group.id} 默认该是折起的`).toBe(true);
      }
    }
  });

  it("点一下组头展开这一组，再点一下折回去", async () => {
    const user = userEvent.setup();
    renderList();
    const first = CONSOLE_PRESETS[0]!;
    const item = first.items[0]!;

    await user.click(groupTrigger(first.id));
    expect(panelOf(item.id)?.hasAttribute("hidden")).toBe(false);

    await user.click(groupTrigger(first.id));
    expect(panelOf(item.id)?.hasAttribute("hidden")).toBe(true);
  });

  it("只开自己那一组：展开 A 不让 B 跟着开（不是手风琴）", async () => {
    const user = userEvent.setup();
    renderList();
    const [a, b] = CONSOLE_PRESETS;
    await user.click(groupTrigger(a!.id));
    expect(panelOf(a!.items[0]!.id)?.hasAttribute("hidden")).toBe(false);
    expect(panelOf(b!.items[0]!.id)?.hasAttribute("hidden")).toBe(true);
  });

  it("`basis-full` 的面板必须配 `flex-wrap` 的行（ISSUE #1902）", () => {
    renderList();
    /* 那次「组头被挤成一条竖线」的类名侧判据（ISSUE #1902）：`basis-full` 的
     * 语义依赖同一容器上有 `flex-wrap`，没有它面板会横占整行、吃掉侧栏。宽度
     * 塌陷只有真浏览器量得出（`e2e/console-preset-layout.spec.ts` 慢、不在单测
     * 档），类名配对在 jsdom 就看得见，是这条 bug 的最小复现条件。不改基元：
     * `rootClassName` 是调用处的排布决定（规范 16 §16.2.4.13）。 */
    for (const group of CONSOLE_PRESETS) {
      const trigger = groupTrigger(group.id);
      const root = trigger.closest('[data-slot="disclosure"]');
      const panel = panelOf(group.items[0]!.id)!;
      const panelClass = panel.className;
      /* 条件收进期望值：面板用 basis-full（横占整行）时 Root 必须写 flex-wrap，
       * 没用就不约束 —— 断言本体无条件跑（no-conditional-expect）。 */
      expect(
        panelClass.includes("basis-full") ? (root?.className ?? "").includes("flex-wrap") : true,
        `${group.id} 的面板用了 basis-full，Root 却没写 flex-wrap —— 面板会横着占满整行`,
      ).toBe(true);
    }
  });

  it("分组头上给出条数（折起时也知道这一组有几条）", () => {
    renderList();
    for (const group of CONSOLE_PRESETS) {
      const disclosure = groupTrigger(group.id).closest('[data-slot="disclosure"]');
      expect(disclosure?.textContent).toContain(String(group.items.length));
    }
  });
});
