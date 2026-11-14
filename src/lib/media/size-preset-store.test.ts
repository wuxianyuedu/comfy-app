// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mergeSizePresetTable, type SizePresetTable } from "./size-presets";
import { SIZE_PRESET_LEGACY_STORAGE_KEY } from "./size-preset-store";

/** 每个用例都重新加载模块：快照与水合进度在模块顶层各初始化一次。 */
async function loadStore() {
  vi.resetModules();
  return import("./size-preset-store");
}

/** 取一格（表是 `Record<string, …>`，索引访问在 strict 下是可选值）。 */
function cell(
  table: SizePresetTable,
  scene: "image" | "video",
  ratio: string,
  tier: "1k" | "2k" | "4k",
) {
  return table[scene][ratio]![tier];
}

/** 把 fetch 桩记下的未知形状归一成合法表（避免用例里写类型断言）。 */
function asTable(value: unknown): SizePresetTable {
  return mergeSizePresetTable(value);
}
function mockFetch(serverTable: unknown) {
  const puts: Array<unknown> = [];
  const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      const raw = init?.body;
      const bodyText = typeof raw === "string" ? raw : "null";
      const body = JSON.parse(bodyText) as unknown;
      puts.push(body);
      return Promise.resolve(new Response(bodyText, { status: 200 }));
    }
    return Promise.resolve(
      new Response(serverTable === null ? "null" : JSON.stringify(serverTable), { status: 200 }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return puts;
}

describe("size-preset-store（ISSUE #3788：应用数据 + 项目默认两层）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("无服务端覆盖、无旧键时给出默认表", async () => {
    mockFetch(null);
    const store = await loadStore();
    await store.hydrateSizePresetsFromServer();
    const table = store.getSizePresetTable();
    expect(cell(table, "image", "16:9 横屏", "1k")).toEqual({ width: 1024, height: 576 });
    expect(cell(table, "video", "16:9 横屏", "1k")).toEqual({ width: 1280, height: 720 });
  });

  it("水合：服务端的本机覆盖逐格生效；改一格落盘到应用数据", async () => {
    const custom = mergeSizePresetTable({
      image: { "16:9 横屏": { "1k": { width: 1280, height: 720 } } },
    });
    const puts = mockFetch(custom);
    const store = await loadStore();
    await store.hydrateSizePresetsFromServer();
    expect(cell(store.getSizePresetTable(), "image", "16:9 横屏", "1k")).toEqual({
      width: 1280,
      height: 720,
    });

    store.setSizePresetDims("image", "16:9 横屏", "2k", { width: 1111, height: 222 });
    expect(cell(store.getSizePresetTable(), "image", "16:9 横屏", "2k")).toEqual({
      width: 1111,
      height: 222,
    });
    /* 水合的 commit 与这一格各落盘一次；最后一份是本格改动后的表 */
    expect(puts.length).toBeGreaterThanOrEqual(2);
    const persisted = asTable(puts.at(-1));
    expect(cell(persisted, "image", "16:9 横屏", "2k")).toEqual({ width: 1111, height: 222 });
  });

  it("旧 localStorage 键一次性迁移到应用数据（旧键随后清除）", async () => {
    const legacy = mergeSizePresetTable({
      video: { "16:9 横屏": { "1k": { width: 640, height: 360 } } },
    });
    const puts = mockFetch(null);
    window.localStorage.setItem(SIZE_PRESET_LEGACY_STORAGE_KEY, JSON.stringify(legacy));
    const store = await loadStore();
    await store.hydrateSizePresetsFromServer();
    expect(cell(store.getSizePresetTable(), "video", "16:9 横屏", "1k")).toEqual({
      width: 640,
      height: 360,
    });
    expect(window.localStorage.getItem(SIZE_PRESET_LEGACY_STORAGE_KEY)).toBeNull();
    /* 迁移的表也落到了服务端 */
    expect(puts).toHaveLength(1);
    expect(cell(asTable(puts[0]), "video", "16:9 横屏", "1k")).toEqual({
      width: 640,
      height: 360,
    });
  });

  it("恢复默认只影响当前场景，且落盘", async () => {
    const puts = mockFetch(null);
    const store = await loadStore();
    await store.hydrateSizePresetsFromServer();
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
    /* 最后一次落盘里 image 已回默认、video 仍是改过的值 */
    const lastPut = asTable(puts.at(-1));
    expect(cell(lastPut, "image", "1:1 正方", "2k")).toEqual({ width: 2048, height: 2048 });
    expect(cell(lastPut, "video", "1:1 正方", "2k")).toEqual({ width: 1024, height: 1024 });
  });

  it("水合前的改动在水合后补传（不丢）", async () => {
    const puts = mockFetch(null);
    const store = await loadStore();
    /* 水合还没跑就改一格（早于引导水合的极端窗口） */
    store.setSizePresetDims("image", "16:9 横屏", "1k", { width: 1280, height: 720 });
    await store.hydrateSizePresetsFromServer();
    expect(puts.length).toBeGreaterThan(0);
    const lastPut = asTable(puts.at(-1));
    expect(cell(lastPut, "image", "16:9 横屏", "1k")).toEqual({ width: 1280, height: 720 });
  });
});
