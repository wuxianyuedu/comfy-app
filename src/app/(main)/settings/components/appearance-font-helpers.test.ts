import { describe, expect, it } from "vitest";

import {
  describeFontPart,
  fontGroupsOf,
  slotInputValue,
  stackWithSlotFont,
} from "./appearance-font-helpers";
import { DEFAULT_INTERFACE_FONT, DEFAULT_TERMINAL_FONT } from "~/lib/appearance";

describe("fontGroupsOf（ISSUE #3784：字体栈按部分分组）", () => {
  it("界面档默认栈分成三组：西文 / 中文 / 系统回退，只有回退组不可配", () => {
    const groups = fontGroupsOf(DEFAULT_INTERFACE_FONT, "interface");
    expect(groups.map((g) => g.slot)).toEqual(["primary", "cjk", "fallback"]);
    expect(groups[0]?.items).toEqual(["var(--font-geist-sans)"]);
    expect(groups[1]?.items).toEqual([
      '"Sarasa UI SC"',
      '"PingFang SC"',
      '"Microsoft YaHei"',
      '"Noto Sans SC"',
    ]);
    expect(groups[2]?.items).toEqual(["system-ui", "-apple-system", "sans-serif"]);
    expect(groups[2]?.editable).toBe(false);
  });

  it("自定义项（不在已知清单里）归入首选组", () => {
    const groups = fontGroupsOf("Inter, sans-serif", "interface");
    expect(groups[0]?.items).toEqual(["Inter"]);
  });
});

describe("slotInputValue（ISSUE #3784）", () => {
  it("内置变量项显示为空（输入框留空 = 用默认）", () => {
    expect(slotInputValue(DEFAULT_INTERFACE_FONT, "interface", "primary")).toBe("");
  });

  it("普通项去掉引号后作为输入值", () => {
    expect(slotInputValue(DEFAULT_INTERFACE_FONT, "interface", "cjk")).toBe("Sarasa UI SC");
  });
});

describe("stackWithSlotFont（ISSUE #3784 补充：不同部分配不同的字体）", () => {
  it("换西文字体：该组旧项被替换，中文与回退原样、顺序不变", () => {
    expect(stackWithSlotFont(DEFAULT_INTERFACE_FONT, "interface", "primary", "Inter")).toBe(
      'Inter, "Sarasa UI SC", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, -apple-system, sans-serif',
    );
  });

  it("换中文字体：中文那一组的全部字体换成这一种，其余原样", () => {
    expect(stackWithSlotFont(DEFAULT_INTERFACE_FONT, "interface", "cjk", "Noto Sans SC")).toBe(
      'var(--font-geist-sans), "Noto Sans SC", system-ui, -apple-system, sans-serif',
    );
  });

  it("family 为空 = 该槽恢复默认项", () => {
    const custom = stackWithSlotFont(DEFAULT_INTERFACE_FONT, "interface", "primary", "Inter");
    expect(stackWithSlotFont(custom, "interface", "primary", null)).toBe(DEFAULT_INTERFACE_FONT);
  });

  it("终端档：中文字体组在栈的靠后位置也能被替换", () => {
    expect(stackWithSlotFont(DEFAULT_TERMINAL_FONT, "terminal", "cjk", "Noto Sans SC")).toBe(
      '"SF Mono", ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", Consolas, "Noto Sans SC", monospace',
    );
  });

  it("原栈里没有该槽的项时，插在下一个槽前面（保住优先级）", () => {
    /* 极端场景：栈被清得只剩回退项，补上首选槽要插在回退之前 */
    const bare = "system-ui, sans-serif";
    expect(stackWithSlotFont(bare, "interface", "primary", "Inter")).toBe(
      "Inter, system-ui, sans-serif",
    );
  });
});

describe("describeFontPart", () => {
  it("内置变量与系统项给出可读说明", () => {
    expect(describeFontPart("var(--font-geist-sans)")).toBe("Geist Sans（内置西文字体）");
    expect(describeFontPart("sans-serif")).toBe("sans-serif（通用回退）");
  });

  it("自定义字体名原样保留", () => {
    expect(describeFontPart('"IBM Plex Mono"')).toBe("IBM Plex Mono");
  });
});
