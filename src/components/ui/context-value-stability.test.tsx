/** E5/E6 的 Context value 引用稳定性：provider 因父级状态重渲时，value 不该每次
 * 换引用，否则所有消费者跟着重渲。钉的是可观察的行为 —— 消费者不重挂 / 参数变化
 * 才更新（规范 11.2 行为面），不直接断内部实现。 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { useContext, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlotOutletProvider, SlotContent, SlotOutlet, SlotOutletContext } from "./slot-outlet";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

afterEach(cleanup);

/* ── E5: SlotOutlet ─────────────────────────────────────────────────
 * 用真实消费者读同一 context、记录 value 引用；provider 重渲不该换引用。 */
const slotValues: Array<unknown> = [];
let bumpSlot: () => void = vi.fn();

function SlotProbe() {
  slotValues.push(useContext(SlotOutletContext));
  return <span data-testid="slot-probe">探针</span>;
}

function SlotWrapper() {
  const [, setTick] = useState(0);
  bumpSlot = () => {
    setTick((value) => value + 1);
  };
  return (
    <SlotOutletProvider>
      <SlotOutlet />
      <SlotContent fallback={null}>
        <SlotProbe />
        <button type="button">内容</button>
      </SlotContent>
    </SlotOutletProvider>
  );
}

/* ── E6: ToggleGroup ──────────────────────────────────────────────── */
function TogglePair({ spacing }: { spacing: number }) {
  return (
    <ToggleGroup aria-label="分段控件" multiple={false} spacing={spacing} value={["b"]}>
      <ToggleGroupItem value="a">甲</ToggleGroupItem>
      <ToggleGroupItem value="b">乙</ToggleGroupItem>
    </ToggleGroup>
  );
}

function toggleSpacing(container: HTMLElement): string | null {
  return (
    container.querySelector<HTMLElement>('[data-slot="toggle-group"]')?.dataset.spacing ?? null
  );
}

describe("Context value 稳定性", () => {
  it("SlotOutletProvider 重渲不改变 value 引用", async () => {
    slotValues.length = 0;
    const { rerender } = render(<SlotWrapper />);
    /* 首拍 node=null → ref 回调挂上落点触发 setState，value 正当换一次引用；
     * 等它稳定后再比后续重渲。 */
    await new Promise((resolve) => setTimeout(resolve, 0));
    slotValues.length = 0;
    act(() => {
      bumpSlot();
    });
    rerender(<SlotWrapper />);

    expect(screen.getByTestId("slot-probe")).toBeTruthy();
    expect(slotValues.length).toBeGreaterThanOrEqual(2);
    for (const value of slotValues.slice(1)) {
      expect(value).toBe(slotValues[0]);
    }
  });

  it("ToggleGroup 参数不变时重渲不重建 item，参数变化时同步更新", () => {
    const { container, rerender } = render(<TogglePair spacing={2} />);
    const first = screen.getAllByRole("button")[0];
    if (!first) {
      throw new Error("没渲染出分段项");
    }
    rerender(<TogglePair spacing={2} />);
    expect(screen.getAllByRole("button")[0]).toBe(first);
    expect(toggleSpacing(container)).toBe("2");

    rerender(<TogglePair spacing={4} />);
    expect(toggleSpacing(container)).toBe("4");
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });
});
