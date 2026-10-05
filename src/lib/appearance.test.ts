// @vitest-environment jsdom
// 外观偏好的推导与持久化形状。核心判据不是"能不能存"，而是两条：
//   · 默认档必须与引入本功能之前**逐像素相同**（否则升级后老用户第一眼看到的就是变化）；
//   · 任何不认识的取值整份回落，不许"认哪个用哪个"（半份生效会让界面出现
//     圆角是新的、字号是旧的这种无法解释的组合）。
//
// 纯函数与存储往返写在同一份文件里：`src/lib` 根目录只认 `<name>.test.ts` 这一种
// 测试命名，点号命名的 `appearance.storage.test.ts` 会被判成裸模块。
import { afterEach, describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  FONT_SCALE_STEPS,
  RADIUS_STEPS,
  appearanceVars,
  applyAppearance,
  parseAppearance,
  readAppearance,
  saveAppearance,
  serializeAppearance,
} from "./appearance";

/** 一个够用的假元素：只记录被设过的属性。 */
function fakeElement() {
  const store = new Map<string, string>();
  return {
    style: {
      setProperty: (name: string, value: string) => {
        store.set(name, value);
      },
    },
    store,
  };
}

describe("默认档 = 引入前的原值", () => {
  it("默认圆角就是 globals.css 里那个 1rem（卡片 16px）", () => {
    expect(appearanceVars(DEFAULT_APPEARANCE)["--radius"]).toBe("1rem");
  });

  it("默认字阶倍率是 1（不设置时与从前完全相同）", () => {
    expect(appearanceVars(DEFAULT_APPEARANCE)["--font-scale"]).toBe("1");
  });

  it("「中」与「标准 100%」就是各自档位表里的默认项", () => {
    expect(
      RADIUS_STEPS.find((s) => s.id === DEFAULT_APPEARANCE.radius),
    ).toBeTruthy();
    expect(
      FONT_SCALE_STEPS.find((s) => s.id === DEFAULT_APPEARANCE.fontScale)
        ?.value,
    ).toBe("1");
  });
});

describe("parseAppearance：不认就整份回落", () => {
  it.for([
    ["空值", null],
    ["undefined", undefined],
    ["坏 JSON", "{oops"],
    ["不是对象", "42"],
    ["缺字段", JSON.stringify({ radius: "lg" })],
    ["未知圆角", JSON.stringify({ radius: "huge", fontScale: "100" })],
    ["未知字阶", JSON.stringify({ radius: "md", fontScale: "999" })],
    ["字段类型不对", JSON.stringify({ radius: 8, fontScale: 1 })],
  ])("%s ⇒ 回落默认", (_row) => {
    const [, raw] = _row;
    expect(parseAppearance(raw)).toEqual(DEFAULT_APPEARANCE);
  });

  it("一半合法一半非法也整份回落（不许圆角新的、字号旧的）", () => {
    expect(
      parseAppearance(JSON.stringify({ radius: "xl", fontScale: "nope" })),
    ).toEqual(DEFAULT_APPEARANCE);
  });

  it("合法值原样读回", () => {
    const prefs = { radius: "lg", fontScale: "110" };
    expect(parseAppearance(serializeAppearance(prefs))).toEqual(prefs);
  });
});

describe("applyAppearance", () => {
  it("一次写入两个变量", () => {
    const el = fakeElement();
    applyAppearance({ radius: "lg", fontScale: "125" }, el as never);
    expect(el.store.get("--radius")).toBe("1.25rem");
    expect(el.store.get("--font-scale")).toBe("1.25");
  });

  it("没有元素时是空操作（SSR 不炸）", () => {
    expect(() => applyAppearance(DEFAULT_APPEARANCE, null)).not.toThrow();
  });
});

describe("档位表本身", () => {
  it("每档都有非空标签与可直接写进 CSS 的值", () => {
    for (const step of [...RADIUS_STEPS, ...FONT_SCALE_STEPS]) {
      expect(step.label.trim().length).toBeGreaterThan(0);
      expect(step.value.trim().length).toBeGreaterThan(0);
      expect(step.id.trim().length).toBeGreaterThan(0);
    }
  });

  it("id 不重复（重复会让选中态指代不明）", () => {
    const radiusIds = RADIUS_STEPS.map((s) => s.id);
    const scaleIds = FONT_SCALE_STEPS.map((s) => s.id);
    expect(new Set(radiusIds).size).toBe(radiusIds.length);
    expect(new Set(scaleIds).size).toBe(scaleIds.length);
  });
});

/* ── 读写这一对走 ~/lib/browser-storage（localStorage 的唯一出口）──
   与上面的纯函数判据同属一个模块，合成一份文件：`src/lib` 根目录只认
   `<name>.test.ts` 这一种测试命名，点号命名的测试文件会被判成裸模块。 */
afterEach(() => {
  window.localStorage.clear();
});

describe("readAppearance / saveAppearance", () => {
  it("没有存过时给默认值", () => {
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it("存进去能原样读回", () => {
    expect(saveAppearance({ radius: "xl", fontScale: "90" })).toBe(true);
    expect(readAppearance()).toEqual({ radius: "xl", fontScale: "90" });
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(
      '{"radius":"xl","fontScale":"90"}',
    );
  });

  it("保存时同步写到 <html> 上（离开设置页也必须成立）", () => {
    saveAppearance({ radius: "lg", fontScale: "110" });
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe(
      "1.25rem",
    );
    expect(
      document.documentElement.style.getPropertyValue("--font-scale"),
    ).toBe("1.1");
  });

  it("存的是坏值时读回默认，且不抛", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "not-json");
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
  });
});
