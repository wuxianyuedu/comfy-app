// ── 模型适配器的**项目默认**（服务端层）──────────────────────────────────
// 与「模式契约」的项目默认（`mode-contract.server.ts`）同一套手法（ISSUE #3951
// 建族；#4171 起写入落点迁出 src）：
//
//   · 编译进包的默认值 —— 入库的 `src/lib/workshop/model-adapter-defaults.json`
//     （静态 import 的那份快照 `bundled`）。**运行期不读也不写它**：写完即生效
//     的现读对象是本机项目默认覆盖（`data/`，见 `readModelAdapterDefaultDocs`）；
//   · 本机项目默认覆盖 —— 「模型适配」页点「保存为项目默认」写出来的那份
//     （`MODEL_ADAPTER_PROJECT_DEFAULTS_RUNTIME_REL_PATH`，不入库）。先于编译
//     快照生效，逐模型压过；文件里没有的模型回落编译快照；
//   · 生效档 = 项目默认（基线）与 DB 存档**逐模式合并**（DB 同名模式压过基线；
//     端点路径 DB 非空优先）—— 与模式契约「成品配置 → 本机覆盖逐模式压过」
//     同一取向：本机改过的模式照常生效，没改过的模式吃到基线。
//
// 带两个闸：只有开发检出可以写基线（正式包没有可写目标，调用本身就是错用 ——
// 大声失败，与 `saveModeContractsAsProjectDefaults` 同一句口径）；写文件走
// 原子写（tmp + rename），读侧不会撞到半截 JSON。

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import bundledModelAdapterDefaults from "./model-adapter-defaults.json";
import {
  MODEL_ADAPTER_DEFAULTS_REL_PATH,
  MODEL_ADAPTER_PROJECT_DEFAULTS_RUNTIME_REL_PATH,
} from "./model-adapter-defaults-path";
import { atomicWriteText } from "./atomic-write.server";
import { AsyncMutex } from "~/lib/async-mutex";
import { logger } from "~/lib/core/logger";
import { migrateLegacyDefaultsFile } from "~/lib/core/defaults-legacy-migration.server";
import { errorText } from "~/lib/error-message";
import { isDevCheckout } from "~/lib/shell/dev-checkout.server";
import { isRecord } from "~/lib/is-record";
import { parseRemoteModelAdaptersDoc, type RemoteModelAdaptersDoc } from "./remote-model-adapter";

/** 静态 import 进包的那份快照（编译期默认值；本机覆盖缺档时的逐模型兜底）。 */
const bundled = parseModelAdapterDefaults(bundledModelAdapterDefaults);

/** 项目默认覆盖文件的多个写方先进进程内互斥（#3911 同族纪律）：
 *  「读基线 → 合并 → 整份写回」这段跨 await 的读改写，并发交叠时后写者会用
 *  旧基线顶掉先写者（路由侧的按模型互斥罩不住跨模型的并发保存）。 */
const defaultsFileMutex = new AsyncMutex();

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

/** 读本机项目默认覆盖：不在 / 读不出来 / 坏文件 / 解析后为空 ⇒ null（回落快照）。 */
async function readRuntimeDocs(
  file: string,
): Promise<Record<string, RemoteModelAdaptersDoc> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = parseModelAdapterDefaults(JSON.parse(raw) as unknown);
    return Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 生效的项目默认基线：**先读本机项目默认覆盖**（`data/`，写完即生效、不必重启），
 * 逐模型压过编译进包的那份快照；覆盖不在 / 为空的模型回落快照 —— 后续 PR 往
 * 编译源新增的模型不会被本机旧副本遮住（与模式契约「缺的模式回落推导」同一取向）。
 *
 * 存量搬迁（ISSUE #4171）：#3951 ～ #4150 之间「保存为项目默认」直接写 src 那份
 * 编译源，遗留的用户态经 `migrateLegacyDefaultsFile` 搬去新落点 —— 与编译快照
 * 语义一致（即文件就是编译源本体、没有用户态）时**不迁移**，本机不钉住任何东西。
 */
export async function readModelAdapterDefaultDocs(
  root: string = process.cwd(),
): Promise<Record<string, RemoteModelAdaptersDoc>> {
  const runtimeFile = path.join(
    /*turbopackIgnore: true*/ root,
    MODEL_ADAPTER_PROJECT_DEFAULTS_RUNTIME_REL_PATH,
  );
  const migrated = await migrateLegacyDefaultsFile({
    srcFile: path.join(/*turbopackIgnore: true*/ root, MODEL_ADAPTER_DEFAULTS_REL_PATH),
    runtimeFile,
    /* 存量迁移的等值快照：编译源 JSON 的**原样 import**（与遗留文件同形同序）。
     * 不用上面的 `bundled` 当快照 —— 它过了归一化解析（丢空条目），与文件逐字
     * 对不上会把提交态误判成用户态、把基线钉在搬迁那一刻。 */
    snapshot: bundledModelAdapterDefaults,
  });
  if (migrated) {
    logger.info(
      `[workshop] 已把旧版写进 src 的模型适配器项目默认迁到 ${MODEL_ADAPTER_PROJECT_DEFAULTS_RUNTIME_REL_PATH}` +
        "（src 里的那份回归编译源，遗留的工作树改动可 git checkout -- 收掉）",
    );
  }
  const runtime = await readRuntimeDocs(runtimeFile);
  if (runtime === null) {
    return bundled;
  }
  const merged: Record<string, RemoteModelAdaptersDoc> = { ...bundled };
  for (const [name, doc] of Object.entries(runtime)) {
    merged[name] = doc;
  }
  return merged;
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
 * 把「当前编辑的适配器」写进**本机项目默认覆盖**（`data/`，ISSUE #4171）。
 * 与既有基线**按模型合并**（写的是整份基线：现读生效档打底、本次这一条压上，
 * 其余模型原样保留 —— 与 `saveModeContractsAsProjectDefaults` 同一取向）；
 * 写入前过 `parseRemoteModelAdaptersDoc` 归一化（与 DB 存档同一把尺）。
 *
 * 只有开发检出可以调：正式包没有可写目标（载荷里没有源码，也没有这个入口），
 * 这格调用本身就是错用 —— 大声失败（与 `saveModeContractsAsProjectDefaults`
 * 同一句口径）。#4171 起写入落点从 src 那份编译源改为本机运行时覆盖（不入库）
 * —— 要让改动进出厂默认，改 `src/lib/workshop/model-adapter-defaults.json`
 * 走 PR。写完之后读取侧现读运行时覆盖 ⇒ 不必重启进程即生效。
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
  const runtimeFile = path.join(
    /*turbopackIgnore: true*/ root,
    MODEL_ADAPTER_PROJECT_DEFAULTS_RUNTIME_REL_PATH,
  );
  return defaultsFileMutex.run(async () => {
    /* 整份基线落盘：现读生效档（本机覆盖优先、缺档回落编译快照）打底，
     * 本次这一条压上 —— 其余模型原样保留。 */
    const baseline = await readModelAdapterDefaultDocs(root);
    const merged: Record<string, RemoteModelAdaptersDoc> = { ...baseline, [name]: normalized };
    const text = `${JSON.stringify({ version: 1, models: merged }, null, 2)}\n`;
    try {
      await fs.mkdir(path.dirname(runtimeFile), { recursive: true });
      await atomicWriteText(runtimeFile, text);
    } catch (error) {
      throw new Error(errorText(error, `项目默认写入失败（${runtimeFile}）`), { cause: error });
    }
    return {
      doc: normalized,
      file: runtimeFile,
      relPath: MODEL_ADAPTER_PROJECT_DEFAULTS_RUNTIME_REL_PATH,
    };
  });
}
