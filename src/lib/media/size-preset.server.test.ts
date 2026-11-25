/**
 * 尺寸配置表的服务端存储判据（ISSUE #3788 / #3948）。
 *
 * 这一层的题目是**两层来源怎么合**：项目默认（入库那份 JSON —— 编译进包的
 * `DEFAULT_SIZE_PRESET_TABLE` 是它的快照，开发检出里现读磁盘）与本机覆盖
 * （`data/size-presets.json`）。各钉一件事——
 *
 *   ① 没有覆盖文件时读到的是项目默认（「没配过」与「没有这张表」是两件事）；
 *   ② 覆盖存在时逐格压过默认（坏值 / 缺格仍回退默认，不是整份照收）；
 *   ③ 保存把**任意形状**的输入逐格校验合并成合法表再落盘（坏值回退默认，
 *      不把坏数据写进文件）；
 *   ④ 按场景还原：只去掉那个场景的覆盖，另一场景不动；两场景都不在覆盖里时
 *      文件一并删除（覆盖为空 = 全部回落默认）；
 *   ⑤ 写失败抛出带路径的错误（「保存了但没落盘」是最坏的形态，它唯一的痕迹
 *      就是这一句）；
 *   ⑥ 「保存到项目代码库」写进入库那份 JSON、写完即生效（现读磁盘那份），
 *      正式包（没有编排器）大声失败。
 *
 * 这里**真读写临时目录**（不 mock fs）：这一层的全部价值就是「读到了哪一份、
 * 落盘了什么」——桩掉 fs 之后这两件都判不出来。`root` 参数就是为它留的。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadSizePresetProjectDefaults,
  loadSizePresetTable,
  resetSizePresetSceneOverride,
  saveSizePresetTable,
  SIZE_PRESET_DEFAULTS_REL_PATH,
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

/** 把项目默认那份直接写进临时 root（基线随代码更新的模拟；运行期不再有写入口）。 */
function writeDefaultsFile(table: SizePresetTable): void {
  const file = path.join(root, SIZE_PRESET_DEFAULTS_REL_PATH);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(table, null, 2), "utf8");
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

  /* ── 项目默认那份（ISSUE #3948）── */

  it("读不到项目默认那份时回落编译进包的快照", async () => {
    expect(await loadSizePresetProjectDefaults(root)).toEqual(DEFAULT_SIZE_PRESET_TABLE);
    /* 坏 JSON 同样回落 —— 一份坏文件不该把整张表打成「没有默认」。 */
    const file = path.join(root, SIZE_PRESET_DEFAULTS_REL_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ 这不是 JSON", "utf8");
    expect(await loadSizePresetProjectDefaults(root)).toEqual(DEFAULT_SIZE_PRESET_TABLE);
  });

  it("本机覆盖的合并基准是**当前项目默认**那份（项目默认改过之后，新写入的覆盖不再带旧值）", async () => {
    /* 项目默认改一格（image / 16:9 / 1k → 1280×720）：基线随代码更新（直接落盘模拟）。 */
    const newDefaults = structuredClone(DEFAULT_SIZE_PRESET_TABLE);
    cell(newDefaults, "image", "16:9 横屏", "1k").width = 1280;
    cell(newDefaults, "image", "16:9 横屏", "1k").height = 720;
    writeDefaultsFile(newDefaults);

    /* 覆盖里只留「这台机器真改过的那一格」，其余跟着新项目默认走 */
    await saveSizePresetTable(
      { image: { "16:9 横屏": { "2k": { width: 1111, height: 222 } } } },
      root,
    );
    const table = await loadSizePresetTable(root);
    expect(cell(table, "image", "16:9 横屏", "1k")).toEqual({ width: 1280, height: 720 });
    expect(cell(table, "image", "16:9 横屏", "2k")).toEqual({ width: 1111, height: 222 });
  });
});

/* ── 差集落盘（ISSUE #3973）── */

describe("size-preset.server 差集落盘（ISSUE #3973）", () => {
  it("落盘的是与项目默认的差集，不是整份表", async () => {
    const saved = await saveSizePresetTable(customizedTable(), root);
    expect(cell(saved, "image", "16:9 横屏", "1k")).toEqual({ width: 1280, height: 720 });

    /* 覆盖文件里只留真改过的那一格；未改的格子不落盘（读侧回落项目默认）。 */
    const raw: unknown = JSON.parse(readFileSync(path.join(root, SIZE_PRESETS_REL_PATH), "utf8"));
    expect(raw).toEqual({
      image: { "16:9 横屏": { "1k": { width: 1280, height: 720 } } },
    });
  });

  it("项目默认后续改动能穿透到存过覆盖的机器（整份落盘会把基准钉死）", async () => {
    /* 这台机器改了一格（image 16:9 / 1k → 1280×720）并存了本机覆盖 */
    await saveSizePresetTable(customizedTable(), root);

    /* 别的检出把项目默认的 video 16:9 / 1k 改成 1920×1080 并提交（基线随代码更新） */
    const newDefaults = structuredClone(DEFAULT_SIZE_PRESET_TABLE);
    cell(newDefaults, "video", "16:9 横屏", "1k").width = 1920;
    cell(newDefaults, "video", "16:9 横屏", "1k").height = 1080;
    writeDefaultsFile(newDefaults);

    const table = await loadSizePresetTable(root);
    /* 本机真改过的格子仍是覆盖值 */
    expect(cell(table, "image", "16:9 横屏", "1k")).toEqual({ width: 1280, height: 720 });
    /* 没改过的格子拿到**新的**项目默认 —— 整份落盘时这里会钉在旧值 1280×720。 */
    expect(cell(table, "video", "16:9 横屏", "1k")).toEqual({ width: 1920, height: 1080 });
  });

  it("改回默认的格子从覆盖里消失（全部改回时覆盖为空对象）", async () => {
    await saveSizePresetTable(customizedTable(), root);

    /* 把整份表改回项目默认：没有任何格子与基准不同 ⇒ 覆盖为空。 */
    await saveSizePresetTable(DEFAULT_SIZE_PRESET_TABLE, root);
    const raw: unknown = JSON.parse(readFileSync(path.join(root, SIZE_PRESETS_REL_PATH), "utf8"));
    expect(raw).toEqual({});
    expect(await loadSizePresetTable(root)).toEqual(DEFAULT_SIZE_PRESET_TABLE);
  });
});
