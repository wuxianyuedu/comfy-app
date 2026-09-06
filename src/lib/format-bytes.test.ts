import { describe, expect, it } from "vitest";

import { fmtBytes } from "./format-bytes";

describe("fmtBytes", () => {
  it("≥1GB 显示 1 位小数 GB", () => {
    expect(fmtBytes(6 * 1024 * 1024 * 1024)).toBe("6.0 GB");
    expect(fmtBytes(12.8 * 1024 * 1024 * 1024)).toBe("12.8 GB");
  });

  it("MB/KB/B 逐级降档", () => {
    expect(fmtBytes(2.5 * 1024 * 1024)).toBe("3 MB");
    expect(fmtBytes(2.4 * 1024 * 1024)).toBe("2 MB");
    expect(fmtBytes(1024)).toBe("1 KB");
    expect(fmtBytes(512)).toBe("512 B");
  });

  it("非法/空值返回 null", () => {
    expect(fmtBytes(null)).toBeNull();
    expect(fmtBytes(undefined)).toBeNull();
    expect(fmtBytes(-1)).toBeNull();
    expect(fmtBytes(Number.NaN)).toBeNull();
  });
});
