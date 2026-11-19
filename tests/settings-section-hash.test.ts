/**
 * 设置页 URL 直达分区的收敛判据（ISSUE #4163）：独立路由 `/settings` 的
 * `location.hash`（`#settings-<分区 id>`，与分区节 DOM 锚点同形）映射成
 * `initialSection`，与应用内跳转事件走同一条白名单收敛（readInitialSection）。
 * 钉住：锚点形、裸 id 形、白名单外、空值四个方向 —— 分区截图 / 分享链接
 * 依赖这条映射，锚点形制一变这里先红。
 */
import { describe, expect, it } from "vitest";

import { sectionFromLocationHash } from "../src/app/(main)/settings/hooks/use-settings-page";

describe("sectionFromLocationHash —— 设置页 URL 直达分区（ISSUE #4163）", () => {
  it("锚点形 #settings-<id> → 分区 id", () => {
    expect(sectionFromLocationHash("#settings-comfyui")).toBe("comfyui");
    expect(sectionFromLocationHash("#settings-llmLocal")).toBe("llmLocal");
    expect(sectionFromLocationHash("#settings-sizePresets")).toBe("sizePresets");
  });

  it("裸分区 id 也认（分享者手写短链）", () => {
    expect(sectionFromLocationHash("#comfyui")).toBe("comfyui");
    expect(sectionFromLocationHash("#logs")).toBe("logs");
  });

  it("白名单外 / 空值 → null（走默认分区，与应用内跳转载荷同一条收敛）", () => {
    expect(sectionFromLocationHash("#settings-不存在的分区")).toBeNull();
    expect(sectionFromLocationHash("#不存在的分区")).toBeNull();
    expect(sectionFromLocationHash("#")).toBeNull();
    expect(sectionFromLocationHash("")).toBeNull();
    expect(sectionFromLocationHash(null)).toBeNull();
    expect(sectionFromLocationHash(undefined)).toBeNull();
  });

  it("前后空白容忍（外部链接里的 hash 可能带尾随字符前的空格）", () => {
    expect(sectionFromLocationHash("# settings-comfyui")).toBe("comfyui");
    expect(sectionFromLocationHash(" #settings-comfyui ")).toBe("comfyui");
  });
});
