/**
 * 尺寸配置表的服务端存储判据（ISSUE #3788）。
 *
 * 这一层的题目是**两层来源怎么合**：项目默认（编译进包的 DEFAULT_SIZE_PRESET_TABLE）
 * 与本机覆盖（`data/size-presets.json`）。各钉一件事——
 *
 *   ① 没有覆盖文件时读到的是项目默认（「没配过」与「没有这张表」是两件事）；
 *   ② 覆盖存在时逐格压过默认（坏值 / 缺格仍回退默认，不是整份照收）；
 *   ③ 保存把**任意形状**的输入逐格校验合并成合法表再落盘（坏值回退默认，
 *      不把坏数据写进文件）；
 *   ④ 按场景还原：只去掉那个场景的覆盖，另一场景不动；两场景都不在覆盖里时
 *      文件一并删除（覆盖为空 = 全部回落默认）；
 *   ⑤ 写失败抛出带路径的错误（「保存了但没落盘」是最坏的形态，它唯一的痕迹
 *      就是这一句）。
 *
 * 这里**真读写临时目录**（不 mock fs）：这一层的全部价值就是「读到了哪一份、
 * 落盘了什么」——桩掉 fs 之后这两件都判不出来。`root` 参数就是为它留的。
 */
import { mkdtempSync, writeFileSync, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadSizePresetTable,
  resetSizePresetSceneOverride,
  saveSizePresetTable,
  SIZE_PRESETS_REL_PATH,
} from "./size-preset.server";
import {
  DEFAULT_SIZE_PRESET_TABLE,
  type SizeDims,
  type SizePresetTable,
  type SizeScene,
} from "./size-presets";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "size-preset-server-"));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

/** 取一格（表是 `Record<string, …>`，索引访问在 strict 下是可选值）。 */
function cell(
  table: SizePresetTable,
  scene: SizeScene,
  ratio: string,
  tier: "1k" | "2k" | "4k",
): SizeDims {
  return table[scene][ratio]![tier];
}

/** 改一格后的完整表（在默认表上把 image 的 16:9 / 1k 改成 1280×720）。 */
function customizedTable(): SizePresetTable {
  const table = structuredClone(DEFAULT_SIZE_PRESET_TABLE);
  cell(table, "image", "16:9 横屏", "1k").width = 1280;
  cell(table, "image", "16:9 横屏", "1k").height = 720;
  return table;
}

describe("size-preset.server（ISSUE #3788）", () => {
  it("没有覆盖文件时读到的是项目默认表", async () => {
    const table = await loadSizePresetTable(root);
    expect(table).toEqual(DEFAULT_SIZE_PRESET_TABLE);
  });

  it("保存后的覆盖逐格生效；读回的仍是合并后的合法表", async () => {
    const saved = await saveSizePresetTable(customizedTable(), root);
    expect(cell(saved, "image", "16:9 横屏", "1k")).toEqual({ width: 1280, height: 720 });

    const table = await loadSizePresetTable(root);
    expect(cell(table, "image", "16:9 横屏", "1k")).toEqual({ width: 1280, height: 720 });
    /* 未改的格子仍是项目默认 */
    expect(cell(table, "video", "16:9 横屏", "1k")).toEqual({ width: 1280, height: 720 });
  });

  it("坏值逐格回退默认（合法覆盖照收），不把坏数据写进文件", async () => {
    const raw = {
      image: {
        "16:9 横屏": {
          "1k": { width: -1, height: 0 },
          "2k": { width: 4096, height: 4096 },
        },
      },
      video: "not-an-object",
    };
    const saved = await saveSizePresetTable(raw, root);
    /* 1k 的坏值回退默认；2k 的合法覆盖照收 */
    expect(cell(saved, "image", "16:9 横屏", "1k")).toEqual({ width: 1024, height: 576 });
    expect(cell(saved, "image", "16:9 横屏", "2k")).toEqual({ width: 4096, height: 4096 });

    const table = await loadSizePresetTable(root);
    expect(cell(table, "image", "16:9 横屏", "1k")).toEqual({ width: 1024, height: 576 });
    expect(cell(table, "image", "16:9 横屏", "2k")).toEqual({ width: 4096, height: 4096 });
  });

  it("按场景还原：只去掉那个场景的覆盖，另一场景不动；覆盖清空时文件删除", async () => {
    await saveSizePresetTable(customizedTable(), root);
    /* video 场景也改一格，保证「另一场景不动」可判 */
    const withVideo = customizedTable();
    cell(withVideo, "video", "16:9 横屏", "1k").width = 640;
    cell(withVideo, "video", "16:9 横屏", "1k").height = 360;
    await saveSizePresetTable(withVideo, root);

    await resetSizePresetSceneOverride("image", root);
    const table = await loadSizePresetTable(root);
    expect(cell(table, "image", "16:9 横屏", "1k")).toEqual({ width: 1024, height: 576 });
    expect(cell(table, "video", "16:9 横屏", "1k")).toEqual({ width: 640, height: 360 });

    await resetSizePresetSceneOverride("video", root);
    const file = path.join(root, SIZE_PRESETS_REL_PATH);
    await expect(fsp.access(file)).rejects.toThrow();
    expect(await loadSizePresetTable(root)).toEqual(DEFAULT_SIZE_PRESET_TABLE);
  });

  it("写失败抛出带路径的错误（「保存了但没落盘」必须留痕）", async () => {
    /* 把 root 指到一个文件上，mkdir/write 必然失败 */
    const notADir = path.join(root, "not-a-dir");
    writeFileSync(notADir, "x", "utf8");
    await expect(saveSizePresetTable(customizedTable(), notADir)).rejects.toThrow(
      /尺寸配置表写入失败/,
    );
  });
});
