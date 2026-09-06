import { describe, expect, it } from "vitest";

import { parseNvidiaSmiMemUsed } from "./gpu-vram";

describe("parseNvidiaSmiMemUsed", () => {
  it("标准单卡输出（MiB 整数）→ 字节", () => {
    expect(parseNvidiaSmiMemUsed("5100\n")).toBe(5100 * 1024 * 1024);
    expect(parseNvidiaSmiMemUsed("0\n")).toBe(0);
  });

  it("容忍 CRLF 与首尾空白", () => {
    expect(parseNvidiaSmiMemUsed("\r\n  5120 \r\n")).toBe(5120 * 1024 * 1024);
  });

  it("多卡输出取首行", () => {
    expect(parseNvidiaSmiMemUsed("1024\n2048\n4096\n")).toBe(1024 * 1024 * 1024);
  });

  it("N/A 占位或非数字返回 null", () => {
    expect(parseNvidiaSmiMemUsed("[N/A]\n")).toBeNull();
    expect(parseNvidiaSmiMemUsed("N/A\n")).toBeNull();
    expect(parseNvidiaSmiMemUsed("foo\n")).toBeNull();
    expect(parseNvidiaSmiMemUsed("")).toBeNull();
    expect(parseNvidiaSmiMemUsed("-1\n")).toBeNull();
  });
});
