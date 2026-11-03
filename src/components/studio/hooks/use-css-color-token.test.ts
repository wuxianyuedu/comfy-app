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
    /* ⚠️ **不要**写成 `if (typeof window !== "undefined") return;`：那把结论挂在了
     * 运行环境的全局默认值上，换成 jsdom 档后照样报绿但一条断言都没跑。
     * 正确形状是**把条件造出来**（`vi.stubGlobal` 显式抹掉 `window`），
     * 无论默认档是什么覆盖的都是同一分支。同款见 src/lib/app-events.test.ts。 */
    vi.stubGlobal("window", undefined);
    expect(typeof window).toBe("undefined");
    expect(readCssColorToken("--color-note-tint-base")).toBeNull();
  });
});
