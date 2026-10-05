import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeCssColor, readCssColorToken } from "./use-css-color-token";

afterEach(() => vi.unstubAllGlobals());

describe("normalizeCssColor", () => {
  it("归一等值：3 位 / 6 位 hex", () => {
    expect(normalizeCssColor("#abc")).toBe("#aabbcc");
    expect(normalizeCssColor("#AABBCC")).toBe("#aabbcc");
  });

  it("归一 rgb / rgba 为 hex，忽略 alpha", () => {
    expect(normalizeCssColor("rgb(22, 34, 44)")).toBe("#16222c");
    expect(normalizeCssColor("rgba(255, 255, 255, 0.5)")).toBe("#ffffff");
  });

  it("不认识的值返回 null（调用方决定兜底）", () => {
    expect(normalizeCssColor("")).toBeNull();
    expect(normalizeCssColor("color-mix(in srgb, red, blue)")).toBeNull();
    expect(normalizeCssColor("var(--color-x)")).toBeNull();
  });
});

describe("readCssColorToken", () => {
  it("服务端（无 window）返回 null，由调用方兜底", () => {
    /* ⚠️ **不要**写成 `if (typeof window !== "undefined") return;`。
     * 那种写法把「本用例的结论」挂在了**运行环境的一个全局默认值**上：
     * 检出里把默认档换成 jsdom（或本文件哪天被加进 jsdom 档）之后，
     * 它照样报绿 —— 但一条断言都没跑。绿有两种含义，而这一条恰好是坏的那种。
     * 正确形状是**把条件造出来**（`vi.stubGlobal` 显式抹掉 `window`），
     * 于是无论默认档是什么，被覆盖的都是同一个分支。
     * 同款做法见 src/lib/app-events.test.ts 的「无 `window` 时…」那条。 */
    vi.stubGlobal("window", undefined);
    expect(typeof window).toBe("undefined");
    expect(readCssColorToken("--color-note-tint-base")).toBeNull();
  });
});
