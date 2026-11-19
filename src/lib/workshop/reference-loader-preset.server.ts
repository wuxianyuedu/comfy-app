// ── 参考图装载预设：服务端存储（规范 §17.2 服务端层）─────────────────────
//
// 两层来源（与模式契约 / 尺寸预设同一套房子形状）：
//   ① 成品缺省（`reference-loader-preset-defaults.json`，随包；当前为空 —— 链上的
//      控件键名跟着各实例的 object_info 走，随包写死反而容易错）；
//   ② 本机清单（`data/reference-loader-presets.json`）—— 预设编辑器保存出来的
//      **全量有效清单**，在而不空才生效。
//
// 预设是这台机器上的创作配置（不含凭据），落在 `data/` 与模式契约覆盖同目录。

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { errorText } from "~/lib/error-message";
import { atomicWriteText } from "./atomic-write.server";
import { AsyncMutex } from "~/lib/async-mutex";
import { parseReferenceLoaderPresets, type ReferenceLoaderPreset } from "./reference-loader-preset";

/** 本机清单落点（相对应用根）。 */
export const REFERENCE_LOADER_PRESETS_REL_PATH = path.join("data", "reference-loader-presets.json");
/** 成品缺省（随包，当前为空清单）。 */
export const REFERENCE_LOADER_PRESETS_DEFAULTS_REL_PATH = path.join(
  "src",
  "lib",
  "workshop",
  "reference-loader-preset-defaults.json",
);

/** 多个写方（保存）先进进程内互斥：并发保存交叠时后写者会用旧清单顶掉先写者。 */
const presetsFileMutex = new AsyncMutex();

async function readJsonFile(file: string): Promise<unknown> {
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text);
  } catch {
    /* 不存在 / 不是 JSON → 当作没有（调用方回落缺省）。 */
    return null;
  }
}

/** 生效的预设清单：本机清单在且形状合法 → 用它；否则回落成品缺省。
 *  **现读磁盘**（与模式契约同口径）：保存完下一次读取就生效，不必重启。 */
export async function loadReferenceLoaderPresets(
  root: string = process.cwd(),
): Promise<Array<ReferenceLoaderPreset>> {
  const overrideFile = path.join(/*turbopackIgnore: true*/ root, REFERENCE_LOADER_PRESETS_REL_PATH);
  const override = parseReferenceLoaderPresets(await readJsonFile(overrideFile));
  if (override !== null) {
    return override;
  }
  const defaultsFile = path.join(
    /*turbopackIgnore: true*/
    root,
    REFERENCE_LOADER_PRESETS_DEFAULTS_REL_PATH,
  );
  return parseReferenceLoaderPresets(await readJsonFile(defaultsFile)) ?? [];
}

/** 保存整份预设清单（覆盖本机清单；传空数组 = 清空）。
 *
 *  保存前过一遍判据（`parseReferenceLoaderPresets`）—— 形状不符的原样拒掉，
 *  不把垃圾写进盘。返回**落盘的**清单（归一化后），调用方拿它刷新界面。 */
export async function saveReferenceLoaderPresets(
  presets: Array<ReferenceLoaderPreset>,
  root: string = process.cwd(),
): Promise<Array<ReferenceLoaderPreset>> {
  const normalized = parseReferenceLoaderPresets(presets);
  if (normalized === null) {
    throw new Error("预设清单形状不符：每条需要 id / name / steps");
  }
  const file = path.join(/*turbopackIgnore: true*/ root, REFERENCE_LOADER_PRESETS_REL_PATH);
  await presetsFileMutex.run(async () => {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await atomicWriteText(file, `${JSON.stringify(normalized, null, 2)}\n`);
    } catch (error) {
      /* 失败必须说出来（规范 16 §16.2.4.45）：「保存了但没落盘」是最坏的形态。 */
      throw new Error(errorText(error, `参考图装载预设写入失败（${file}）`), { cause: error });
    }
  });
  return normalized;
}
