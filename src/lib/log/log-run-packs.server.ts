/* ── 「运行包」的**服务端 IO**：列包里某一来源的启动日志（Node-only）────
 *
 * 纯判据在 `log-run-packs.ts`（不碰磁盘、能脱离文件系统单测）；这里只做两件
 * 必须碰磁盘的事：列 `runs/` 下的包、读每个包里该来源的份。分层理由见规范 18
 * §18.4 —— 判据要能脱离磁盘单测，而「哪一份属于哪次运行」只与名字有关。
 *
 * ## 路径不在本模块拼（§12.14 端点收口）
 *
 * `runs/` 的形态**只有一处定义**：`scripts/launcher-core/run.mjs` 的 `runsDir()`
 * （写方用它归档）。读方自己再拼一遍，两边一旦漂开，表现是「归档了但界面看不到」
 * —— 而两边各自都「看起来是对的」。因此调用方从 `run.mjs` 取路径传进来
 * （`GET /api/logs/sessions` 就是这么做的，与 `POST /api/logs/diagnostics` 复用
 * `exportDiagnostics()` 是同一手法）。本模块不 import 任何 `log/…` 字面量。
 *
 * ## 为什么按「包里有没有该来源的份」过滤
 *
 * 一台机器上 ComfyUI 可能一直没装（那几次运行根本没有 comfyui 的份），把它们列进
 * 下拉、用户点开每一项都是空窗口 —— 那不是历史，是噪声。判据就是文件在不在。
 *
 * `.zip` 形态的包（保留策略对超 32MB 的包先压再删）**不列**：读它要解压，而解压
 * 的入口在诊断包那一侧。列进来只会让下拉出现一堆点开就报错的项，因此明确不列。
 */

import fs from "node:fs";
import path from "node:path";

import { asRecord } from "~/lib/is-record";

import {
  formatFileTime,
  packNameToMs,
  sortPackNames,
  type PackLogFile,
  type RunPack,
} from "./log-run-packs";
import {
  compareRuntimeLogFiles,
  legacyRuntimeLogFileName,
  parseRuntimeLogFileName,
  type RuntimeLogSource,
} from "./runtime-log-file";

/** 列包时的参数（路径与文件名从布局常量来，不在本模块写死）。 */
export interface ScanRunPacksOptions {
  /** `runs/` 的绝对路径。 */
  runsDir: string;
  /** 该来源在包内的相对目录（如 `services`）。 */
  sourceDir: string;
  /** `run.json` 的文件名（从 `run.mjs` 的 `LOG_LAYOUT.runJson` 来）。 */
  runJsonName: string;
  /** 最多列几个包（更老的翻不到，列出来只是噪声）。 */
  maxPacks: number;
  /** 要列哪个来源的份。 */
  source: RuntimeLogSource;
}

/** 读一个包目录的 `run.json`（无 / 坏 → null，不让一个坏包把整个列表带崩）。 */
async function readPackMeta(
  dir: string,
  runJsonName: string,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await fs.promises.readFile(
      /*turbopackIgnore: true*/ path.join(dir, runJsonName),
      "utf8",
    );
    return asRecord(/* SAFETY: 类型断言已复核 */ JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** `run.json` 的 `startedAt`（ISO 串）→ 毫秒；缺失 / 读不出给 null。 */
function startedAtMs(meta: Record<string, unknown> | null): number | null {
  const raw = meta?.startedAt;
  if (typeof raw !== "string") return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 列一个包里某个来源的份（新→旧）。
 *
 * 复用 `runtime-log-file` 的解析与旧固定名判据 —— 包里的文件名形态与
 * `current/services/` 下**逐字同源**（归档是整目录复制），两边各写一套解析
 * 必然漂开，而漂开的表现是「某些包里的份从下拉里消失」。
 */
async function listPackSourceFiles(
  packDir: string,
  sourceDir: string,
  source: RuntimeLogSource,
): Promise<Array<PackLogFile>> {
  const dir = path.join(/*turbopackIgnore: true*/ packDir, sourceDir);
  let names: Array<string>;
  try {
    names = await fs.promises.readdir(/*turbopackIgnore: true*/ dir);
  } catch {
    return []; // 这一包没有该来源的目录：那次运行没启动过这个服务
  }
  const out: Array<PackLogFile> = [];
  for (const name of names) {
    if (!name.endsWith(".log")) continue;
    if (name === legacyRuntimeLogFileName(source)) {
      out.push({ name, startedAt: null, title: formatFileTime(null) });
      continue;
    }
    const parsed = parseRuntimeLogFileName(name);
    if (parsed?.source !== source) continue;
    out.push({
      name,
      startedAt: parsed.startedAt,
      title: formatFileTime(parsed.startedAt),
    });
  }
  /* 顺序的判据与 `current/` 那一侧**共用同一份**（`compareRuntimeLogFiles`）：
   * 两边各写一遍必然漂，而漂开的表现只是「某些项顺序不对」。 */
  return out.sort(compareRuntimeLogFiles);
}

/**
 * 列 `runs/` 下**有这个来源的份**的包（新→旧，各包内是新→旧）。
 *
 * 返回 `{ packs, total }`：`total` 是该来源跨包**一共有几份**（不受 `maxPacks`
 * 影响），界面据此说明「更早的不在列表里」（硬规则 4：必须有用户可见出口）。
 *
 * 异步（ISSUE #2193）：一次请求最多翻 `MAX_PACKS` 个包，同步写法是
 * 「一次 `readdir` + 每包一次 `readdir` + 每包一次 `readFileSync`」全压在事件
 * 循环上。**逐包顺序 await**（不是 `Promise.all`）—— 输出列表的顺序与
 * `sortPackNames` 的次序就是判据本身，并发完成顺序会把它打乱。
 */
export async function scanRunPacks(options: ScanRunPacksOptions): Promise<{
  packs: Array<RunPack>;
  total: number;
}> {
  const { runsDir, sourceDir, runJsonName, maxPacks, source } = options;
  let names: Array<string>;
  try {
    names = (
      await fs.promises.readdir(/*turbopackIgnore: true*/ runsDir, {
        withFileTypes: true,
      })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    /* runs/ 还不存在（第一次运行、或从没正常退出过）—— 空列表是对的，
     * 界面退化成「只有本次运行」。 */
    return { packs: [], total: 0 };
  }

  const packs: Array<RunPack> = [];
  let total = 0;
  for (const name of sortPackNames(names)) {
    const dir = path.join(/*turbopackIgnore: true*/ runsDir, name);
    const files = await listPackSourceFiles(dir, sourceDir, source);
    if (files.length === 0) continue;
    total += files.length;
    const meta = await readPackMeta(dir, runJsonName);
    packs.push({
      name,
      /* `run.json` 的更准（它是写进去的启动时刻）；读不到时退回名字里那个
       * —— 两者都是那次运行的启动时刻。 */
      startedAt: startedAtMs(meta) ?? packNameToMs(name),
      crashed: meta?.crashed === true,
      files,
    });
  }
  /* 名字升序 → 时间升序，取末尾 maxPacks 个 = 最新的几次，再倒成新→旧。 */
  return {
    packs: packs.slice(-Math.max(0, maxPacks)).reverse(),
    total,
  };
}
