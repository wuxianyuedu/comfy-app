import { afterEach, describe, expect, it, vi } from "vitest";

import {
  base64PayloadOf,
  wrapBase64,
  isDataUrl,
  isInlineMedia,
  parseDataUrl,
  toBase64,
  toDataUrl,
} from "./data-url";

describe("isDataUrl / isInlineMedia", () => {
  it("认 data: 前缀", () => {
    expect(isDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isDataUrl("https://example.com/a.png")).toBe(false);
    expect(isDataUrl("")).toBe(false);
  });

  it("isInlineMedia 与 isDataUrl 同判据（只是语义命名不同）", () => {
    expect(isInlineMedia("data:image/png;base64,AAAA")).toBe(true);
    expect(isInlineMedia("/api/generated/a.png")).toBe(false);
  });
});

describe("toBase64 / toDataUrl", () => {
  it("字节编成 base64", () => {
    expect(toBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe(
      "aGVsbG8=",
    );
  });

  it("拼成 data URL 时前缀与分隔符只有一处拼法", () => {
    expect(toDataUrl(new Uint8Array([104, 101]), "image/webp")).toBe(
      "data:image/webp;base64,aGU=",
    );
  });

  it("已有的 base64 载荷直接包前缀（上游回 b64_json 那一档）", () => {
    expect(wrapBase64("AAAA", "image/png")).toBe("data:image/png;base64,AAAA");
  });

  it("空字节给空载荷的 data URL（它不是合法 data URL，见 parseDataUrl）", () => {
    const url = toDataUrl(new Uint8Array(), "image/png");
    expect(url).toBe("data:image/png;base64,");
    expect(parseDataUrl(url)).toBeNull();
  });

  it("大数组分块编码不触发 RangeError", () => {
    const big = new Uint8Array(200_000);
    expect(toBase64(big).length).toBeGreaterThan(0);
  });

  /* 浏览器侧没有 `Buffer`，那一支必须也验到：收口前的 3 处写入全在服务端，
   * 而读取侧的 `character-portrait-client` 在浏览器里 —— 只覆盖 Node 分支
   * 等于让「浏览器上能不能编码」这件事没有任何判据。 */
  describe("浏览器侧（没有 Buffer 时走 btoa 分块）", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("分块 btoa 编码结果与 Buffer 一致", () => {
      const bytes = new Uint8Array(200_000);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
      const expected = toBase64(bytes);
      vi.stubGlobal("Buffer", undefined);
      expect(toBase64(bytes)).toBe(expected);
    });

    it("空数组也给空串", () => {
      vi.stubGlobal("Buffer", undefined);
      expect(toBase64(new Uint8Array())).toBe("");
    });
  });
});

describe("parseDataUrl", () => {
  it("取出 MIME 与 base64 载荷", () => {
    expect(parseDataUrl("data:image/png;base64,AAAA")).toEqual({
      mime: "image/png",
      base64: "AAAA",
    });
    expect(parseDataUrl("data:image/jpeg;charset=utf-8;base64,BBBB")).toEqual({
      mime: "image/jpeg;charset=utf-8",
      base64: "BBBB",
    });
  });

  it("MIME 缺省时给通用二进制（不假装是图片）", () => {
    expect(parseDataUrl("data:;base64,AAAA")).toEqual({
      mime: "application/octet-stream",
      base64: "AAAA",
    });
  });

  it("缺逗号 → null（收口前这里会把整串当 base64 静默解垃圾）", () => {
    expect(parseDataUrl("data:image/png;base64")).toBeNull();
  });

  it("不是 data URL → null", () => {
    expect(parseDataUrl("https://example.com/a.png")).toBeNull();
    expect(parseDataUrl("/api/generated/a.png")).toBeNull();
  });

  it("非 base64 的 data URL → null（载荷是百分号编码，按 base64 解只会得乱码）", () => {
    expect(parseDataUrl("data:text/plain,hello")).toBeNull();
    expect(parseDataUrl("data:image/svg+xml,%3Csvg/%3E")).toBeNull();
  });

  it("空载荷 → null", () => {
    expect(parseDataUrl("data:image/png;base64,")).toBeNull();
  });
});

describe("base64PayloadOf", () => {
  it("只要载荷那一档（与 parseDataUrl 同一份判据）", () => {
    expect(base64PayloadOf("data:image/png;base64,AAAA")).toBe("AAAA");
    expect(base64PayloadOf("data:text/plain,hello")).toBeNull();
    expect(base64PayloadOf("not-a-data-url")).toBeNull();
  });
});
