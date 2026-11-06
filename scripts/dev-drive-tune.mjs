#!/usr/bin/env node
/**
 * 开发盘（Windows Dev Drive / ReFS）红利探测与调优入口。
 *
 * 背景：仓库搬到 ReFS 卷之后，「卷是 ReFS」与「卷是 Dev Drive」是两件事。
 * 微软的**块克隆**自 Windows 11 24H2 起只对**被指定为开发驱动器的卷**开放，
 * 普通 ReFS 卷不暴露这个能力（实测强制块克隆返回 ENOSYS）。只读文档容易得出
 * 「搬到 ReFS 就吃到全部红利」的结论，因此本脚本**不靠文档下结论，一律实测**：
 * 硬链接、块克隆、稀疏文件三样各探一次，再据此出动作矩阵。
 *
 * 分层：探测（读机器）在 `scripts/dev-drive-probe.mjs`，I/O 实测（跑负载、归因 CPU）
 * 在 `scripts/dev-drive-bench.mjs`，判据（读数 → 动作矩阵）在
 * `scripts/dev-drive-levers.mjs`；本文件是**入口层**，只做命令行、渲染与落盘。
 * 职责边界（三条，缺一条就是越权）：
 *   1. 只做「探测 + 报告」；
 *   2. `--apply` 只落**仓库级、可逆**的调优（写 `.git/config`）；
 *   3. 需要管理员权限、或需要重格式化卷的动作**只打印命令、不代跑** ——
 *      那两类要么动全局安全策略，要么动数据，判定权在人。
 *
 * 跨平台：本文件是唯一实现（规范 §9.5），Windows 双击入口
 * `tools/start/tune-dev-drive.ps1` 只做「定位 → 转交 → 透传退出码」。
 */
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import {
  ROOT,
  classifyFilesystem,
  isSameVolume,
  probeCacheLocations,
  probeCapabilities,
  probeDefender,
  probeDevDrive,
  probeGitConfig,
  probeIndexMarking,
  probePnpmStore,
  probeVolume,
  probeWorkdirs,
  volumeRootOf,
} from "./dev-drive-probe.mjs";

import { runIoBench } from "./dev-drive-bench.mjs";

import { buildLevers, summarizeLevers } from "./dev-drive-levers.mjs";

export { classifyFilesystem, isSameVolume, volumeRootOf };
/* 判据层是本工具的对外契约面，契约测试从这里取「动作矩阵」的两端。 */
export { buildLevers, summarizeLevers };

/**
 * @typedef {import("./dev-drive-probe.mjs").ProbeReport} ProbeReport
 * @typedef {import("./dev-drive-levers.mjs").Lever} Lever
 * @typedef {import("./dev-drive-levers.mjs").LeverSummary} LeverSummary
 * @typedef {import("./dev-drive-levers.mjs").DevDriveReport} DevDriveReport
 */

/* ------------------------------------------------------------------ *
 * 纯函数区：可被契约测试直接引用（tests/dev-drive-tune.test.ts）
 * ------------------------------------------------------------------ */

/**
 * 解析命令行参数。
 * @param {string[]} argv
 * @returns {{ apply: boolean, json: boolean, check: boolean, bench: boolean }}
 */
export function parseArgs(argv) {
  const flags = { apply: false, json: false, check: false, bench: false };
  for (const raw of argv) {
    if (raw === "--apply") {
      flags.apply = true;
    } else if (raw === "--json") {
      flags.json = true;
    } else if (raw === "--check") {
      flags.check = true;
    } else if (raw === "--bench") {
      flags.bench = true;
    }
  }
  return flags;
}

/**
 * 把动作矩阵渲染成人读的文本。
 * @param {DevDriveReport} report
 * @returns {string}
 */
export function renderReport(report) {
  const lines = [];
  const mark = { ok: "✓", actionable: "!", blocked: "×", na: "-" };

  lines.push(`检出根：${report.repo}`);
  lines.push(
    `所在卷：${report.volume.root}  文件系统：${report.volume.fsType ?? "(未知)"}` +
      `  卷标：${report.volume.label ?? "(无)"}  Dev Drive 指定：${report.volume.devDriveLabel}`,
  );
  lines.push(
    `能力实测：硬链接 ${mark.ok} ｜ 块克隆 ${
      report.capabilities.blockCloneKnown
        ? report.capabilities.blockClone
          ? mark.ok
          : mark.blocked
        : "?"
    } ｜ 稀疏文件 ${report.capabilities.sparse ? mark.ok : mark.na}`,
  );
  lines.push("");
  lines.push("动作矩阵：");
  /* `DevDriveReport` 把 `levers` 写成可选（`buildLevers` 之前确实还没有这一格），`?? []`
   * 留给「报告还没算完就渲染」的调用点；`Lever` 的 `actions` 是必填，那层兜底不成立。
   * 状态位保留 `?? "?"` —— `mark` 只有四档，状态词表扩了要有归宿。 */
  for (const lever of report.levers ?? []) {
    /* 状态位不兜底：`mark` 的四档（ok / actionable / blocked / na）与 `LeverStatus`
     * 是同一份词表的两处写法，少一档是**编译期**就该发现的事，不该留一个运行期 `?`。 */
    lines.push(`  [${mark[lever.status]}] ${lever.id} — ${lever.title}`);
    lines.push(`      ${lever.detail}`);
    for (const action of lever.actions) {
      lines.push(`      → ${action.label}：${action.command}`);
    }
  }
  if (report.bench?.ran) {
    lines.push("");
    lines.push("I/O 实测明细（负载窗口内谁在吃 CPU）：");
    for (const target of report.bench.targets) {
      const top = target.cpuTop
        .slice(0, 5)
        .map((entry) => `${entry.name} ${entry.seconds}s`)
        .join(" ｜ ");
      lines.push(`  ${target.label}：${top || "(没有进程吃到 CPU)"}`);
      for (const watched of target.watched) {
        if (!watched.known) {
          lines.push(`      ${watched.filter}：认不出对应的引擎进程，不判`);
        } else if (watched.present) {
          lines.push(
            `      ${watched.filter} → ${watched.process}（${watched.label}）：在跑，CPU 增量 ${watched.seconds}s`,
          );
        } else {
          lines.push(`      ${watched.filter} → ${watched.process}（${watched.label}）：没在跑`);
        }
      }
    }
  }
  /** @type {LeverSummary} */
  const summary = report.summary ?? {
    ok: 0,
    actionable: 0,
    blocked: 0,
    na: 0,
    total: 0,
  };
  lines.push("");
  lines.push(
    `合计：就位 ${summary.ok} ｜ 待办 ${summary.actionable} ｜ ` +
      `受阻 ${summary.blocked} ｜ 无关 ${summary.na}`,
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * 落盘区（只在 `--apply` 下动作，且只动仓库级配置）
 * ------------------------------------------------------------------ */

/**
 * 把仓库级 git 调优落下去（可逆：改的是 `.git/config`）。
 * @param {ProbeReport["git"]} git 当前配置
 * @returns {string[]} 真正改了哪些键
 */
function applyGitTuning(git) {
  const wanted = [
    { key: "core.untrackedCache", value: "true", current: git.untrackedCache },
    { key: "index.version", value: "4", current: git.indexVersion },
    { key: "core.commitGraph", value: "true", current: git.commitGraph },
  ];
  const changed = [];
  for (const item of wanted) {
    if (item.current === item.value) {
      continue;
    }
    const result = runGitConfig(item.key, item.value);
    if (result) {
      changed.push(`${item.key}=${item.value}`);
    }
  }
  return changed;
}

/**
 * 写一条仓库级 git 配置（写不进去就返回 false，不假装成功）。
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
function runGitConfig(key, value) {
  const result = spawnSync("git", ["config", "--local", key, value], {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

/**
 * 采一遍全部读数。
 * @param {{ bench?: boolean }} [flags] 命令行开关（`--bench` 才跑实测）
 * @param {NodeJS.Platform} [platform]
 * @returns {DevDriveReport}
 */
function collectReport(flags = {}, platform = process.platform) {
  const volume = probeVolume(platform);
  const devDrive = probeDevDrive(volume, platform);
  volume.devDrive = devDrive.state;
  volume.devDriveLabel = devDrive.label;
  volume.filters = devDrive.filters;
  volume.filtersKnown = devDrive.filtersKnown;
  volume.defenderPerformanceMode = devDrive.state === "yes" && /受信任/.test(devDrive.label);
  const capabilities = probeCapabilities();
  const pnpm = probePnpmStore(platform);
  const git = probeGitConfig();
  const cache = probeCacheLocations(platform);
  const defender = probeDefender(platform);
  const indexMarking = probeIndexMarking(platform);
  const workdirs = probeWorkdirs(platform);
  const bench = flags.bench ? runIoBench({ filters: volume.filters, platform }) : null;
  /** @type {DevDriveReport} */
  const report = {
    repo: ROOT,
    platform,
    volume,
    capabilities,
    pnpm,
    git,
    cache,
    defender,
    indexMarking,
    workdirs,
    bench,
  };
  report.levers = buildLevers(report);
  report.summary = summarizeLevers(report.levers);
  return report;
}

/**
 * 入口主流程。
 * @param {string[]} argv
 * @returns {number} 退出码
 */
export function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  const report = collectReport(flags);

  if (flags.apply) {
    const changed = applyGitTuning(report.git);
    if (changed.length > 0) {
      process.stdout.write(`已落仓库级 git 调优：${changed.join("、")}\n`);
      report.git = probeGitConfig();
      report.levers = buildLevers(report);
      report.summary = summarizeLevers(report.levers);
    } else {
      process.stdout.write("仓库级 git 调优已经就位，无需改动。\n");
    }
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(report)}\n`);
    process.stdout.write(
      "\n本脚本只落仓库级配置；上面标「管理员」的动作需要你自己决定要不要做（脚本不代跑）。\n",
    );
  }

  if (
    flags.check &&
    ((report.summary?.actionable ?? 0) > 0 || (report.summary?.blocked ?? 0) > 0)
  ) {
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(main(process.argv.slice(2)));
}
