/**
 * 键名归一的判据（规范 16 §16.2.4.57）。
 *
 * 这条账的形状是**判据**而不是重复代码：`event.key` 的字面量在全库有三套
 * 写法（`" "` / `"Space"` / 手写小写比较），而它们**都对也都不对** ——
 * 无修饰单键的 `event.key` 是**带 Shift 的大写字符**（`Shift+Space` 给
 * `" "`、`Shift+a` 给 `"A"`），调用处手写的字符串能不能命中全靠运气。
 */
import { describe, expect, it } from "vitest";

import { KEY, isKeyIn, normalizeKeyName } from "./keyboard";

describe("normalizeKeyName", () => {
  it('空格的两个名字归一（`Space` 与 `" "` 是同一个键）', () => {
    expect(normalizeKeyName(KEY.Space)).toBe("space");
    expect(normalizeKeyName(" ")).toBe("space");
  });

  it("小写归一 —— 带 Shift 的单字符（`A`）与具名键（`ENTER`）都能命中", () => {
    expect(normalizeKeyName("Enter")).toBe("enter");
    expect(normalizeKeyName("ENTER")).toBe("enter");
    expect(normalizeKeyName("A")).toBe("a");
    expect(normalizeKeyName("a")).toBe("a");
  });

  it('具名键不 trim 出空串（`" "` 不该被读成「没按键」）', () => {
    expect(normalizeKeyName(" ")).not.toBe("");
    expect(normalizeKeyName("")).toBe("space");
  });

  it("`Tab` 保留原语义（Shift+Tab 与 Tab 要能被区分）", () => {
    expect(normalizeKeyName("Tab")).toBe("tab");
    expect(normalizeKeyName("Tab")).not.toBe(normalizeKeyName("Escape"));
  });
});

describe("isKeyIn", () => {
  it("命中具名键与它的别名", () => {
    expect(isKeyIn("Enter", [KEY.Space, KEY.Enter])).toBe(true);
    expect(isKeyIn(" ", [KEY.Space, KEY.Enter])).toBe(true);
  });

  it("不误伤别的键", () => {
    expect(isKeyIn("Tab", [KEY.Space, KEY.Enter])).toBe(false);
    expect(isKeyIn("Escape", [KEY.Space, KEY.Enter])).toBe(false);
  });
});
