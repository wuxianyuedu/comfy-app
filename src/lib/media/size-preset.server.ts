// ── 尺寸配置表：服务端存储（规范 §17.2 服务端层，ISSUE #3788）─────────────
// 尺寸预设表（比例 × 分辨率，图片 / 视频两场景）的**本机覆盖**落在
// `data/size-presets.json`（应用数据，随这台机器走）；**项目默认**就是
// `src/lib/media/size-presets.ts` 里编译进包的 `DEFAULT_SIZE_PRESET_TABLE`
//（跟代码走的那份基线）——与模式契约 / 侧栏页签行为的两层来源同一套口径：
//
//   ① 项目默认（编译进包的 `DEFAULT_SIZE_PRESET_TABLE`）；
//   ② 本机覆盖（`data/size-presets.json`）—— 在而不空才生效，逐格压过 ①。
//
// 读取侧逐格合并（`mergeSizePresetTable`）：缺行、缺档、改坏的值一律回退默认，
// 因此升级新增比例行不需要写迁移。写侧整表落盘（表很小，自描述）。

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { errorText } from "~/lib/error-message";
import {
  DEFAULT_SIZE_PRESET_TABLE,
  mergeSizePresetTable,
  type SizePresetTable,
} from "~/lib/media/size-presets";

/** 本机覆盖的落点（应用根相对路径）。 */
export const SIZE_PRESETS_REL_PATH = path.join("data", "size-presets.json");

/** 读本机覆盖文件：不在 / 坏 JSON ⇒ null（按「没有覆盖」处理）。
 *  返回的是**原始 JSON**（不合并）——按场景还原要按键删原始条目，合并后的
 *  影子会把「默认值填进去的格子」误当成覆盖留下来。 */
async function readRawOverrideFile(file: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 三层一次读完：项目默认 / 本机覆盖（原始）/ 生效表（逐格合并）。 */
export async function loadSizePresetLayers(root: string = process.cwd()): Promise<{
  defaults: SizePresetTable;
  override: unknown;
  table: SizePresetTable;
}> {
  const file = path.join(/*turbopackIgnore: true*/ root, SIZE_PRESETS_REL_PATH);
  const override = await readRawOverrideFile(file);
  return {
    defaults: DEFAULT_SIZE_PRESET_TABLE,
    override,
    table: override === null ? DEFAULT_SIZE_PRESET_TABLE : mergeSizePresetTable(override),
  };
}

/** 生效的尺寸配置表（项目默认 + 本机覆盖，逐格合并）。 */
export async function loadSizePresetTable(root: string = process.cwd()): Promise<SizePresetTable> {
  const { table } = await loadSizePresetLayers(root);
  return table;
}

/** 保存整份尺寸配置表（逐格校验合并后覆盖 `data/size-presets.json`）。
 *
 *  传入**任意形状**都安全：先逐格校验合并成合法表再落盘，坏值回退默认。
 *  返回落盘（合并后）的那份表 —— 调用方（hook → refetch / store）拿它刷新界面。 */
export async function saveSizePresetTable(
  raw: unknown,
  root: string = process.cwd(),
): Promise<SizePresetTable> {
  const merged = mergeSizePresetTable(raw);
  const file = path.join(/*turbopackIgnore: true*/ root, SIZE_PRESETS_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(errorText(error, `尺寸配置表写入失败（${file}）`), { cause: error });
  }
  return merged;
}

/** 把某个场景恢复默认：从本机覆盖里去掉该场景的原始键（另一场景不受影响）。
 *
 *  覆盖文件不在时不动（本来就没有本机改动）；删掉后覆盖里一个场景都不剩时把
 *  文件一并删除（覆盖为空 = 全部回落默认）。返回还原后的生效表。 */
export async function resetSizePresetSceneOverride(
  scene: "image" | "video",
  root: string = process.cwd(),
): Promise<SizePresetTable> {
  const file = path.join(/*turbopackIgnore: true*/ root, SIZE_PRESETS_REL_PATH);
  const raw = await readRawOverrideFile(file);
  if (raw === null || typeof raw !== "object" || (!("image" in raw) && !("video" in raw))) {
    return loadSizePresetTable(root);
  }
  const record = raw as Record<string, unknown>;
  delete record[scene];
  const remainingKeys = Object.keys(record);
  try {
    if (remainingKeys.length > 0) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    } else {
      await fs.rm(file, { force: true });
    }
  } catch (error) {
    throw new Error(errorText(error, `尺寸配置表还原失败（${file}）`), { cause: error });
  }
  return loadSizePresetTable(root);
}
