// ── 模型适配器的**项目默认**（跟代码走的那份基线，服务端层）──────────────
// 与「模式契约」的项目默认（`mode-contract.server.ts`）同一套手法（ISSUE #3951）：
//
//   · 基线落在**入库的** `src/lib/workshop/model-adapter-defaults.json`
//     （路径常量见 `model-adapter-defaults-path.ts`）——「模型适配」页点
//     「保存为项目默认（跟代码走）」写的就是它，提交后每个检出与每个桌包
//     都带这份基线；
//   · **开发检出里现读磁盘**：写完即生效、不必重启；桌包载荷里没有这份源码
//     ⇒ 回落编译进包的那份快照（静态 import）；
//   · 生效档 = 基线与 DB 存档**逐模式合并**（DB 同名模式压过基线；端点路径
//     DB 非空优先）—— 与模式契约「成品配置 → 本机覆盖逐模式压过」同一取向：
//     本机改过的模式照常生效，没改过的模式吃到基线。
//
// 带两个闸：只有开发检出可以写基线（正式包没有源码可写，调用本身就是错用 ——
// 大声失败，与 `saveModeContractsAsProjectDefaults` 同一句口径）；写文件走
// 原子写（tmp + rename），读侧不会撞到半截 JSON。

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import bundledModelAdapterDefaults from "./model-adapter-defaults.json";
import { MODEL_ADAPTER_DEFAULTS_REL_PATH } from "./model-adapter-defaults-path";
import { atomicWriteText } from "./atomic-write.server";
import { errorText } from "~/lib/error-message";
import { isDevCheckout } from "~/lib/shell/dev-checkout.server";
import { isRecord } from "~/lib/is-record";
import { parseRemoteModelAdaptersDoc, type RemoteModelAdaptersDoc } from "./remote-model-adapter";

/** 静态 import 进包的那份快照（桌包里没有源码文件可现读时的兜底）。 */
const bundled = parseModelAdapterDefaults(bundledModelAdapterDefaults);

/**
 * 归一化「项目默认」文件的形状：`{ version, models: { 模型名: 适配器存档 } }`。
 * 逐模型过 `parseRemoteModelAdaptersDoc`（坏条目丢弃、空适配器清单视为没配）；
 * 根本不是对象 / 没有 models ⇒ 空表 —— 坏文件不该把「内置适配器」整条打断。
 */
export function parseModelAdapterDefaults(raw: unknown): Record<string, RemoteModelAdaptersDoc> {
  const out: Record<string, RemoteModelAdaptersDoc> = {};
  if (!isRecord(raw) || !isRecord(raw.models)) {
    return out;
  }
  for (const [name, value] of Object.entries(raw.models)) {
    const doc = parseRemoteModelAdaptersDoc(value);
    if (doc.adapters.length === 0) {
      continue;
    }
    out[name] = doc;
  }
  return out;
}

/**
 * 现读磁盘上的项目默认（开发检出：写完即生效）；读不到 / 坏文件回落编译进包
 * 的那份快照。
 */
export async function readModelAdapterDefaultDocs(
  root: string = process.cwd(),
): Promise<Record<string, RemoteModelAdaptersDoc>> {
  const file = path.join(/*turbopackIgnore: true*/ root, MODEL_ADAPTER_DEFAULTS_REL_PATH);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return bundled;
  }
  try {
    const parsed = parseModelAdapterDefaults(JSON.parse(raw) as unknown);
    return Object.keys(parsed).length > 0 ? parsed : bundled;
  } catch {
    return bundled;
  }
}

/**
 * 生效档 = 项目默认（基线）与 DB 存档**逐模式合并**：基线打底、DB 同名模式
 * 压过；端点路径 DB 非空优先（它由「设置 → 远程模型」配置，本机存档说了算）。
 * 基线里没有这条模型 ⇒ 原样返回 DB 存档（多数模型走这一支，零合并成本）。
 */
export async function effectiveModelAdaptersDoc(
  name: string,
  dbDoc: RemoteModelAdaptersDoc,
  root: string = process.cwd(),
): Promise<RemoteModelAdaptersDoc> {
  const docs = await readModelAdapterDefaultDocs(root);
  const code = docs[name];
  if (code) {
    const byMode = new Map(code.adapters.map((a) => [a.mode, a]));
    for (const adapter of dbDoc.adapters) {
      byMode.set(adapter.mode, adapter);
    }
    return {
      endpointPath: dbDoc.endpointPath === "" ? code.endpointPath : dbDoc.endpointPath,
      adapters: [...byMode.values()],
    };
  }
  return dbDoc;
}

/**
 * 把「当前编辑的适配器」写进入库的项目默认（`MODEL_ADAPTER_DEFAULTS_REL_PATH`，
 * 跟代码走）。与既有条目**按模型合并**（只写这一条，其余模型原样保留）；
 * 写入前过 `parseRemoteModelAdaptersDoc` 归一化（与 DB 存档同一把尺）。
 *
 * 只有开发检出可以调：正式包没有源码可写，这格调用本身就是错用 —— 大声失败
 * （与 `saveModeContractsAsProjectDefaults` 同一句口径）。写完之后读取侧现读
 * 磁盘 ⇒ 不必重启进程即生效。
 *
 * @returns `doc` = 归一化后真正落盘的那份；`file` = 绝对路径；`relPath` =
 *   仓库相对路径（界面提示「写进了哪个文件」用，绝对路径不适合直接示人）。
 */
export async function saveModelAdaptersAsDefaults(
  name: string,
  doc: RemoteModelAdaptersDoc,
  root: string = process.cwd(),
): Promise<{ doc: RemoteModelAdaptersDoc; file: string; relPath: string }> {
  if (!isDevCheckout(root)) {
    throw new Error(
      "保存为项目默认只在开发检出可用（这份检出里没有 scripts/dev-launcher.mjs）——" +
        "正式包里的适配器改动请留在「保存适配器」（只落本机数据库）。",
    );
  }
  const normalized = parseRemoteModelAdaptersDoc(doc);
  const file = path.join(/*turbopackIgnore: true*/ root, MODEL_ADAPTER_DEFAULTS_REL_PATH);
  let existing: Record<string, RemoteModelAdaptersDoc> = {};
  try {
    existing = parseModelAdapterDefaults(JSON.parse(await fs.readFile(file, "utf8")) as unknown);
  } catch {
    // 文件不在 / 坏了都当「空基线」起写（首次保存走这一支）。
  }
  existing[name] = normalized;
  const text = `${JSON.stringify({ version: 1, models: existing }, null, 2)}\n`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteText(file, text);
  } catch (error) {
    throw new Error(errorText(error, `项目默认写入失败（${file}）`), { cause: error });
  }
  return { doc: normalized, file, relPath: MODEL_ADAPTER_DEFAULTS_REL_PATH };
}
