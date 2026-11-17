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

import { logger } from "~/lib/core/logger";
import { migrateLegacyDefaultsFile } from "~/lib/core/defaults-legacy-migration.server";
import {
  DEFAULT_SIZE_PRESET_TABLE,
  mergeSizePresetTable,
  parseSizePresetDefaults,
  type SizePresetTable,
} from "~/lib/media/size-presets";

/** 本机覆盖的落点（应用根相对路径）。 */
export const SIZE_PRESETS_REL_PATH = path.join("data", "size-presets.json");

/** 本机项目默认覆盖的落点（ISSUE #4150）：「保存为项目默认」的运行期写入落这里，
 *  不入库。与 {@link SIZE_PRESET_DEFAULTS_REL_PATH} 的分工：那份只剩编译期默认值
 *  （静态 import 的编译源，改它走代码 / PR），这份是「这台机器上点过『保存为项目
 *  默认』的那份全量基线」。 */
export const SIZE_PRESET_PROJECT_DEFAULTS_RUNTIME_REL_PATH = path.join(
  "data",
  "size-preset-project-defaults.json",
);

/** 编译进包的默认值落点 —— 静态 import 的编译源（`size-presets.ts` 引它），
 *  **运行期不再写它**。本常量现仅服务存量迁移的判据（旧版把「保存为项目默认」
 *  写在这里，遗留的用户态要搬去
 *  {@link SIZE_PRESET_PROJECT_DEFAULTS_RUNTIME_REL_PATH}）。 */
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

/** 项目默认基线：现读本机项目默认覆盖（`data/`），读不出来 / 坏掉才回落编译进包
 *  的那份快照。
 *
 *  为什么现读（与「模式契约」#3634 同一口径）：「保存为项目默认」写完必须**立刻**
 *  读到 —— 否则用户写完还得重启进程才生效。#4150 起写入落点从 src 那份编译源
 *  改为本机运行时覆盖（`SIZE_PRESET_PROJECT_DEFAULTS_RUNTIME_REL_PATH`），读链
 *  随之收口：运行期不再读 / 写 src（工作树噪声与 dev 模块图失效的根源）。
 */
export async function loadSizePresetProjectDefaults(
  root: string = process.cwd(),
): Promise<SizePresetTable> {
  const runtimeFile = path.join(root, SIZE_PRESET_PROJECT_DEFAULTS_RUNTIME_REL_PATH);
  /* 存量搬迁：旧版把「保存为项目默认」直接写进 src，遗留的用户态搬去新落点
   * （详见 defaults-legacy-migration.server —— 与编译快照一致时不迁移）。 */
  const migrated = await migrateLegacyDefaultsFile({
    srcFile: path.join(root, SIZE_PRESET_DEFAULTS_REL_PATH),
    runtimeFile,
    snapshot: DEFAULT_SIZE_PRESET_TABLE,
  });
  if (migrated) {
    logger.info(
      `[media] 已把旧版写进 src 的尺寸配置表项目默认迁到 data/size-preset-project-defaults.json` +
        "（src 里的那份回归编译源，遗留的工作树改动可 git checkout -- 收掉）",
    );
  }
  let raw: string;
  try {
    raw = await fs.readFile(runtimeFile, "utf8");
  } catch {
    /* 读不出来（没有 / 手改删了）：回落编译进包的那份快照。 */
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
