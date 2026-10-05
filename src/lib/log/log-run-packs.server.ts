/* ── 「运行包」的**服务端** IO 部分（Node-only）─────────────────────────
 *
 * 纯判据在 `log-run-sessions.ts`（不碰磁盘、能脱离文件系统单测）；这里只做
 * 「目录里有什么、某个文件多长」这两件必须碰磁盘的事。分层理由与
 * `log-session-scope.ts` / `.server.ts` 同源（规范 18 §18.4）：
 * 读目录要 `node:fs`，而那一层的判据（哪一段属于哪次运行）与磁盘无关。
 *
 * ## 为什么路径不在这里拼（§12.14 端点收口）
 *
 * `runs/` 与 `current/` 的形态**只有一处定义**：`scripts/launcher-core/run.mjs`
 * 的 `LOG_LAYOUT` / `currentDir` / `runsDir`（写方用它归档，读方若自己再拼一遍，
 * 两边一旦漂开，表现是「归档了但界面看不到」——而两边各自都「看起来是对的」）。
 * 因此这里只接受调用方给的目录，不 import 任何 `log/…` 字面量。调用方
 * （`GET /api/logs/sessions`）从同一个模块取路径，与 `POST /api/logs/diagnostics`
 * 复用 `exportDiagnostics()` 是同一手法。
 */

import fs from "node:fs";
import path from "node:path";

import { asRecord } from "~/lib/is-record";
import { compareText } from "~/lib/ordered-set";

import type { RunPack } from "./log-run-sessions";

/** `run.json` 的文件名（与 `run.mjs` 的 `LOG_LAYOUT.runJson` 同源，调用方传值）。 */
export interface RunPackScanOptions {
  /** `runs/` 目录的绝对路径。 */
  runsDir: string;
  /** `runs/` 下某个包里，该来源日志文件相对包根的位置（如 `services/comfyui-runtime.log`）。 */
  sourceRelPath: string;
  /** `run.json` 的文件名（从布局常量来，不在本模块写死）。 */
  runJsonName: string;
  /** 最多列几个包（下拉上限；更老的翻不到，列出来只是噪声）。 */
  limit: number;
}

/** 读一个包目录的 `run.json`（无 / 坏 → null，不让一个坏包把整个列表带崩）。 */
function readPackMeta(
  dir: string,
  runJsonName: string,
): Record<string, unknown> | null {
  try {
    const text = fs.readFileSync(
      /*turbopackIgnore: true*/ path.join(dir, runJsonName),
      "utf8",
    );
    return asRecord(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** 把 `run.json` 的 `startedAt`（ISO 串）转毫秒；缺失 / 读不出给 null。 */
function startedAtMs(meta: Record<string, unknown> | null): number | null {
  const raw = meta?.startedAt;
  if (typeof raw !== "string") return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 列 `runs/` 下的运行包（新→旧），只保留**有这个来源文件**的包。
 *
 * 过滤掉没有该来源文件的包是必要的而不是优化：一台机器上 ComfyUI 可能一直没
 * 装（那几次运行根本没有 `comfyui-runtime.log`），把它们列进下拉，用户点开每
 * 一项看到的都是空窗口 —— 那不是「历史」，是噪声。判据就是文件在不在。
 *
 * `.zip` 形态的包（保留策略对超 32MB 的包先压再删）**不列**：读它需要解压，
 * 而那一层入口在 `log/exports`（诊断包）而不是这里。留在这里的后果是下拉里
 * 出现一堆点开就报错的项，因此宁可**明确不列**，并把这件事写进规范。
 */
export function scanRunPacks(options: RunPackScanOptions): RunPack[] {
  const { runsDir, sourceRelPath, runJsonName, limit } = options;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(/*turbopackIgnore: true*/ runsDir, {
      withFileTypes: true,
    });
  } catch {
    /* runs/ 还不存在（第一次运行、或从没正常退出过）—— 空列表是对的，
     * 界面退化成「只有本次运行」。 */
    return [];
  }

  const packs: RunPack[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(runsDir, entry.name);
    let size: number;
    try {
      size = fs.statSync(
        /*turbopackIgnore: true*/ path.join(dir, sourceRelPath),
      ).size;
    } catch {
      /* 这一包没有该来源的文件：本次运行没启动过这个服务，跳过。 */
      continue;
    }
    const meta = readPackMeta(dir, runJsonName);
    packs.push({
      name: entry.name,
      startedAt: startedAtMs(meta),
      crashed: meta?.crashed === true,
      hasSource: size >= 0,
    });
  }

  /* 名字排序 = 时间序（规范 §4.0 的设计），取**末尾** limit 个 = 最新的几次。
   * 比较器走 `~/lib/ordered-set` 的唯一出口（§16.2.4.57 P51）。 */
  packs.sort((a, b) => compareText(a.name, b.name));
  return packs.slice(-limit);
}

/** 某个包内该来源文件的字节数；不存在返回 null。 */
export function runPackSourceSize(
  runsDir: string,
  packName: string,
  sourceRelPath: string,
): number | null {
  try {
    return fs.statSync(
      /*turbopackIgnore: true*/ path.join(runsDir, packName, sourceRelPath),
    ).size;
  } catch {
    return null;
  }
}

/** 某个包前一份基准的字节数（按名字找紧邻的前一包）。 */
export function runPackBaselineSize(
  runsDir: string,
  packName: string,
  sourceRelPath: string,
): number | null {
  let entries: string[];
  try {
    entries = fs
      .readdirSync(/*turbopackIgnore: true*/ runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort(compareText);
  } catch {
    return null;
  }
  const index = entries.indexOf(packName);
  /* 该包是 `runs/` 里最早的一包（或不在列表里）→ 没有基准。**不去猜**
   * 一个基准（如「上一次的 mtime 附近的包」）：前缀关系只对**紧邻**的前一包
   * 成立，跳过几个包拿到的长度一定会把真实内容切掉。 */
  if (index <= 0) return null;
  const prev = entries[index - 1];
  if (prev === undefined) return null;
  return runPackSourceSize(runsDir, prev, sourceRelPath);
}
