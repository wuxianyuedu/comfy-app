#!/usr/bin/env node
/**
 * 开发盘 I/O 实测层：跑一段**真实负载**，看两块卷谁更快、**谁在吃 CPU**。
 *
 * 为什么要单独一层：探测器只读机器状态，而「卷上挂了第三方过滤驱动」这件事
 * **推不出**「它在拖慢 I/O」—— 那要靠负载下的 CPU 归因才说得清。
 * 推测当结论会让「为了提速去改安全策略」这种不可逆操作失去依据，
 * 所以本文件只**测**，一条结论都不下；判据在 `scripts/dev-drive-tune.mjs`。
 *
 * 两段负载各测一块卷：开发卷（检出所在卷）与参考卷（系统临时目录所在卷）。
 * 同一段负载、同一份数据、同一个进程 —— 差值才是「卷 + 设备 + 筛选器栈」的综合差。
 *
 * ⚠️ 写盘：本次会真的写数据（默认每块卷几百 MB），跑完即删。
 * 开发卷那侧的临时目录在 `.workbuddy/` 下（已被忽略），参考卷那侧在系统临时目录。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

import { ROOT, runPowerShell, volumeRootOf } from "./dev-drive-probe.mjs";

/* ------------------------------------------------------------------ *
 * 类型定义（JSDoc）：本文件在 `checkJs` 下被类型检查
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} BenchTargetResult
 * @property {string} label 这一侧的名字（开发卷 / 参考卷）
 * @property {string} dir 落数据的目录
 * @property {number | null} bigWriteMbps 顺序写吞吐
 * @property {number | null} bigReadMbps 顺序读吞吐
 * @property {number | null} smallCreatePerSec 小文件创建速度
 * @property {number | null} smallReadPerSec 小文件读速度
 * @property {number} elapsedMs 这一侧的总耗时
 * @property {BenchCpuEntry[]} cpuTop 负载窗口内 CPU 消耗前几名
 * @property {BenchWatchEntry[]} watched 被点名盯着的进程（引擎进程）各自的 CPU 增量
 */

/**
 * @typedef {object} BenchCpuEntry
 * @property {string} name 进程名
 * @property {number} seconds 负载窗口内消耗的 CPU 秒
 */

/**
 * @typedef {object} BenchWatchEntry
 * @property {string} filter 卷上那个筛选器的名字
 * @property {string} process 对应的引擎进程名
 * @property {string} label 这个引擎是谁（给人看）
 * @property {boolean} present 负载窗口内这个进程在不在
 * @property {number} seconds 负载窗口内消耗的 CPU 秒
 * @property {boolean} known 这个筛选器认得出对应引擎吗
 */

/**
 * @typedef {object} BenchReport
 * @property {boolean} ran 跑成了吗
 * @property {string} note 跑不成 / 读不到时的那句话
 * @property {number} bigMB 顺序写与读的字节量（MB）
 * @property {number} smallCount 小文件个数
 * @property {BenchTargetResult[]} targets 每一侧的结果
 */

/**
 * @typedef {object} BenchCompare
 * @property {boolean} comparable 两侧数据齐不齐
 * @property {boolean | null} devFaster 开发卷是不是全面更快
 * @property {Record<string, number | null>} ratios 各项比值（开发卷 ÷ 参考卷）
 */

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

/** 默认负载：每块卷 256 MB 顺序写 + 256 MB 顺序读 + 1000 个 4 KB 小文件。 */
export const BENCH_DEFAULTS = { bigMB: 256, smallCount: 1000 };

/**
 * 已知「卷上的过滤驱动 ↔ 它在用户态的引擎进程」对照。
 *
 * 只收本机实测确认过的（`lnvscenter` 的驱动文件签名主体是火绒，用户态引擎
 * 是 `wsctrl11`）。**认不出来的不猜** —— 那一条会记成「未知」，
 * 由报告直接说「认不出哪个进程对应它」，而不是默认它没在干活。
 */
const ENGINE_PROCESS_HINTS = /** @type {Record<string, { process: string, label: string }>} */ ({
  wdfilter: { process: "MsMpEng", label: "Defender" },
  lnvscenter: { process: "wsctrl11", label: "联想 / 火绒" },
  qqpcmgr: { process: "QQPCRTP", label: "腾讯电脑管家" },
});

/* ------------------------------------------------------------------ *
 * 纯函数区（可被契约测试直接引用）
 * ------------------------------------------------------------------ */

/**
 * 取 CPU 消耗前几名（按消耗降序）。
 * @param {BenchCpuEntry[]} entries
 * @param {number} [limit]
 * @returns {BenchCpuEntry[]}
 */
export function topCpuConsumers(entries, limit = 6) {
  return [...entries].sort((a, b) => b.seconds - a.seconds).slice(0, limit);
}

/**
 * 把一侧的吞吐渲染成一行人读的文本。
 * @param {BenchTargetResult} entry
 * @returns {string}
 */
export function formatThroughput(entry) {
  const parts = [];
  if (entry.bigWriteMbps !== null) {
    parts.push(`顺序写 ${entry.bigWriteMbps} MB/s`);
  }
  if (entry.bigReadMbps !== null) {
    parts.push(`顺序读 ${entry.bigReadMbps} MB/s`);
  }
  if (entry.smallCreatePerSec !== null) {
    parts.push(`小文件创建 ${entry.smallCreatePerSec} 个/秒`);
  }
  if (entry.smallReadPerSec !== null) {
    parts.push(`小文件读 ${entry.smallReadPerSec} 个/秒`);
  }
  return parts.join(" ｜ ");
}

/**
 * 两块卷逐项比：比值是「开发卷 ÷ 参考卷」，大于 1 就是开发卷更快。
 *
 * 判据只用**实测到的项**：缺哪项就不比哪项，两侧数据都不齐时明说不可比。
 * @param {BenchTargetResult} dev
 * @param {BenchTargetResult | null} reference
 * @returns {BenchCompare}
 */
export function compareTargets(dev, reference) {
  /** @type {Record<string, number | null>} */
  const ratios = { bigWrite: null, bigRead: null, smallCreate: null, smallRead: null };
  if (!reference) {
    return { comparable: false, devFaster: null, ratios };
  }
  /**
   * @param {number | null} a
   * @param {number | null} b
   * @returns {number | null}
   */
  const ratio = (a, b) => (a !== null && b !== null && b > 0 ? Number((a / b).toFixed(2)) : null);
  ratios.bigWrite = ratio(dev.bigWriteMbps, reference.bigWriteMbps);
  ratios.bigRead = ratio(dev.bigReadMbps, reference.bigReadMbps);
  ratios.smallCreate = ratio(dev.smallCreatePerSec, reference.smallCreatePerSec);
  ratios.smallRead = ratio(dev.smallReadPerSec, reference.smallReadPerSec);
  /** @type {number[]} */
  const numbers = [];
  for (const value of Object.values(ratios)) {
    if (typeof value === "number") {
      numbers.push(value);
    }
  }
  if (numbers.length === 0) {
    return { comparable: false, devFaster: null, ratios };
  }
  return {
    comparable: true,
    devFaster: numbers.every((value) => value >= 1),
    ratios,
  };
}

/**
 * @typedef {object} EngineUsage
 * @property {"busy" | "idle" | "unknown"} state
 * @property {string} label 这个引擎是谁
 * @property {number} seconds 负载窗口内消耗的 CPU 秒
 * @property {string} process 引擎进程名
 */

/**
 * 某个第三方筛选器的引擎，在这次负载里到底干没干活。
 *
 * 三档，不合并：
 *   busy    引擎在跑且吃到了 CPU —— 它确实在扫，是真开销；
 *   idle    引擎在跑但 CPU 增量为 0（或压根没在跑）—— 它没在扫；
 *   unknown 认不出哪个进程对应这个筛选器 —— 不判，不猜。
 * @param {BenchReport | null} bench
 * @param {string[]} thirdPartyFilters
 * @returns {EngineUsage}
 */
export function thirdPartyEngineUsage(bench, thirdPartyFilters) {
  /** @type {EngineUsage} */
  const empty = { state: "unknown", label: "未知", seconds: 0, process: "" };
  if (!bench || !bench.ran) {
    return empty;
  }
  for (const target of bench.targets) {
    for (const watched of target.watched) {
      if (!thirdPartyFilters.some((name) => name.toLowerCase() === watched.filter.toLowerCase())) {
        continue;
      }
      if (!watched.known) {
        return { state: "unknown", label: watched.label, seconds: 0, process: watched.process };
      }
      if (!watched.present) {
        return { state: "idle", label: watched.label, seconds: 0, process: watched.process };
      }
      if (watched.seconds > 0) {
        return {
          state: "busy",
          label: watched.label,
          seconds: watched.seconds,
          process: watched.process,
        };
      }
      return { state: "idle", label: watched.label, seconds: 0, process: watched.process };
    }
  }
  return empty;
}

/* ------------------------------------------------------------------ *
 * 进程级 CPU 采样（Windows 性能计数器的原始累计值）
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} CpuSample
 * @property {number} pid
 * @property {string} name
 * @property {number} ticks 累计 CPU 时间（100 纳秒为单位）
 */

/**
 * 采一遍所有进程的 CPU 累计值。
 *
 * 用的是**原始累计计数**而不是百分比：百分比是拿累计值除以采样间隔算出来的，
 * 两次采样相减才是 CPU 秒 —— 直接比百分比会把「窗口长短」的误差算进来。
 * @param {NodeJS.Platform} platform
 * @returns {CpuSample[]}
 */
function snapshotCpu(platform) {
  const result = runPowerShell(
    "Get-CimInstance Win32_PerfRawData_PerfProc_Process | " +
      "Select-Object Name,IDProcess,PercentProcessorTime | ConvertTo-Json -Compress",
    platform,
  );
  if (!result.ok) {
    return [];
  }
  /** @type {CpuSample[]} */
  const out = [];
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return out;
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const name = typeof row.Name === "string" ? row.Name : null;
    const pid = Number(row.IDProcess);
    const ticks = Number(row.PercentProcessorTime);
    if (!name || !Number.isFinite(pid) || !Number.isFinite(ticks)) {
      continue;
    }
    out.push({ pid, name, ticks });
  }
  return out;
}

/**
 * 两次采样相减，得到每个进程在这段窗口里消耗的 CPU 秒。
 *
 * 「_Total」「Idle」是性能计数器自己的汇总实例，不是进程 —— 不排掉的话，
 * 榜首永远是那个汇总值，真进程被压在下面。
 * @param {CpuSample[]} before
 * @param {CpuSample[]} after
 * @returns {Map<string, number>} 进程名 → CPU 秒
 */
function diffCpu(before, after) {
  const beforeByPid = new Map(before.map((sample) => [sample.pid, sample.ticks]));
  /** @type {Map<string, number>} */
  const byName = new Map();
  for (const sample of after) {
    if (sample.name === "_Total" || sample.name === "Idle") {
      continue;
    }
    const previous = beforeByPid.get(sample.pid);
    if (previous === undefined) {
      continue;
    }
    const delta = sample.ticks - previous;
    if (delta <= 0) {
      continue;
    }
    byName.set(sample.name, (byName.get(sample.name) ?? 0) + delta);
  }
  return byName;
}

/**
 * 盯着的某个进程在这段窗口里消耗了多少 CPU（0 也是有效读数：它在跑，但没干活）。
 * @param {CpuSample[]} before
 * @param {CpuSample[]} after
 * @param {string} processName
 * @returns {{ present: boolean, seconds: number }}
 */
function watchProcess(before, after, processName) {
  const beforeByPid = new Map(before.map((sample) => [sample.pid, sample.ticks]));
  const wanted = processName.toLowerCase();
  let present = false;
  let ticks = 0;
  for (const sample of after) {
    if (sample.name.toLowerCase() !== wanted) {
      continue;
    }
    const previous = beforeByPid.get(sample.pid);
    if (previous === undefined) {
      continue;
    }
    present = true;
    const delta = sample.ticks - previous;
    if (delta > 0) {
      ticks += delta;
    }
  }
  return { present, seconds: Number((ticks / 1e7).toFixed(3)) };
}

/* ------------------------------------------------------------------ *
 * 负载
 * ------------------------------------------------------------------ */

/**
 * 在一块卷上跑一遍负载并测吞吐。
 * @param {string} dir 落数据的目录
 * @param {number} bigMB 顺序写与读的字节量（MB）
 * @param {number} smallCount 小文件个数
 * @returns {Omit<BenchTargetResult, "cpuTop" | "watched">}
 */
function measureTarget(dir, bigMB, smallCount) {
  const chunk = Buffer.allocUnsafe(1 << 20);
  for (let i = 0; i < chunk.length; i += 1) {
    chunk[i] = (i * 31) & 0xff;
  }
  const small = Buffer.allocUnsafe(4096);
  for (let i = 0; i < small.length; i += 1) {
    small[i] = (i * 17) & 0xff;
  }

  fs.mkdirSync(dir, { recursive: true });
  const bigFile = path.join(dir, "big.bin");
  const smallDir = path.join(dir, "small");
  fs.mkdirSync(smallDir, { recursive: true });

  const started = performance.now();
  const writeFd = fs.openSync(bigFile, "w");
  for (let i = 0; i < bigMB; i += 1) {
    fs.writeSync(writeFd, chunk);
  }
  fs.closeSync(writeFd);
  const writeMs = performance.now() - started;

  const readStarted = performance.now();
  const readFd = fs.openSync(bigFile, "r");
  const readBuffer = Buffer.allocUnsafe(1 << 20);
  let readBytes = 0;
  for (let i = 0; i < bigMB; i += 1) {
    readBytes += fs.readSync(readFd, readBuffer);
  }
  fs.closeSync(readFd);
  const readMs = performance.now() - readStarted;

  const createStarted = performance.now();
  for (let i = 0; i < smallCount; i += 1) {
    const fd = fs.openSync(path.join(smallDir, `f${i}.bin`), "w");
    fs.writeSync(fd, small);
    fs.closeSync(fd);
  }
  const createMs = performance.now() - createStarted;

  const smallReadStarted = performance.now();
  const smallBuffer = Buffer.allocUnsafe(4096);
  for (let i = 0; i < smallCount; i += 1) {
    const fd = fs.openSync(path.join(smallDir, `f${i}.bin`), "r");
    fs.readSync(fd, smallBuffer);
    fs.closeSync(fd);
  }
  const smallReadMs = performance.now() - smallReadStarted;

  return {
    label: "",
    dir,
    bigWriteMbps: Number((bigMB / (writeMs / 1000)).toFixed(1)),
    bigReadMbps: Number((readBytes / (1024 * 1024) / (readMs / 1000)).toFixed(1)),
    smallCreatePerSec: Math.round(smallCount / (createMs / 1000)),
    smallReadPerSec: Math.round(smallCount / (smallReadMs / 1000)),
    elapsedMs: Math.round(performance.now() - started),
  };
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

/**
 * 跑一次 I/O 实测。
 *
 * @param {object} [options]
 * @param {string} [options.devDir] 开发卷一侧的落数据目录
 * @param {string} [options.referenceDir] 参考卷一侧的落数据目录
 * @param {number} [options.bigMB] 顺序写与读的字节量（MB）
 * @param {number} [options.smallCount] 小文件个数
 * @param {string[]} [options.filters] 要点名的卷上筛选器（用来盯对应的引擎进程）
 * @param {NodeJS.Platform} [options.platform]
 * @returns {BenchReport}
 */
export function runIoBench(options = {}) {
  const platform = options.platform ?? process.platform;
  const bigMB = options.bigMB ?? BENCH_DEFAULTS.bigMB;
  const smallCount = options.smallCount ?? BENCH_DEFAULTS.smallCount;
  const devDir = options.devDir ?? path.join(ROOT, ".workbuddy", "dev-drive-bench");
  const referenceDir = options.referenceDir ?? path.join(os.tmpdir(), "dev-drive-bench");
  /** @type {BenchReport} */
  const report = {
    ran: false,
    note: "",
    bigMB,
    smallCount,
    targets: [],
  };

  const devRoot = volumeRootOf(devDir, platform);
  const referenceRoot = volumeRootOf(referenceDir, platform);
  const comparable = devRoot !== referenceRoot;

  /** @type {{ label: string, dir: string }[]} */
  const sides = [{ label: "开发卷", dir: devDir }];
  if (comparable) {
    sides.push({ label: "参考卷", dir: referenceDir });
  }

  try {
    for (const side of sides) {
      const before = snapshotCpu(platform);
      const measured = measureTarget(side.dir, bigMB, smallCount);
      const after = snapshotCpu(platform);
      const byName = diffCpu(before, after);
      const cpuTop = topCpuConsumers(
        [...byName.entries()].map(([name, ticks]) => ({
          name,
          seconds: Number((ticks / 1e7).toFixed(3)),
        })),
      );
      /** @type {BenchWatchEntry[]} */
      const watched = [];
      for (const filter of options.filters ?? []) {
        const hint = ENGINE_PROCESS_HINTS[filter.toLowerCase()];
        if (!hint) {
          watched.push({
            filter,
            process: "",
            label: "未知",
            present: false,
            seconds: 0,
            known: false,
          });
          continue;
        }
        const usage = watchProcess(before, after, hint.process);
        watched.push({
          filter,
          process: hint.process,
          label: hint.label,
          present: usage.present,
          seconds: usage.seconds,
          known: true,
        });
      }
      report.targets.push({
        ...measured,
        label: side.label,
        cpuTop,
        watched,
      });
    }
    report.ran = report.targets.length > 0;
    report.note = comparable
      ? "两段负载各测一块卷：同一段负载、同一份数据、同一个进程。"
      : "参考卷与开发卷在同一块卷上（多半是临时目录也被指到开发盘了）→ 不做对比，只给开发卷的读数。";
  } catch (error) {
    report.ran = false;
    report.note = `实测没跑成：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    for (const side of sides) {
      try {
        fs.rmSync(side.dir, { recursive: true, force: true });
      } catch {
        /* 临时数据删不掉就留着，不影响结论 */
      }
    }
  }
  return report;
}
