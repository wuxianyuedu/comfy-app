/**
 * 「全局快捷键」只允许一处实现的契约（ISSUE #672 §16.2.4.23）。
 *
 * 现场：6 处各写一份 `addEventListener("keydown", …)`，而**修饰键判据不同** ——
 * `LogProvider` 与 `UpdateCheckProvider` 只判 `ctrlKey`（**macOS 上按 ⌘ 没反应**）、
 * `json-viewer` 判了 `metaKey || ctrlKey` 却不过滤输入焦点、`ScriptMarkdownEditor`
 * 两者都判但把两件事塞进一个 handler。
 *
 * 这里钉的是**行为**（「在 mac 上到底能不能用」「在输入框里会不会被抢」），
 * 而不是实现字符串 —— 与「只断言源码里的类名抓不住 tailwind-merge 顺序问题」
 * 同源。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { matchesHotkey, useHotkey } from "./use-hotkey";

afterEach(cleanup);

/** 造一个键盘事件的判据输入（`matchesHotkey` 是纯函数，可直接测）。 */
function key(
  k: string,
  mods: {
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
  } = {},
) {
  return {
    key: k,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  } as KeyboardEvent;
}

describe("mod 是跨平台的（这条正是原来两处 mac 上死的根因）", () => {
  it("非 mac：Ctrl 命中", () => {
    expect(
      matchesHotkey(
        key("l", { ctrl: true, shift: true }),
        {
          key: "l",
          mod: true,
          shift: true,
        },
        false,
      ),
    ).toBe(true);
  });

  it("mac：⌘ 命中（收口前这两处只写了 ctrlKey，mac 上完全没反应）", () => {
    expect(
      matchesHotkey(
        key("l", { meta: true, shift: true }),
        {
          key: "l",
          mod: true,
          shift: true,
        },
        true,
      ),
    ).toBe(true);
  });

  it("mac：Ctrl 不再命中（⌘ 与 Ctrl 是不同修饰键，按平台各算一个）", () => {
    expect(
      matchesHotkey(
        key("l", { ctrl: true, shift: true }),
        {
          key: "l",
          mod: true,
          shift: true,
        },
        true,
      ),
    ).toBe(false);
  });

  it("显式 ctrl 时与平台无关（刻意只在 Ctrl 上成立）", () => {
    expect(
      matchesHotkey(key("l", { ctrl: true }), { key: "l", ctrl: true }, true),
    ).toBe(true);
    expect(
      matchesHotkey(key("l", { meta: true }), { key: "l", ctrl: true }, true),
    ).toBe(false);
  });
});

describe("未声明的修饰键必须没按（否则单键会互相吞）", () => {
  it("Escape 没声明修饰键：光按命中", () => {
    expect(matchesHotkey(key("Escape"), { key: "Escape" }, false)).toBe(true);
  });

  it("Escape 配 anything 修饰键时不命中（避免与别的 Escape 快捷键打架）", () => {
    expect(
      matchesHotkey(key("Escape", { shift: true }), { key: "Escape" }, false),
    ).toBe(false);
  });

  it("声明了 shift 的组合键在没按 Shift 时不命中", () => {
    expect(
      matchesHotkey(
        key("l", { ctrl: true }),
        { key: "l", mod: true, shift: true },
        false,
      ),
    ).toBe(false);
  });

  it("主键大小写不敏感", () => {
    expect(
      matchesHotkey(key("L", { ctrl: true }), { key: "l", mod: true }, false),
    ).toBe(true);
  });
});

/* ── 注册 / 清理 / 过滤的行为层 ───────────────────────────── */

function Probe({
  onHit,
  enabled = true,
  filterInput = true,
  spec = { key: "l", mod: true } as const,
}: {
  onHit: () => void;
  enabled?: boolean;
  filterInput?: boolean;
  spec?: { key: string; mod?: boolean; shift?: boolean };
}) {
  useHotkey(spec, onHit, { enabled, filterInput });
  return <input data-testid="field" />;
}

describe("注册与清理", () => {
  it("命中时回调一次", () => {
    const onHit = vi.fn();
    render(<Probe onHit={onHit} />);
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(onHit).toHaveBeenCalledTimes(1);
  });

  it("enabled 为 false 时**不注册**（而不是注册了再 early return）", () => {
    const onHit = vi.fn();
    render(<Probe onHit={onHit} enabled={false} />);
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(onHit).not.toHaveBeenCalled();
  });

  it("卸载后监听被摘掉（不残留在 window 上）", () => {
    const onHit = vi.fn();
    const { unmount } = render(<Probe onHit={onHit} />);
    unmount();
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(onHit).not.toHaveBeenCalled();
  });

  it("命中时阻止浏览器默认行为（⌘S 会弹「保存网页」）", () => {
    const onHit = vi.fn();
    render(<Probe onHit={onHit} />);
    const event = new KeyboardEvent("keydown", {
      key: "l",
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("input 过滤（json-viewer 那处的缺陷）", () => {
  it("默认跳过可编辑元素（在别的输入框里不该被抢）", () => {
    const onHit = vi.fn();
    const { getByTestId } = render(<Probe onHit={onHit} />);
    fireEvent.keyDown(getByTestId("field"), { key: "l", ctrlKey: true });
    expect(onHit).not.toHaveBeenCalled();
  });

  it("filterInput: false 时输入框里也命中（全屏编辑器就是要这样）", () => {
    const onHit = vi.fn();
    const { getByTestId } = render(<Probe onHit={onHit} filterInput={false} />);
    fireEvent.keyDown(getByTestId("field"), { key: "l", ctrlKey: true });
    expect(onHit).toHaveBeenCalledTimes(1);
  });

  it("焦点在非可编辑元素上时照常命中", () => {
    const onHit = vi.fn();
    render(<Probe onHit={onHit} />);
    fireEvent.keyDown(document.body, { key: "l", ctrlKey: true });
    expect(onHit).toHaveBeenCalledTimes(1);
  });
});

describe("target 与平台探测的边界", () => {
  it("target 传 window 时仍然命中（显式指定的那一支）", () => {
    const onHit = vi.fn();
    render(<Probe onHit={onHit} />);
    /* `Probe` 用默认 target（window）；这里补一个显式 target 的落点。 */
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(onHit).toHaveBeenCalledTimes(1);
  });

  it("mac 上纯 Ctrl 不命中（按平台各算一个修饰键）", () => {
    /* `matchesHotkey` 的纯函数层已钉过；这里从 hook 层确认同一口径。 */
    const onHit = vi.fn();
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { platform: "MacIntel" },
      configurable: true,
    });
    try {
      render(<Probe onHit={onHit} />);
      fireEvent.keyDown(window, { key: "l", ctrlKey: true });
      expect(onHit).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "l", metaKey: true });
      expect(onHit).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNavigator,
        configurable: true,
      });
    }
  });

  it("navigator 不可用时按非 mac 处理（不抛错）", () => {
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: undefined,
      configurable: true,
    });
    try {
      const onHit = vi.fn();
      render(<Probe onHit={onHit} />);
      fireEvent.keyDown(window, { key: "l", ctrlKey: true });
      expect(onHit).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNavigator,
        configurable: true,
      });
    }
  });
});

describe("回调身份变化不重建监听", () => {
  it("父组件每轮渲染传新函数，按住一次也只在每次按下时触发一次", () => {
    const hits: string[] = [];
    const { rerender } = render(<Probe onHit={() => hits.push("a")} />);
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    rerender(<Probe onHit={() => hits.push("b")} />);
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    /* 两次按下各触发一次（没有因为重建监听而重复触发）。 */
    expect(hits).toEqual(["a", "b"]);
  });
});
