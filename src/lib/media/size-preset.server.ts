// ── 尺寸配置表：服务端存储·写侧（规范 §17.2 服务端层，ISSUE #3788 / #3948）──
// 尺寸预设表（比例 × 分辨率，图片 / 视频两场景）的两层来源，与模式契约 / 侧栏页签
// 行为同一套口径：
//
//   ① 编译进包的默认值（`src/lib/media/size-preset-defaults.json`）—— 静态
//      import 进产物的那份快照（`size-presets.ts` 的 `DEFAULT_SIZE_PRESET_TABLE`）
//      就是它的编译态；**运行期不写它**（ISSUE #4150：运行期写 src 的代价是工作树
//      常挂 M + dev 下 Turbopack 模块图失效）。改它走代码 / PR。
//   ② 本机项目默认覆盖（`data/size-preset-project-defaults.json`，#4150 起）——
//      「保存为项目默认」写出来的全量基线，不入库；在而不空才作为基准，压过 ①。
//   ③ 本机覆盖（`data/size-presets.json`）—— 在而不空才生效，逐格压过基准
//      （②或①，谁在用谁）。
//
// 读取侧逐格合并（`mergeSizePresetTable`）：缺行、缺档、改坏的值一律回退基准，
// 因此升级新增比例行不需要写迁移。写侧**差集落盘**（ISSUE #3973）：只留与项目
// 默认不同的格子（`diffSizePresetTable`），与侧栏页签行为 / 模式契约同一口径 ——
// 项目默认后续改动能穿透到存过覆盖的机器，「改回默认」= 该格从覆盖里消失。
//
// 「保存为项目默认」写的是 ② 那份运行时覆盖（ISSUE #4150 起；此前直接写 src
// 那份编译源，由人提交后生效）—— 只有开发检出有这个入口；要改出厂默认请改
// ① 走 PR。
//
// **读取侧在 `size-preset-fs.server.ts`**（ISSUE #3972 起拆出）：MCP stdio 等
// 纯 Node 宿主要读生效表（出图链路的换算），不能碰 `server-only`；本文件保留
// 「写」（保存 / 还原 / 保存项目默认）并 re-export 读取口，既有消费方
// （`/api/size-presets`）的 import 路径不变。

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { errorText } from "~/lib/error-message";
import { AsyncMutex } from "~/lib/async-mutex";
import { isDevCheckout } from "~/lib/shell/dev-checkout.server";
import { diffSizePresetTable } from "~/lib/media/size-presets-diff";
import {
  mergeSizePresetTable,
  parseSizePresetDefaults,
  type SizePresetTable,
} from "~/lib/media/size-presets";
import {
  loadSizePresetLayers,
  loadSizePresetProjectDefaults,
  loadSizePresetTable,
  readRawSizePresetOverrideFile,
  SIZE_PRESETS_REL_PATH,
  SIZE_PRESET_DEFAULTS_REL_PATH,
  SIZE_PRESET_PROJECT_DEFAULTS_RUNTIME_REL_PATH,
} from "~/lib/media/size-preset-fs.server";

/* 读取侧唯一实现（含两个落点常量）在 size-preset-fs.server.ts；这里原样
 * 转出口，让既有消费方（/api/size-presets、各测试）的引用路径保持不变。 */
export {
  loadSizePresetLayers,
  loadSizePresetProjectDefaults,
  loadSizePresetTable,
  SIZE_PRESETS_REL_PATH,
  SIZE_PRESET_DEFAULTS_REL_PATH,
  SIZE_PRESET_PROJECT_DEFAULTS_RUNTIME_REL_PATH,
};

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

/** 保存尺寸配置表的本机覆盖（**差集**落盘到 `data/size-presets.json`，ISSUE #3973）。
 *
 *  传入**任意形状**都安全：先逐格校验合并成合法表（坏值回退默认），再对**现读的
 *  项目默认**取差集 —— 覆盖文件里只留「这台机器上真的改过的那几格」。于是项目默认
 *  后续改动（别的检出「保存到项目代码库」、拉到新代码）能穿透到这台机器；把某格
 *  改回默认再保存 = 该格从覆盖里消失。合并的基准是**现读**的项目默认
 *  （`loadSizePresetProjectDefaults`）—— 项目默认刚被改过时，拿旧基准算会把已经
 *  与基线相同的格子留在覆盖里。
 *  返回**合并后的完整表**（与落盘的差集不同）—— 调用方（hook → refetch / store）
 *  拿它刷新界面。 */
export async function saveSizePresetTable(
  raw: unknown,
  root: string = process.cwd(),
): Promise<SizePresetTable> {
  const file = path.join(/*turbopackIgnore: true*/ root, SIZE_PRESETS_REL_PATH);
  return overrideFileMutex.run(async () => {
    const defaults = await loadSizePresetProjectDefaults(root);
    const merged = mergeSizePresetTable(raw, defaults);
    const diff = diffSizePresetTable(merged, defaults);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await atomicWriteText(file, `${JSON.stringify(diff, null, 2)}\n`);
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
    const raw = await readRawSizePresetOverrideFile(file);
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
 * 「保存为项目默认」：把当前这份表**全量**写进本机项目默认覆盖（`data/`，
 * ISSUE #4150）。
 *
 * 只有开发检出可以调：这格是出厂默认流程的开发期入口。写完后读取侧现读运行时
 * 覆盖（`loadSizePresetProjectDefaults`），**写完即生效**；要改出厂默认请改
 * `src/lib/media/size-preset-defaults.json` 走 PR（那份是编译源，运行期不写它）。
 */
export async function saveSizePresetTableAsProjectDefaults(
  raw: unknown,
  root: string = process.cwd(),
): Promise<{ file: string; table: SizePresetTable }> {
  if (!isDevCheckout(root)) {
    throw new Error(
      "保存为项目默认只在开发检出可用——" + "正式包的改动请改一格即存（只落本机覆盖）。",
    );
  }
  const table = parseSizePresetDefaults(raw);
  const file = path.join(root, SIZE_PRESET_PROJECT_DEFAULTS_RUNTIME_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteText(file, `${JSON.stringify(table, null, 2)}\n`);
  } catch (error) {
    throw new Error(errorText(error, `尺寸配置表项目默认写入失败（${file}）`), { cause: error });
  }
  return { file, table };
}
