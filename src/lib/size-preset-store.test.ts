// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SIZE_PRESET_STORAGE_KEY } from "./size-preset-store";
import type { SizeDims, SizePresetTable, SizeScene } from "./size-presets";

/** 每个用例都重新加载模块：快照在模块顶层从 localStorage 读一次。 */
async function loadStore() {
  vi.resetModules();
  return import("./size-preset-store");
}

/** 取一格（表是 `Record<string, …>`，索引访问在 strict 下是可选值）。 */
function cell(
  table: SizePresetTable,
  scene: SizeScene,
  ratio: string,
  tier: "1k" | "2k" | "4k",
): SizeDims {
  return table[scene][ratio]![tier];
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("size-preset-store", () => {
  it("无存储内容时给出默认表", async () => {
    const store = await loadStore();
    const table = store.getSizePresetTable();
    expect(cell(table, "image", "16:9 横屏", "1k")).toEqual({ width: 1024, height: 576 });
    expect(cell(table, "video", "16:9 横屏", "1k")).toEqual({ width: 1280, height: 720 });
  });

  it("改一格：快照换新值、落盘、并通知订阅者", async () => {
    const store = await loadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeSizePresetTable(listener);

    store.setSizePresetDims("image", "16:9 横屏", "1k", { width: 1280, height: 720 });

    expect(cell(store.getSizePresetTable(), "image", "16:9 横屏", "1k")).toEqual({
      width: 1280,
      height: 720,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(
      window.localStorage.getItem(SIZE_PRESET_STORAGE_KEY) ?? "null",
    ) as { image?: Record<string, Record<string, unknown>> } | null;
    expect(persisted?.image?.["16:9 横屏"]?.["1k"]).toEqual({ width: 1280, height: 720 });

    unsubscribe();
    store.setSizePresetDims("image", "16:9 横屏", "1k", { width: 1024, height: 576 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("恢复默认只影响当前场景", async () => {
    const store = await loadStore();
    store.setSizePresetDims("image", "1:1 正方", "2k", { width: 1024, height: 1024 });
    store.setSizePresetDims("video", "1:1 正方", "2k", { width: 1024, height: 1024 });

    store.resetSizePresetScene("image");

    expect(cell(store.getSizePresetTable(), "image", "1:1 正方", "2k")).toEqual({
      width: 2048,
      height: 2048,
    });
    expect(cell(store.getSizePresetTable(), "video", "1:1 正方", "2k")).toEqual({
      width: 1024,
      height: 1024,
    });
  });

  it("损坏 / 越界的存储值逐格回退默认，不影响其它格子", async () => {
    window.localStorage.setItem(
      SIZE_PRESET_STORAGE_KEY,
      JSON.stringify({
        image: {
          "1:1 正方": { "1k": { width: -1, height: 0 }, "2k": { width: 4096, height: 4096 } },
        },
        video: "not-an-object",
      }),
    );
    const store = await loadStore();
    const table = store.getSizePresetTable();

    expect(cell(table, "image", "1:1 正方", "1k")).toEqual({ width: 1024, height: 1024 });
    expect(cell(table, "image", "1:1 正方", "2k")).toEqual({ width: 4096, height: 4096 });
    expect(cell(table, "image", "1:1 正方", "4k")).toEqual({ width: 3840, height: 3840 });
    expect(cell(table, "video", "16:9 横屏", "1k")).toEqual({ width: 1280, height: 720 });
  });

  it("JSON 解析失败时回退默认表而不是抛错", async () => {
    window.localStorage.setItem(SIZE_PRESET_STORAGE_KEY, "{ not json");
    const store = await loadStore();
    expect(cell(store.getSizePresetTable(), "image", "1:1 正方", "1k")).toEqual({
      width: 1024,
      height: 1024,
    });
  });
});
