// ── 尺寸配置表：磁盘读取侧（ISSUE #3972）────────────────────────────────
// 「生效表」（项目默认 + 本机覆盖，逐格合并）的**读取**只有这一份实现，出图链路
// 的服务端换算（工坊编排 / ComfyUI 通道 / 成片合成 / MCP）与 `/api/size-presets`
// 都经这里取同一份 —— 此前读取侧只有客户端 store 在用，服务端换算拿的是编译进包
// 的默认快照，设置里改的表只改界面、不改行为。
//
// **刻意不 `import "server-only"`**：MCP stdio 是纯 Node 进程，`server-only` 在
// 非 Next 环境直接抛错（与 `api-channel.ts` / `db.ts` 同一口径，见
// docs/workshop-mcp.md）。Node-only 的声明走 `.server.ts` 后缀（§18.4 三选一）；
// 写侧（保存 / 还原 / 保存项目默认）仍收在 `size-preset.server.ts`（带
// server-only 硬边界），本模块只提供「读」。

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  DEFAULT_SIZE_PRESET_TABLE,
  mergeSizePresetTable,
  parseSizePresetDefaults,
  type SizePresetTable,
} from "~/lib/media/size-presets";

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
export async function readRawSizePresetOverrideFile(file: string): Promise<unknown> {
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
    readRawSizePresetOverrideFile(file),
  ]);
  return {
    defaults,
    override,
    table: override === null ? defaults : mergeSizePresetTable(override, defaults),
  };
}

/** 生效的尺寸配置表（项目默认 + 本机覆盖，逐格合并）。
 *
 *  服务端出图链路在**换算宽高前**取这一份（ISSUE #3972）：设置里改过的表、
 *  「保存到项目代码库」改过的项目默认，都在这份里。 */
export async function loadSizePresetTable(root: string = process.cwd()): Promise<SizePresetTable> {
  const { table } = await loadSizePresetLayers(root);
  return table;
}
