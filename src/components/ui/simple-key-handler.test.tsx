// @vitest-environment jsdom
/**
 * 「非输入框元素上按某个键就做一件事」的判据（规范 16 §16.2.4.57）。
 *
 * 与 `use-enter-commit` 同族：**不是重复代码，是判据**。全库 3 处各写一遍
 * 键判别，而它们对三件事各判各的：
 *   · **键名叫什么** —— `" "` 还是 `"Space"`、要不要大小写归一；
 *   · **要不要 `preventDefault`** —— 混在同一个 `if` 里，看不出谁决定的；
 *   · **`event.repeat` 收不收** —— 按住空格会连发，对「切换一次」等于按了十几次。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { simpleKeyHandler } from "./simple-key-handler";

/** 造一个合成事件形状（`simpleKeyHandler` 只读这几个字段）。 */
function ev(key: string, { repeat = false } = {}) {
  return { key, repeat, preventDefault: vi.fn() };
}

describe("simpleKeyHandler", () => {
  it("命中键 → 调动作，且 `preventDefault` 默认被调用", () => {
    const action = vi.fn();
    const event = ev("Enter");
    simpleKeyHandler(["Space", "Enter"], action).onKeyDown(event);
    expect(action).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('空格按它的两个名字都能命中（`Space` 与 `" "`）', () => {
    const named = vi.fn();
    simpleKeyHandler(["Space"], named).onKeyDown(ev("Space"));
    const literal = vi.fn();
    simpleKeyHandler(["Space"], literal).onKeyDown(ev(" "));
    expect(named).toHaveBeenCalledTimes(1);
    expect(literal).toHaveBeenCalledTimes(1);
  });

  it("大小写不敏感 —— 带 Shift 的单字符也能命中", () => {
    const action = vi.fn();
    simpleKeyHandler(["s"], action).onKeyDown(ev("S"));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("`repeat` 默认被忽略（按住不放不连发）", () => {
    const action = vi.fn();
    simpleKeyHandler(["Space"], action).onKeyDown(ev(" ", { repeat: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it("`ignoreRepeat: false` 时连发放行（「一直按住就一直做」是合法形态）", () => {
    const action = vi.fn();
    simpleKeyHandler(["Space"], action, { ignoreRepeat: false }).onKeyDown(
      ev(" ", { repeat: true }),
    );
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("`preventDefault: false` 时只观察不拦截", () => {
    const action = vi.fn();
    const event = ev("Tab");
    simpleKeyHandler(["Tab"], action, { preventDefault: false }).onKeyDown(
      event,
    );
    expect(action).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("其它键一概不管（不误伤 Escape / 方向键）", () => {
    const action = vi.fn();
    const handler = simpleKeyHandler(["Space", "Enter"], action);
    for (const key of ["Escape", "ArrowDown", "Tab", "a"]) {
      handler.onKeyDown(ev(key));
    }
    expect(action).not.toHaveBeenCalled();
  });

  it("铺在元素上即生效（属性包里只有 `onKeyDown`）", async () => {
    const onActivate = vi.fn();
    render(
      <div
        role="tab"
        tabIndex={0}
        data-testid="tab"
        {...simpleKeyHandler(["Space", "Enter"], () => {
          onActivate();
        })}
      />,
    );
    const tab = screen.getByTestId("tab");
    tab.focus();
    await userEvent.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
