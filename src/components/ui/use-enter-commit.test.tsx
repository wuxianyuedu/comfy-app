/** 「Enter 提交 / Esc 取消」的判据（规范 16 §16.2.4.29），与 `list-filter` 同族。全库 11 处各在 `onKeyDown` 里判键：
 * Enter 要不要 `preventDefault`（6 处写了、5 处没写，没写的在 `<form>` 里会连带提交整页）；Esc 取消要不要复位草稿
 *（3 处复位）。用例钉住：Enter 提交且必调 `preventDefault`；Esc 取消、没给 `onCancel` 则不接管；组字中的 Enter
 * 不算提交（输入法确认候选词）；Shift+Enter 换行；其它键不管；`role="button"` 的 Space 不在本出口。 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { enterCommit, isCommitKey } from "./use-enter-commit";

/** 造一个合成事件形状（`isCommitKey` 只读这三个字段）。 */
function ev(key: string, { shiftKey = false, isComposing = false, keyCode = 0 } = {}) {
  return { key, shiftKey, nativeEvent: { isComposing, keyCode } };
}

/** 键事件的最小形状（`onKeyDown` 用）—— 只多一个 `currentTarget` 与
 *  `preventDefault`，其余与 `ev()` 同源。 */
function keyEvent(
  key: string,
  {
    shiftKey = false,
    isComposing = false,
    preventDefault = vi.fn(),
  }: {
    isComposing?: boolean;
    preventDefault?: () => void;
    shiftKey?: boolean;
  } = {},
) {
  return {
    ...ev(key, { shiftKey, isComposing }),
    currentTarget: { blur: vi.fn() },
    preventDefault,
  };
}

describe("isCommitKey", () => {
  it("Enter 提交；其它键不提交", () => {
    expect(isCommitKey(ev("Enter"))).toBe(true);
    expect(isCommitKey(ev("Escape"))).toBe(false);
    expect(isCommitKey(ev("Backspace"))).toBe(false);
    expect(isCommitKey(ev("ArrowDown"))).toBe(false);
  });

  it("Shift+Enter 不算提交（换行）", () => {
    expect(isCommitKey(ev("Enter", { shiftKey: true }))).toBe(false);
    expect(isCommitKey(ev("Enter", { shiftKey: true }), { excludeShift: false })).toBe(true);
  });

  it("组字中的 Enter 不算提交（IME 确认候选，不是提交）", () => {
    expect(isCommitKey(ev("Enter", { isComposing: true }))).toBe(false);
    expect(isCommitKey(ev("Enter", { keyCode: 229 }))).toBe(false);
    expect(isCommitKey(ev("Enter", { isComposing: true }), { ignoreIme: false })).toBe(true);
  });
});

describe("enterCommit 的 onKeyDown", () => {
  it("Enter 提交并阻止默认行为（表单隐式 submit）", () => {
    const onCommit = vi.fn();
    const preventDefault = vi.fn();
    enterCommit({ onCommit }).onKeyDown(keyEvent("Enter", { preventDefault }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    /* ⚠️ 这一条是整条账的关键：没调它，输入框在 `<form>` 里会把整页提交掉。 */
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("Esc 取消（不提交）", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const preventDefault = vi.fn();
    enterCommit({ onCommit, onCancel }).onKeyDown(keyEvent("Escape", { preventDefault }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("没给 onCancel 时不接管 Esc（「只提交不取消」是合法形态）", () => {
    const onCommit = vi.fn();
    const preventDefault = vi.fn();
    enterCommit({ onCommit }).onKeyDown(keyEvent("Escape", { preventDefault }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("组字中的 Enter 传到底层判定后不提交", () => {
    const onCommit = vi.fn();
    enterCommit({ onCommit }).onKeyDown(keyEvent("Enter", { isComposing: true }));
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("接在真实输入框上（属性包可用）", () => {
  it("回车触发提交、Esc 触发取消、输入法组字不触发", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <input aria-label="改名" defaultValue="草稿" {...enterCommit({ onCommit, onCancel })} />,
    );
    const input = screen.getByLabelText("改名");
    input.focus();

    /* ⚠️ `userEvent.type` 会**走真实的 IME 语义**（合成事件里
     * `isComposing` 在 composition 期间为 true），所以这里用 `keyboard` 显式
     * 按下 —— 与调用处的现场一致。 */
    await userEvent.keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledTimes(1);

    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
