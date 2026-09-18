// 「页面跑着上一版代码」判据的行为契约。
// 这条判据决定「要不要告诉用户重载」——误报会变成噪音，漏报会让白屏没人解释，
// 所以边界（首探不算变化、取不到标识不算过期）必须有命名用例固定。

import { describe, expect, it } from "vitest";

import {
  hasCodeUpdated,
  isBuildIdChange,
  isPageOlderThanBuild,
} from "./code-update-since-load";

describe("hasCodeUpdated", () => {
  it("加载后模块被替换 → 跑过代码更新", () => {
    expect(
      hasCodeUpdated({ updatedSinceLoad: true, pageOlderThanBuild: false }),
    ).toBe(true);
  });

  it("页面从挂载起就比当前构建旧 → 同样算跑过代码更新", () => {
    expect(
      hasCodeUpdated({ updatedSinceLoad: false, pageOlderThanBuild: true }),
    ).toBe(true);
  });

  it("两者都不成立 → 没跑过代码更新（不该打扰用户）", () => {
    expect(
      hasCodeUpdated({ updatedSinceLoad: false, pageOlderThanBuild: false }),
    ).toBe(false);
  });
});

describe("isBuildIdChange", () => {
  it("首次拿到标识只是建立基准，不算「刚被更新」", () => {
    expect(isBuildIdChange(null, "build-1")).toBe(false);
  });

  it("标识变化 → 模块被替换过", () => {
    expect(isBuildIdChange("build-1", "build-2")).toBe(true);
  });

  it("标识不变 → 不是更新（轮询的常态，不产生任何提示）", () => {
    expect(isBuildIdChange("build-1", "build-1")).toBe(false);
  });

  it("这一次没读到标识 → 无法判定，不当作变化", () => {
    expect(isBuildIdChange("build-1", null)).toBe(false);
  });
});

describe("isPageOlderThanBuild", () => {
  it("加载时标识与当前一致 → 页面就是最新代码", () => {
    expect(isPageOlderThanBuild("build-1", "build-1")).toBe(false);
  });

  it("加载时标识落后 → 页面本来就更旧", () => {
    expect(isPageOlderThanBuild("build-1", "build-2")).toBe(true);
  });

  it("任一侧取不到标识 → 无法判定不等于过期，宁可漏报不误报", () => {
    expect(isPageOlderThanBuild(null, "build-2")).toBe(false);
    expect(isPageOlderThanBuild("build-1", null)).toBe(false);
  });
});
