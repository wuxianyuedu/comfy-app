/**
 * 尺寸配置表「读取侧」的判据（ISSUE #3972）。
 *
 * 读取侧收在 `size-preset-fs.server.ts`（双宿主：Next 路由与 MCP stdio 共用，
 * 刻意不带 `server-only`）。这里钉住它作为**读侧唯一实现**的合同：
 *   · 没有覆盖文件 ⇒ 生效表 = 项目默认（现读磁盘那份）；
 *   · 覆盖文件存在 ⇒ 逐格压过项目默认；
 *   · `loadSizePresetLayers` 一次给全三层（defaults / override / table）。
 * 合并的逐格回退细节已在 `size-preset.server.test.ts`（经 re-export 走同一份
 * 实现）覆盖，这里不重复。
 *
 * 真读写临时目录（不 mock fs）：这一层的价值就是「读到了哪一份」。
 */
import { mkdirSync, mkdtempSync, writeFileSync, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadSizePresetLayers,
  loadSizePresetTable,
  SIZE_PRESETS_REL_PATH,
} from "./size-preset-fs.server";
import { DEFAULT_SIZE_PRESET_TABLE } from "./size-presets";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "size-preset-fs-"));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe("size-preset-fs.server（读侧唯一实现，ISSUE #3972）", () => {
  it("没有覆盖文件时，生效表 = 项目默认", async () => {
    expect(await loadSizePresetTable(root)).toEqual(DEFAULT_SIZE_PRESET_TABLE);
  });

  it("覆盖文件存在时，改过的格子逐格生效", async () => {
    const file = path.join(root, SIZE_PRESETS_REL_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ image: { "16:9 横屏": { "1k": { width: 1280, height: 720 } } } }),
      "utf8",
    );
    const table = await loadSizePresetTable(root);
    expect(table.image["16:9 横屏"]?.["1k"]).toEqual({ width: 1280, height: 720 });
    /* 未改的格子仍是项目默认 */
    expect(table.image["16:9 横屏"]?.["2k"]).toEqual(
      DEFAULT_SIZE_PRESET_TABLE.image["16:9 横屏"]?.["2k"],
    );
  });

  it("loadSizePresetLayers 一次给全三层：项目默认 / 覆盖原文 / 生效表", async () => {
    const layers = await loadSizePresetLayers(root);
    expect(layers.defaults).toEqual(DEFAULT_SIZE_PRESET_TABLE);
    expect(layers.override).toBeNull();
    expect(layers.table).toEqual(DEFAULT_SIZE_PRESET_TABLE);

    const file = path.join(root, SIZE_PRESETS_REL_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ video: { "16:9 横屏": { "1k": { width: 1920, height: 1080 } } } }),
      "utf8",
    );
    const withOverride = await loadSizePresetLayers(root);
    expect(withOverride.override).not.toBeNull();
    expect(withOverride.table.video["16:9 横屏"]?.["1k"]).toEqual({ width: 1920, height: 1080 });
  });
});
