import { describe, expect, it } from "vitest";
import { normalizeCssColor, readCssColorToken } from "./use-css-color-token";

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
    /* vitest 的默认环境是 node，没有 document —— 正好覆盖 SSR 分支。 */
    if (typeof window !== "undefined") return;
    expect(readCssColorToken("--color-note-tint-base")).toBeNull();
  });
});
