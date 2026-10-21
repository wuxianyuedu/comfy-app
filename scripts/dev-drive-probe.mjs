#!/usr/bin/env node
/**
 * 开发盘探测层：把「这台机器、这块卷现在到底是什么样」读成结构化数据。
 *
 * 分层的理由：探测（读机器）与判据（读数据下结论）会各自长，混在一个文件里
 * 就会出现「结论写在探测函数里」—— 那样改机器配置就会改结论。
 * 本文件只负责**读**，一条结论都不下；判据在 `scripts/dev-drive-tune.mjs`。
 *
 * 探测方式一律**实测**而不是查文档：微软的**块克隆**自 Windows 11 24H2 起
 * 只对**被指定为开发驱动器的卷**开放，普通 ReFS 卷探出来是「不支持」，
 * 而开发驱动器指定**只在格式化那一刻给**（既有卷无法就地转换）。
 * 只读文档会把这条差别讲反，所以这里用强制块克隆探一次来判定。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { pnpmInvocation } from "./launcher-core/shell.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ *
 * 类型定义（JSDoc）：本文件在 `checkJs` 下被类型检查，用例也从这里取类型
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} VolumeProbe
 * @property {string} root 卷根（Windows 形如 `G:\`）
 * @property {string | null} fsType 文件系统类型原文
 * @property {string | null} label 卷标
 * @property {string} category 归一后的类别（refs / ntfs / other / unknown）
 * @property {string} devDrive 开发驱动器指定状态
 * @property {string} devDriveLabel 给人看的状态说明
 * @property {boolean} defenderPerformanceMode 是否已走 Defender 性能模式
 * @property {string[]} filters 挂在这块卷上的文件系统筛选器（读不到就是空数组）
 * @property {boolean} filtersKnown 筛选器清单读到了没有
 */

/**
 * @typedef {object} CacheEntry
 * @property {string} envName
 * @property {string} path
 * @property {boolean} sameVolume
 * @property {string} suggestedSubPath
 */

/**
 * @typedef {object} WorkdirEntry
 * @property {string} name
 * @property {boolean} exists
 * @property {string} realPath
 * @property {boolean} sameVolume
 */

/**
 * @typedef {object} Capabilities
 * @property {boolean} hardlink
 * @property {boolean} blockClone 这块卷的复制是不是元数据级操作（靠比对物理簇判）
 * @property {boolean} blockCloneKnown 读到了物理簇吗（读不到就不判，不猜）
 * @property {boolean} libuvForceClone Node 的强制克隆标志能不能用（与卷无关，是 libuv 的事）
 * @property {boolean} sparse
 */

/**
 * @typedef {object} PnpmProbe
 * @property {string} storePath
 * @property {boolean} sameVolume
 * @property {string | null} importMethod
 */

/**
 * @typedef {object} DefenderProbe
 * @property {boolean} known 读到了没有（读不到就是 false，不猜）
 * @property {boolean | null} realTime 实时保护是不是开着
 * @property {string[]} exclusions 已配置的排除项
 * @property {boolean} performanceMode 是否走性能模式
 */

/**
 * @typedef {object} IndexMarking
 * @property {boolean} known 读到了没有（读不到就是 false，不猜）
 * @property {number} sampled 抽了多少个文件
 * @property {number} marked 其中带「不索引内容」标记的
 * @property {number | null} ratio 覆盖率
 */

/**
 * @typedef {object} ProbeReport
 * @property {string} repo
 * @property {NodeJS.Platform} platform
 * @property {VolumeProbe} volume
 * @property {Capabilities} capabilities
 * @property {PnpmProbe} pnpm
 * @property {Record<string, string | null>} git
 * @property {Record<string, CacheEntry | null>} cache
 * @property {DefenderProbe} defender
 * @property {IndexMarking} indexMarking
 * @property {WorkdirEntry[]} workdirs
 */

/* ------------------------------------------------------------------ *
 * 纯函数：卷与文件系统的判据
 * ------------------------------------------------------------------ */

/**
 * 取路径所在卷根（Windows 形如 `G:\`，POSIX 恒为 `/`）。
 * @param {string} target
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function volumeRootOf(target, platform = process.platform) {
  if (platform !== "win32") return "/";
  return path.win32.parse(path.resolve(target)).root.toUpperCase();
}

/**
 * 两个路径是否落在同一个卷上 —— 这一条决定 pnpm 能不能走硬链接零拷贝。
 * @param {string} a
 * @param {string} b
 * @param {NodeJS.Platform} [platform]
 * @returns {boolean}
 */
export function isSameVolume(a, b, platform = process.platform) {
  if (!a || !b) return false;
  return volumeRootOf(a, platform) === volumeRootOf(b, platform);
}

/**
 * 把文件系统类型归一成可比较的类别。
 * @param {string | null | undefined} fsType
 * @returns {"refs" | "ntfs" | "other" | "unknown"}
 */
export function classifyFilesystem(fsType) {
  const value = String(fsType ?? "")
    .trim()
    .toLowerCase();
  if (!value) return "unknown";
  if (value === "refs") return "refs";
  if (value === "ntfs") return "ntfs";
  return "other";
}

/* ------------------------------------------------------------------ *
 * 子进程与系统查询
 * ------------------------------------------------------------------ */

/**
 * 解码子进程输出：PowerShell 可能按本地代码页吐字节。
 * @param {Buffer | undefined} buffer
 * @returns {string}
 */
function decodeOutput(buffer) {
  if (!buffer || buffer.length === 0) return "";
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("gbk").decode(buffer);
  } catch {
    return utf8;
  }
}

/**
 * 跑一条外部命令，返回「跑完了没有 / 输出是什么」。
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, timeoutMs?: number }} [options]
 * @returns {{ ok: boolean, stdout: string, stderr: string, status: number | null, error: string | null }}
 */
function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "buffer",
    cwd: options.cwd,
    timeout: options.timeoutMs ?? 20_000,
    windowsHide: true,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: decodeOutput(result.stdout).trim(),
    stderr: decodeOutput(result.stderr).trim(),
    status: result.status,
    error: result.error ? result.error.message : null,
  };
}

/**
 * 跑一条 PowerShell 命令（Windows 侧读卷信息走它）。
 *
 * 导出它是为了让**别的**探测层复用同一条通道（实测层要读进程级 CPU 计数），
 * 而不是各写各的 PowerShell 启动方式 —— 通道不一致时，两边的读数就不可比。
 * @param {string} command
 * @param {NodeJS.Platform} [platform]
 * @returns {{ ok: boolean, stdout: string, stderr: string, status: number | null, error: string | null }}
 */
export function runPowerShell(command, platform = process.platform) {
  if (platform !== "win32") {
    return { ok: false, stdout: "", stderr: "", status: null, error: "非 Windows" };
  }
  const prefixed = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
  /**
   * @type {{ ok: boolean, stdout: string, stderr: string, status: number | null, error: string | null }}
   */
  let last = { ok: false, stdout: "", stderr: "", status: null, error: "没有可用的 PowerShell" };
  for (const shell of ["pwsh", "powershell.exe"]) {
    const result = runCommand(shell, ["-NoProfile", "-Command", prefixed]);
    if (!result.error) return result;
    last = result;
  }
  return last;
}

/**
 * 跑一条 `pnpm …` 命令：命令形态仍由唯一出口判定（规范 §2.1.1），但自己起进程、不回显。
 * @param {string[]} args
 * @param {NodeJS.Platform} [platform]
 * @returns {{ ok: boolean, stdout: string, stderr: string, status: number | null, error: string | null }}
 */
function runPnpm(args, platform = process.platform) {
  const invocation = pnpmInvocation(args, { env: process.env, platform, name: "pnpm" });
  if (!invocation) {
    return { ok: false, stdout: "", stderr: "PATH 上找不到可用的 pnpm", status: null, error: null };
  }
  return runCommand(invocation.command, invocation.args, { cwd: ROOT });
}

/* ------------------------------------------------------------------ *
 * 各项探测
 * ------------------------------------------------------------------ */

/**
 * 读检出所在卷的文件系统类型、卷标。
 * @param {NodeJS.Platform} platform
 * @returns {VolumeProbe}
 */
export function probeVolume(platform) {
  const root = volumeRootOf(ROOT, platform);
  if (platform !== "win32") {
    return {
      root,
      fsType: null,
      label: null,
      category: "other",
      devDrive: "na",
      devDriveLabel: "非 Windows",
      defenderPerformanceMode: false,
      filters: [],
      filtersKnown: false,
    };
  }
  const letter = root.replace(/[:\\]/g, "");
  // 首选 `DriveInfo`（.NET API：不依赖卷管理服务是否就绪，返回值也不受系统语言影响）；
  // 读不到再退回 `Get-Volume`（字段更多，但那条路依赖存储服务 —— 负载高时它会**偶发
  // 返回空**，踩过一次：卷类型读空，报告里跟着把「不是 ReFS」写成了结论）。
  let raw = "";
  const viaDriveInfo = runPowerShell(
    `$d = [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.Name -like '${letter}:*' } | Select-Object -First 1; ` +
      `if ($d) { "$($d.DriveFormat)|$($d.VolumeLabel)" } else { "|" }`,
    platform,
  );
  raw = String(viaDriveInfo.stdout ?? "").trim();
  if (!raw || raw === "|") {
    const viaGetVolume = runPowerShell(
      `$v = Get-Volume -DriveLetter ${letter} -ErrorAction SilentlyContinue; ` +
        `if ($v) { "$($v.FileSystemType)|$($v.FileSystemLabel)" } else { "|" }`,
      platform,
    );
    raw = String(viaGetVolume.stdout ?? "").trim();
  }
  const [fsType = "", label = ""] = raw.split("|");
  return {
    root,
    fsType: fsType || null,
    label: label || null,
    category: classifyFilesystem(fsType),
    devDrive: "unknown",
    devDriveLabel: "未知",
    defenderPerformanceMode: false,
    filters: [],
    filtersKnown: false,
  };
}

/**
 * 问系统这块卷是不是被指定成了开发驱动器（`fsutil` 需要管理员，问不到就记未知）。
 *
 * 输出是三段：① 这块卷是不是受信任的开发卷（一句话）；② 防病毒筛选器策略；
 * ③ **挂在这块卷上的筛选器清单**（逗号分隔，最后一行）。
 * 第 ③ 段也要读 —— 因为**Defender 的性能模式只对 Defender 生效**，
 * 第三方端点防护（联想安全中心之类）挂在开发卷上时，它并不吃那一套。
 * @param {VolumeProbe} volume
 * @param {NodeJS.Platform} platform
 * @returns {{ state: string, label: string, filters: string[], filtersKnown: boolean }}
 */
export function probeDevDrive(volume, platform) {
  const empty = { state: "unknown", label: "未知", filters: [], filtersKnown: false };
  if (platform !== "win32") {
    return { state: "na", label: "非 Windows", filters: [], filtersKnown: false };
  }
  const result = runCommand("fsutil", ["devdrv", "query", volume.root]);
  const text = `${result.stdout}\n${result.stderr}`;
  if (/access is denied|拒绝访问/i.test(text)) {
    return { ...empty, label: "未知（需要管理员才能查）" };
  }
  const filterMatch = text.match(/filters currently attached[^\n]*:\s*\r?\n\s*([^\r\n]+)/i);
  const filters = (filterMatch?.[1] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const filtersKnown = filterMatch !== null;
  if (!/developer volume/i.test(text)) {
    return { state: "no", label: "否（普通 ReFS 卷）", filters, filtersKnown };
  }
  const trusted = /trust/i.test(text) && !/untrusted|not trusted/i.test(text);
  return {
    state: "yes",
    label: trusted ? "是（受信任）" : "是（未标信任）",
    filters,
    filtersKnown,
  };
}

/**
 * 读一个文件的物理簇列表（`fsutil file queryextents`）。
 * 读不到就返回 null —— 那就「不判」，不拿别的信号顶替。
 * @param {string} file
 * @returns {string | null}
 */
function physicalClusters(file) {
  const result = runCommand("fsutil", ["file", "queryextents", file]);
  if (!result.ok) return null;
  const matches = [...result.stdout.matchAll(/LCN:\s*(0x[0-9a-f]+)/g)].map((m) => m[1]);
  return matches.length > 0 ? matches.join(",") : null;
}

/**
 * 硬链接 / 块克隆 / 稀疏文件：三项各探一次，探完即删。
 *
 * **块克隆怎么判**（这一条踩过一次坑，判据必须写清）：
 * 不能用 `fs.copyFileSync(..., COPYFILE_FICLONE_FORCE)` 的成败当判据 ——
 * 那测的是 **libuv 有没有实现强制克隆标志**（Windows 上它没实现，一律 ENOSYS），
 * **不是卷支不支持克隆**。Windows 11 24H2 起，受支持的复制操作（CopyFile 等）
 * 会**自动**走块克隆，所以要判的是「复制之后源与目标是不是同一批物理簇」。
 * @returns {Capabilities}
 */
export function probeCapabilities() {
  const result = {
    hardlink: false,
    blockClone: false,
    blockCloneKnown: false,
    libuvForceClone: false,
    sparse: false,
  };
  const scratch = path.join(ROOT, ".workbuddy", "dev-drive-probe");
  try {
    fs.mkdirSync(scratch, { recursive: true });
  } catch {
    return result;
  }
  const source = path.join(scratch, "source.bin");
  const clone = path.join(scratch, "clone.bin");
  const link = path.join(scratch, "link.bin");
  const sparse = path.join(scratch, "sparse.bin");
  try {
    fs.writeFileSync(source, Buffer.alloc(4 * 1024 * 1024, 1));

    try {
      fs.linkSync(source, link);
      result.hardlink = fs.statSync(link).ino === fs.statSync(source).ino;
    } catch {
      result.hardlink = false;
    }

    // 块克隆：普通复制一份，再比两者的物理簇 —— 相同即「复制没搬字节」。
    try {
      fs.copyFileSync(source, clone);
      const sourceClusters = physicalClusters(source);
      const cloneClusters = physicalClusters(clone);
      result.blockCloneKnown = sourceClusters !== null && cloneClusters !== null;
      result.blockClone = result.blockCloneKnown && sourceClusters === cloneClusters;
    } catch {
      result.blockCloneKnown = false;
      result.blockClone = false;
    }

    // 强制克隆标志：单独记一笔（它决定 pnpm 的 `package-import-method=clone` 能不能用）。
    try {
      fs.copyFileSync(source, clone, fs.constants.COPYFILE_FICLONE_FORCE);
      result.libuvForceClone = true;
    } catch {
      result.libuvForceClone = false;
    }

    try {
      fs.writeFileSync(sparse, Buffer.alloc(1024));
      fs.truncateSync(sparse, 512 * 1024 * 1024);
      const stat = fs.statSync(sparse);
      result.sparse = stat.blocks * 512 < stat.size / 2;
    } catch {
      result.sparse = false;
    }
  } catch {
    /* 探测失败就保持默认的「没有」 */
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return result;
}

/**
 * pnpm store 位置与导入方式。
 * @param {NodeJS.Platform} platform
 * @returns {PnpmProbe}
 */
export function probePnpmStore(platform) {
  const store = runPnpm(["store", "path"], platform);
  const lines = store.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const storePath = store.ok ? (lines[lines.length - 1] ?? "") : "";
  /** @type {string | null} */
  let importMethod = null;
  try {
    const workspaceConfig = fs.readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8");
    const matched = workspaceConfig.match(/^\s*package-import-method:\s*(\S+)/m);
    if (matched) importMethod = matched[1] ?? null;
  } catch {
    importMethod = null;
  }
  return {
    storePath,
    sameVolume: storePath ? isSameVolume(storePath, ROOT, platform) : false,
    importMethod,
  };
}

/**
 * 当前 git 的几项配置（仓库级）。
 * @returns {Record<string, string | null>}
 */
export function probeGitConfig() {
  /**
   * @param {string} key
   * @returns {string | null}
   */
  const read = (key) => {
    const result = runCommand("git", ["config", "--local", "--get", key]);
    return result.ok ? result.stdout : null;
  };
  return {
    untrackedCache: read("core.untrackedCache"),
    indexVersion: read("index.version"),
    commitGraph: read("core.commitGraph"),
  };
}

/**
 * 各缓存目录的落点。
 * @param {NodeJS.Platform} platform
 * @returns {Record<string, CacheEntry | null>}
 */
export function probeCacheLocations(platform) {
  const home = process.env.USERPROFILE ?? osHome();
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const entries = [
    {
      key: "temp",
      envName: "TEMP",
      value: process.env.TEMP,
      fallback: path.join(localAppData, "Temp"),
      sub: "Temp",
    },
    {
      key: "cargoHome",
      envName: "CARGO_HOME",
      value: process.env.CARGO_HOME,
      fallback: path.join(home, ".cargo"),
      sub: ".cargo",
    },
    {
      key: "playwright",
      envName: "PLAYWRIGHT_BROWSERS_PATH",
      value: process.env.PLAYWRIGHT_BROWSERS_PATH,
      fallback: path.join(localAppData, "ms-playwright"),
      sub: ".cache\\ms-playwright",
    },
    {
      key: "npmCache",
      envName: "npm_config_cache",
      value: process.env.npm_config_cache,
      fallback: path.join(localAppData, "npm-cache"),
      sub: ".npm-cache",
    },
  ];
  /** @type {Record<string, CacheEntry | null>} */
  const out = {};
  for (const entry of entries) {
    const target = entry.value || entry.fallback;
    out[entry.key] = target
      ? {
          envName: entry.envName,
          path: target,
          sameVolume: isSameVolume(target, ROOT, platform),
          suggestedSubPath: entry.sub,
        }
      : null;
  }
  return out;
}

/**
 * 构建与依赖目录的真实落点。
 * @param {NodeJS.Platform} platform
 * @returns {WorkdirEntry[]}
 */
export function probeWorkdirs(platform) {
  const names = ["node_modules", ".next", path.join("src-tauri", "target"), ".git"];
  return names.map((name) => {
    const target = path.join(ROOT, name);
    const exists = fs.existsSync(target);
    let realPath = target;
    if (exists) {
      try {
        realPath = fs.realpathSync(target);
      } catch {
        realPath = target;
      }
    }
    return {
      name,
      exists,
      realPath,
      sameVolume: exists ? isSameVolume(realPath, ROOT, platform) : true,
    };
  });
}

/**
 * 读 Defender 的实时保护状态与排除项（读不到就是读不到，不猜）。
 * @param {NodeJS.Platform} platform
 * @returns {DefenderProbe}
 */
export function probeDefender(platform) {  if (platform !== "win32") {
    return { known: false, realTime: null, exclusions: [], performanceMode: false };
  }
  const result = runPowerShell(
    "$p = Get-MpPreference -ErrorAction SilentlyContinue; " +
      "if ($p) { \"$($p.DisableRealtimeMonitoring)|$($p.ExclusionPath -join ';')\" } else { \"|\" }",
    platform,
  );
  const [flag = "", excluded = ""] = result.stdout.split("|");
  if (result.stdout === "" || (flag === "" && excluded === "")) {
    return { known: false, realTime: null, exclusions: [], performanceMode: false };
  }
  const exclusions = excluded
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    known: true,
    realTime: flag.trim() !== "True",
    exclusions,
    performanceMode: false,
  };
}

/**
 * 抽读「不索引内容」标记的覆盖率 —— 用来回答「这条标记到底生效没有」。
 *
 * 抽的是检出里的源码与文档两处（**不抽 `node_modules`**：它文件数占大头，
 * 抽到的多半是依赖而不是自己的东西）。读不到就记「不判」，不猜。
 * @param {NodeJS.Platform} platform
 * @returns {{ known: boolean, sampled: number, marked: number, ratio: number | null }}
 */
export function probeIndexMarking(platform) {
  const empty = { known: false, sampled: 0, marked: 0, ratio: null };
  if (platform !== "win32") return empty;
  const roots = [path.join(ROOT, "src"), path.join(ROOT, "docs")].filter((item) =>
    fs.existsSync(item),
  );
  if (roots.length === 0) return empty;
  const parts = roots.map(
    (item) =>
      `Get-ChildItem -LiteralPath '${item}' -Recurse -File -Force -ErrorAction SilentlyContinue`,
  );
  const result = runPowerShell(
    `$files = @(${parts.join("; ")}) | Select-Object -First 300; ` +
      `"$($files.Count)|$(@($files | Where-Object { $_.Attributes -band [IO.FileAttributes]::NotContentIndexed }).Count)"`,
    platform,
  );
  if (!result.ok) return empty;
  const [total = "", marked = ""] = result.stdout.split("|");
  const sampled = Number(total);
  const hits = Number(marked);
  if (!Number.isFinite(sampled) || !Number.isFinite(hits) || sampled === 0) {
    return empty;
  }
  return {
    known: true,
    sampled,
    marked: hits,
    ratio: Number((hits / sampled).toFixed(3)),
  };
}

/**
 * 用户主目录（拿不到就退到当前目录）。
 * @returns {string}
 */
function osHome() {
  return process.env.HOME ?? process.cwd();
}
