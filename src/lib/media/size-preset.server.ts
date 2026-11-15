// ── 尺寸配置表：服务端存储（规范 §17.2 服务端层，ISSUE #3788 / #3948）────────
// 尺寸预设表（比例 × 分辨率，图片 / 视频两场景）的两层来源，与模式契约 / 侧栏页签
// 行为同一套口径：
//
//   ① 项目默认（`src/lib/media/size-preset-defaults.json`，入库、跟代码走）——
//      静态 import 进产物的那份快照（`size-presets.ts` 的 `DEFAULT_SIZE_PRESET_TABLE`）
//      是它的编译态；开发检出里**现读磁盘**（写完即生效，不必重启进程，与 #3634
//      同一口径），读不出来才回落那份快照（正式包里没有源码）。
//   ② 本机覆盖（`data/size-presets.json`）—— 在而不空才生效，逐格压过 ①。
//
// 读取侧逐格合并（`mergeSizePresetTable`）：缺行、缺档、改坏的值一律回退基准，
// 因此升级新增比例行不需要写迁移。写侧整表落盘（表很小，自描述）。
//
// 「保存到项目代码库」写的是 ① 那份 JSON（ISSUE #3948）：提交后每个检出与每个
// 桌包都是这一份 —— 只有开发检出有可写的目标文件。

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { errorText } from "~/lib/error-message";
import { AsyncMutex } from "~/lib/async-mutex";
import { isDevCheckout } from "~/lib/shell/dev-checkout.server";
import {
  DEFAULT_SIZE_PRESET_TABLE,
  mergeSizePresetTable,
  parseSizePresetDefaults,
  type SizePresetTable,
} from "~/lib/media/size-presets";

/** 同一份覆盖文件的多个写方（保存 / 按场景还原）先进进程内互斥（ISSUE #3859）：
 *  「读 → 改 → 整份写回」并发交叠时，后写者会用旧快照顶掉先写者的改动。 */
const overrideFileMutex = new AsyncMutex();

/** 覆盖文件的原子写（ISSUE #3859）：tmp + rename，读侧不会撞到半截 JSON。 */
async function atomicWriteText(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** 本机覆盖的落点（应用根相对路径）。 */
export const SIZE_PRESETS_REL_PATH = path.join("data", "size-presets.json");

/** 项目默认那份（入库、跟代码走）的落点（仓库根相对路径）。
 *
 *  与 {@link SIZE_PRESETS_REL_PATH} 的分工：那份是「这台机器上的额外改动」（不入库），
 *  这份是「界面里点『保存到项目代码库』写出来的默认」（提交后每个检出与每个桌包
 *  都是它）。只有开发检出有写它的入口（正式包载荷里没有源码）。
 */
export const SIZE_PRESET_DEFAULTS_REL_PATH = "src/lib/media/size-preset-defaults.json";

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

/** 项目默认那份：现读磁盘上那份，读不出来 / 坏掉才回落编译进包的那份快照。
 *
 *  为什么现读（与「模式契约」#3634 同一口径）：「保存到项目代码库」写的就是它，
 *  写完必须**立刻**读到 —— 否则用户写完还得重启进程才生效。
 */
export async function loadSizePresetProjectDefaults(
  root: string = process.cwd(),
): Promise<SizePresetTable> {
  const file = path.join(/*turbopackIgnore: true*/ root, SIZE_PRESET_DEFAULTS_REL_PATH);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    /* 读不出来（正式包里没有源码 / 手改删了）：回落编译进包的那份快照。 */
    return DEFAULT_SIZE_PRESET_TABLE;
  }
  try {
    return parseSizePresetDefaults(JSON.parse(raw));
  } catch {
    /* 坏 JSON：同样回落快照 —— 一份坏文件不该把整张表打成「没有默认」。 */
    return DEFAULT_SIZE_PRESET_TABLE;
  }
}

/** 三层一次读完：项目默认 / 本机覆盖（原始）/ 生效表（逐格合并）。 */
export async function loadSizePresetLayers(root: string = process.cwd()): Promise<{
  defaults: SizePresetTable;
  override: unknown;
  table: SizePresetTable;
}> {
  const file = path.join(/*turbopackIgnore: true*/ root, SIZE_PRESETS_REL_PATH);
  const [defaults, override] = await Promise.all([
    loadSizePresetProjectDefaults(root),
    readRawOverrideFile(file),
  ]);
  return {
    defaults,
    override,
    table: override === null ? defaults : mergeSizePresetTable(override, defaults),
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
 *  合并的基准是**现读**的项目默认（`loadSizePresetProjectDefaults`）—— 项目默认
 *  刚被「保存到项目代码库」改过时，拿旧基准算会把已经与基线相同的格子留在覆盖里。
 *  返回落盘（合并后）的那份表 —— 调用方（hook → refetch / store）拿它刷新界面。 */
export async function saveSizePresetTable(
  raw: unknown,
  root: string = process.cwd(),
): Promise<SizePresetTable> {
  const file = path.join(/*turbopackIgnore: true*/ root, SIZE_PRESETS_REL_PATH);
  return overrideFileMutex.run(async () => {
    const merged = mergeSizePresetTable(raw, await loadSizePresetProjectDefaults(root));
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await atomicWriteText(file, `${JSON.stringify(merged, null, 2)}\n`);
    } catch (error) {
      throw new Error(errorText(error, `尺寸配置表写入失败（${file}）`), { cause: error });
    }
    return merged;
  });
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
  return overrideFileMutex.run(async () => {
    const raw = await readRawOverrideFile(file);
    if (raw === null || typeof raw !== "object" || (!("image" in raw) && !("video" in raw))) {
      return loadSizePresetTable(root);
    }
    const record = raw as Record<string, unknown>;
    delete record[scene];
    const remainingKeys = Object.keys(record);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      if (remainingKeys.length > 0) {
        await atomicWriteText(file, `${JSON.stringify(raw, null, 2)}\n`);
      } else {
        await fs.rm(file, { force: true });
      }
    } catch (error) {
      throw new Error(errorText(error, `尺寸配置表还原失败（${file}）`), { cause: error });
    }
    return loadSizePresetTable(root);
  });
}

/**
 * 「保存为项目默认（跟代码走）」：把当前这份表**全量**写进入库的项目默认 JSON。
 *
 * 只有开发检出可以调：正式包没有源码可写，这格调用本身就是错用 —— 大声失败而不是
 * 假装成功。写完后读取侧现读磁盘（`loadSizePresetProjectDefaults`），**写完即生效**；
 * 提交之后别的检出与桌包才是这一份（桌包要重新构建才带上）。
 */
export async function saveSizePresetTableAsProjectDefaults(
  raw: unknown,
  root: string = process.cwd(),
): Promise<{ file: string; table: SizePresetTable }> {
  if (!isDevCheckout(root)) {
    throw new Error(
      "保存为项目默认只在开发检出可用（这份检出里没有 scripts/dev-launcher.mjs）——" +
        "正式包的改动请改一格即存（只落本机）。",
    );
  }
  const table = parseSizePresetDefaults(raw);
  const file = path.join(/*turbopackIgnore: true*/ root, SIZE_PRESET_DEFAULTS_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteText(file, `${JSON.stringify(table, null, 2)}\n`);
  } catch (error) {
    throw new Error(errorText(error, `尺寸配置表项目默认写入失败（${file}）`), { cause: error });
  }
  return { file, table };
}
