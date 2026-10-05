/**
 * 「查看源文件」弹窗的关闭语义回归。
 *
 * 用户报的现场：工作流编辑画布点「📋 查看 JSON」后，弹窗右上角出现**两个**
 * 关闭按钮（`ui/dialog` 内置的 XIcon + 本组件自绘的 ✕），点了关不掉。
 *
 * 根因是重复实现：`ui/dialog` 的 `DialogContent` 默认 `showCloseButton = true`，
 * 会自渲染一枚 `absolute top-2 right-2` 的关闭按钮；本弹窗又在 header 里自绘了
 * 一枚 —— 两枚位置几乎重合，点下去命中的是 DOM 靠后 + 绝对定位的内置那枚，
 * 两枚之间的空隙还成了「点了没反应」的死区。
 *
 * 本守卫锁四件事：
 *   ① 关闭控件只有一个（复用 `ui/dialog` 内置那枚也算违规：本弹窗形态要自绘）；
 *   ② 点它调用 `onClose`；
 *   ③ 受控调用方（父层持开关）点关闭后弹窗真的从 DOM 移除；
 *   ④ Esc 走 `ui/dialog` 的关闭语义，同样调用 `onClose`。
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SourceModal } from "./SourceModal";

afterEach(cleanup);

/** 最小可用的源文件数据：够渲染标题与 JSON 正文。 */
const DATA = { name: "demo-workflow", source: { nodes: [], last_node_id: 3 } };

/** 弹窗里所有「关闭」控件：自绘 ✕（`aria-label="关闭"`，说明文字走 `<Hint>`）
 *  + `ui/dialog` 内置那枚。 */
function closeControls(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-slot="dialog-close"], button[aria-label="关闭"]',
    ),
  );
}

function dialogSlot(): HTMLElement | null {
  return document.querySelector('[data-slot="dialog-content"]');
}

/** 复刻调用处的受控用法：父层持开关，关闭后弹窗由父层卸载。 */
function Harness() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return <SourceModal data={DATA} onClose={() => setOpen(false)} />;
}

describe("查看源文件弹窗", () => {
  it("只渲染一个关闭控件，且基元内置那枚已关掉", () => {
    render(<SourceModal data={DATA} onClose={vi.fn()} />);

    // `ui/dialog` 内置那枚（`data-slot="dialog-close"`）必须不在
    expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull();
    // 自绘的那枚存在且唯一
    expect(closeControls()).toHaveLength(1);
  });

  it("点关闭按钮调用 onClose", () => {
    const onClose = vi.fn();
    render(<SourceModal data={DATA} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点关闭按钮后弹窗从 DOM 移除（用户关得掉）", () => {
    render(<Harness />);
    expect(dialogSlot()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(dialogSlot()).toBeNull();
  });

  it("Esc 关闭调用 onClose", () => {
    const onClose = vi.fn();
    render(<SourceModal data={DATA} onClose={onClose} />);

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
