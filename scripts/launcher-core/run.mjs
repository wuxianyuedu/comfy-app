#!/usr/bin/env node
// 「一次运行」的日志锚点：runId / run.json / current 目录 / 退出归档 / 保留 / 诊断包。
//
// 布局（规范 §4，改布局先读那里）：
//
//   log/
//   ├─ current/            进程**始终**写这里，路径固定不变
//   │  ├─ run.json         本次运行元信息（runId / 启动时刻 / 版本 / 分支 / commit / 参数 / 各 pid / 退出码 / 耗时）
//   │  ├─ launcher.log  nextjs.log  shell.log  tools.log
//   │  └─ services/  comfyui/
//   ├─ runs/<日期>_<时分秒>-<runId>/   退出时把 current/ 整个复制过来，一次一包
//   ├─ latest.txt          最近一次 runs 目录名
//   └─ exports/            诊断包落点（刻意**不在** current/ 下：否则归档会把它一趟趟搬进 runs/）
//
// 为什么 current/ 的路径写死、不在代码里拼时间戳目录：进程手里只持有一个
// 文件句柄，日志库一旦初始化就不好重配；而退出时改名/搬走那个目录，正在写的
// 句柄（老进程、被缓存的 fd）会指向一个不存在的路径 —— 早期日志静默丢失。
// 归档因此是「**复制**出去、再清空 current/ 里的内容」，目录本身留着。
//
// 崩溃来不及归档时由**下次启动补做**（recoverStaleCurrent），在 run.json 里
// 标 crashed: true / exitCode: null —— 用户报 bug 时一眼看得出这次没正常结束。

import fs from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

import { localTimestamp } from "./log.mjs";

/** 日志根下的固定名（改这里即改布局，别在别处拼这些字面量）。 */
export const LOG_LAYOUT = {
  /** 各进程始终写这里；退出时归档到 runs/。 */
  current: "current",
  /** 一次运行一个包。 */
  runs: "runs",
  /** 诊断包落点。 */
  exports: "exports",
  /** 最近一次 runs 目录名。 */
  latest: "latest.txt",
  /** 本次运行元信息。 */
  runJson: "run.json",
};

/** 保留策略（写死，见 Issue #1326）：runs/ 留最近 20 次**或** 7 天，任一满足即留。 */
export const RETENTION = {
  /** 最多留几包。 */
  maxRuns: 20,
  /** 最久留几天。 */
  maxAgeDays: 7,
  /** 单包超过这个字节数就压 zip 再删（日志压缩率通常 10:1 以上）。 */
  zipAboveBytes: 32 * 1024 * 1024,
  /** 诊断包带上最近几次运行。 */
  diagnosticsRuns: 3,
};

/** 日志根目录（<项目根>/log）。 */
/**
 * @param {string} root
 * @returns {string}
 */
export function logRoot(root) {
  return path.join(root, "log");
}

/** current/ 目录（进程始终写这里）。 */
/**
 * @param {string} root
 * @returns {string}
 */
export function currentDir(root) {
  return path.join(logRoot(root), LOG_LAYOUT.current);
}

/** runs/ 目录（一次一包）。 */
/**
 * @param {string} root
 * @returns {string}
 */
export function runsDir(root) {
  return path.join(logRoot(root), LOG_LAYOUT.runs);
}

/** 诊断包落点。 */
/**
 * @param {string} root
 * @returns {string}
 */
export function exportsDir(root) {
  return path.join(logRoot(root), LOG_LAYOUT.exports);
}

/** runId：随机 6 位小写十六进制（够短到能一眼读完，也够长到不重）。 */
/**
 * @returns {string}
 */
export function newRunId() {
  return Math.floor(Math.random() * 0x1000000)
    .toString(16)
    .padStart(6, "0");
}

/**
 * 归档目录名：`<日期>_<时分秒>-<runId>`（`2026-09-30_193612-a1b2c3`）。
 *
 * **不许带冒号**：Windows 下 `:` 是非法文件名字符，带它等于归档在 Windows 上
 * 直接失败（而失败是静默的，用户只看到 runs/ 空着）。这个格式同时保证
 * 字典序 = 时间序，`runs/` 直接 ls 就是时间线。
 * @param {Date} at 归档时刻
 * @param {string} runId 本次运行的 runId
 * @returns {string} 归档目录名
 */
export function runDirName(at, runId) {
  /** @param {number} n @param {number} [width] */
  const p = (n, width = 2) => String(n).padStart(width, "0");
  const date = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
  const time = `${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `${date}_${time}-${runId}`;
}

/**
 * 读 `HEAD` 得当前分支与 commit，**不 spawn git**。
 *
 * 进程崩在 git 起不来 / 慢的时候，这条元信息恰恰最该有；而为它去 spawn 一个
 * 子进程，会把「写启动日志」变成可能挂住的路径。`.git/HEAD` 是纯文本：
 * `ref: refs/heads/<branch>` 或裸 commit（detached HEAD）。
 * @param {string} root
 * @returns {{ branch: string | null, commit: string | null }}
 */
export function readGitHead(root) {
  try {
    const head = fs
      .readFileSync(path.join(root, ".git", "HEAD"), "utf8")
      .trim();
    if (!head.startsWith("ref:")) return { branch: null, commit: head || null };
    const ref = head.slice(4).trim();
    const branch = ref.replace(/^refs\/heads\//, "");
    try {
      const commit = fs
        .readFileSync(path.join(root, ".git", ref), "utf8")
        .trim();
      return { branch, commit: commit || null };
    } catch {
      return { branch, commit: null };
    }
  } catch {
    return { branch: null, commit: null };
  }
}

/** 应用版本（读 package.json；读不到就 null，不猜）。 */
/**
 * @param {string} root
 * @returns {string | null}
 */
export function readAppVersion(root) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * 建 current/ 并写 run.json —— **本次运行的第一件事**。
 *
 * 幂等：目录已存在时只覆盖 run.json、不动里面可能残留的旧日志（那些要么是同
 * 一次运行早先写的，要么是待 recoverStaleCurrent 收走的残留；这里都无权删）。
 * @param {string} root
 * @param {{ runId?: string, at?: Date, args?: string[], mode?: string, platform?: string }} [options]
 * @returns {{ runId: string, dir: string, runJson: string, startedAt: Date }}
 */
export function startRun(root, { runId = newRunId(), at = new Date(), args = [], mode = "", platform = process.platform } = {}) {
  const dir = currentDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const git = readGitHead(root);
  const meta = {
    runId,
    startedAt: at.toISOString(),
    startedAtLocal: localTimestamp(at),
    appVersion: readAppVersion(root),
    branch: git.branch,
    commit: git.commit,
    args,
    mode,
    platform,
    pids: {},
    endedAt: null,
    durationMs: null,
    exitCode: null,
    crashed: false,
  };
  const runJson = path.join(dir, LOG_LAYOUT.runJson);
  writeJson(runJson, meta);
  return { runId, dir, runJson, startedAt: at };
}

/** 原子写 JSON（先写临时文件再 rename；崩溃不会留下半截 run.json）。 */
/**
 * @param {string} file
 * @param {unknown} value
 */
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/** 读 run.json（无则 null）。 */
/**
 * @param {string} root
 * @returns {Record<string, unknown> | null}
 */
export function readRunJson(root) {
  return readRunJsonAt(currentDir(root));
}

/** 读指定目录下的 run.json（无 / 坏则 null）。 */
/**
 * @param {string} dir
 * @returns {Record<string, unknown> | null}
 */
export function readRunJsonAt(dir) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(dir, LOG_LAYOUT.runJson), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * 更新 current/run.json 的字段（读-改-写）。
 *
 * 合并而非替换：写方分散在各进程（编排器记 pid、壳记退出码），谁都不该持有
 * 全量快照。读不到就当作没有 —— 不去凭空造一份 run.json（那会掩盖
 * 「本次启动没走 startRun」这个真问题）。
 * @param {string} root
 * @param {Record<string, unknown>} patch
 */
export function patchRun(root, patch) {
  const file = path.join(currentDir(root), LOG_LAYOUT.runJson);
  const meta = readRunJson(root) ?? {};
  writeJson(file, { ...meta, ...patch });
}

/**
 * 记一个进程 pid（按用途命名，如 `nextjs` / `shell` / `comfyui`）。
 * @param {string} root
 * @param {string} name
 * @param {number | null} pid
 */
export function recordPid(root, name, pid) {
  const meta = readRunJson(root);
  if (!meta) return;
  const pids = { ...(/** @type {Record<string, number>} */ (meta.pids) ?? {}) };
  if (pid == null) delete pids[name];
  else pids[name] = pid;
  patchRun(root, { pids });
}

/** current/ 里除 run.json 外是否还有内容（判断是否值得归档）。 */
/**
 * @param {string} dir
 * @returns {boolean}
 */
export function hasCurrentContent(dir) {
  try {
    return fs
      .readdirSync(dir)
      .some((name) => name !== LOG_LAYOUT.runJson && !name.endsWith(".tmp"));
  } catch {
    return false;
  }
}

/** 递归复制目录（不跟符号链接；日志目录里不该有链接，跟了会走出日志根）。 */
/**
 * @param {string} from 源目录
 * @param {string} to 目标目录
 */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

/** 删 dir 下的内容，保留 dir 本身（进程手里的路径不能消失）。 */
/**
 * @param {string} dir
 */
function emptyDir(dir) {
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

/**
 * 归档：把 current/ 整个**复制**到 runs/<日期>_<时分秒>-<runId>/，再清空 current/。
 *
 * 结束时会把 run.json 补上 `endedAt` / `durationMs` / `exitCode` / `crashed:false`，
 * 让归档里的那份是**完整的**（否则翻历史时每包都要自己算耗时）。
 *
 * @param {string} root
 * @param {{ exitCode?: number | null, crashed?: boolean, at?: Date, touchLatest?: boolean }} [options]
 * @returns {string | null} 归档目录路径（没有可归档内容时返回 null）
 */
export function archiveCurrent(root, { exitCode = null, crashed = false, at = new Date(), touchLatest = true } = {}) {
  const cur = currentDir(root);
  if (!fs.existsSync(cur)) return null;
  const before = readRunJson(root);
  if (!before) return null;
  if (!hasCurrentContent(cur) && !crashed) {
    // 只有 run.json、且是正常结束：这次运行什么都没写，不留空包污染 runs/。
    emptyDir(cur);
    return null;
  }
  const runId = typeof before.runId === "string" ? before.runId : "unknown";
  const startedAt =
    typeof before.startedAt === "string" ? new Date(before.startedAt) : at;
  patchRun(root, {
    endedAt: at.toISOString(),
    durationMs: Math.max(0, at.getTime() - startedAt.getTime()),
    exitCode,
    crashed,
  });
  const runs = runsDir(root);
  fs.mkdirSync(runs, { recursive: true });
  const target = path.join(runs, runDirName(at, runId));
  copyTree(cur, target);
  emptyDir(cur);
  if (touchLatest) writeLatest(root, path.basename(target));
  return target;
}

/**
 * 写 `latest.txt`（最近一次 runs 目录名）。
 *
 * 崩溃补做时**不覆盖**：那条路径下最新的一包仍是上一次，把它改成崩溃那次的
 * 目录名反而让「最近一次正常完成的是谁」失真。
 * @param {string} root
 * @param {string} name
 */
export function writeLatest(root, name) {
  try {
    fs.mkdirSync(logRoot(root), { recursive: true });
    fs.writeFileSync(
      path.join(logRoot(root), LOG_LAYOUT.latest),
      `${name}\n`,
      "utf8",
    );
  } catch {
    /* 落盘失败不影响启动 */
  }
}

/** 读 latest.txt（无则 null）。 */
/**
 * @param {string} root
 * @returns {string | null}
 */
export function readLatest(root) {
  try {
    const text = fs
      .readFileSync(path.join(logRoot(root), LOG_LAYOUT.latest), "utf8")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * 崩溃补做：把上一次**来不及归档**的 current/ 收进 runs/。
 *
 * 判据是「current/ 里有内容」而不是「进程还在不在」：进程状态跨平台判不准，
 * 而遗留日志是不是该归档只看它有没有被正常收走。正常结束时 current/ 已被
 * 清空（只剩 run.json 也没有 extra 内容），所以这里读不出东西就什么都不做。
 *
 * `crashed: true` / `exitCode: null` 是给**用户报 bug 时看的**：翻到那一包
 * 就知道这次是崩的，不必再从日志末尾猜。
 * @param {string} root
 * @param {{ at?: Date }} [options]
 * @returns {string | null} 被收走的归档目录（无事可做返回 null）
 */
export function recoverStaleCurrent(root, { at = new Date() } = {}) {
  const cur = currentDir(root);
  if (!fs.existsSync(cur)) return null;
  if (!readRunJson(root)) return null;
  if (!hasCurrentContent(cur)) return null;
  const meta = readRunJson(root) ?? {};
  if (meta.endedAt) return null; // 已归档过（清空失败之类的边缘），不重复收
  // touchLatest: false —— 「最近一次」指的是最近一次**正常完成**的运行；
  // 崩溃补做把它改成崩溃那次的目录名，反而让这一栏失真（用户/我们翻它就是为了
  // 找「上一次好好结束的是哪一包」）。
  const target = archiveCurrent(root, {
    exitCode: null,
    crashed: true,
    at,
    touchLatest: false,
  });
  return target;
}

/** 列 runs/ 下的包（按目录名排序 = 时间序），返回 { name, dir, mtimeMs }。 */
/**
 * @param {string} root
 * @returns {{ name: string, dir: string, mtimeMs: number }[]}
 */
export function listRuns(root) {
  const runs = runsDir(root);
  try {
    return fs
      .readdirSync(runs, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.name.endsWith(".zip"))
      .map((e) => {
        const dir = path.join(runs, e.name);
        return { name: e.name, dir, mtimeMs: statMtime(dir) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** 取 mtime（拿不到时 0：排序退化成按名字，仍是时间序）。 */
/**
 * @param {string} p
 * @returns {number}
 */
function statMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** 整个目录的字节数（递归，不跟符号链接）。 */
/**
 * @param {string} dir
 * @returns {number}
 */
export function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else if (entry.isFile()) {
      try {
        total += fs.statSync(p).size;
      } catch {
        /* 竞态下文件消失：算 0 */
      }
    }
  }
  return total;
}

/**
 * 保留策略：runs/ 只留最近 20 次**或** 7 天内（任一满足即留），超出的直接删；
 * 单个包超过 32MB 的先压 zip 再删目录。
 *
 * 「或」而不是「且」是刻意的：只看次数时高频调试的机器上一天能攒 20 包、把
 * 一周前的现场挤掉；只看天数时低频用户的开机日志一直堆着。两个条件各管一头。
 *
 * **异步、失败静默**：这是启动路径上的清理，绝不该因为它把启动拖慢或弄挂
 * （调用方 `void pruneRuns(...)`）。
 * @param {string} root
 * @param {{ now?: number, delete?: (dir: string, name: string) => void }} [options]
 * @returns {Promise<{ kept: number, removed: number, zipped: number }>}
 */
export async function pruneRuns(root, { now = Date.now(), delete: del } = {}) {
  const runs = listRuns(root);
  const cutoff = now - RETENTION.maxAgeDays * 24 * 60 * 60 * 1000;
  const byAge = new Set(
    runs
      .slice()
      .sort((a, b) => b.name.localeCompare(a.name))
      .map((r) => r.name),
  );
  const recent = runs
    .slice()
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, RETENTION.maxRuns)
    .map((r) => r.name);
  const keep = new Set(recent);
  /** @type {string[]} */
  const drop = [];
  for (const run of runs) {
    // 「留」的两条通道：新近 20 包（keep）或 7 天内（mtime / 名字）不掉进 cutoff。
    // 名字前缀即日期，不必依赖 mtime —— 复制归档时 mtime 会跟着变。
    if (keep.has(run.name)) continue;
    if (run.mtimeMs >= cutoff) continue;
    drop.push(run.name);
  }
  let removed = 0;
  let zipped = 0;
  for (const name of drop) {
    const dir = path.join(runsDir(root), name);
    try {
      if (dirSize(dir) > RETENTION.zipAboveBytes && name.endsWith(".zip") === false) {
        await zipDirectory(dir, `${dir}.zip`);
        zipped++;
      }
      if (del) del(dir, name);
      else fs.rmSync(dir, { recursive: true, force: true });
      removed++;
    } catch {
      /* 单个包删不掉不该影响别的（文件被锁是常见情况） */
    }
  }
  // byAge 仅用于表达「两条通道都算留」，避免未来有人把它简化成单一条件；
  // 保留变量以免被误删。
  void byAge;
  return { kept: runs.length - removed, removed, zipped };
}

/**
 * 把目录打成 zip（自己写 zip 写入器，理由见文件头与 Issue #1326）。
 *
 * **不用系统 `zip`**：这台机器与 CI 容器都没有它，Windows 上只有 `tar.exe`
 * —— 而保留策略「压不了就整包删」恰恰在最需要它的机器上不生效，用户点
 * 「导出诊断包」那一下直接不可用。deflate 走 `node:zlib`，零新依赖。
 * @param {string} dir
 * @param {string} outFile
 * @returns {Promise<string>}
 */
export async function zipDirectory(dir, outFile) {
  const files = collectFiles(dir);
  const local = [];
  const central = [];
  let offset = 0;
  for (const rel of files) {
    const data = fs.readFileSync(path.join(dir, rel));
    const raw = deflateRawSync(data);
    // store 与 deflate 取更小的那个：已压缩内容（如 png）deflate 后可能更大。
    const useStore = raw.length >= data.length;
    const body = useStore ? data : raw;
    const nameBytes = Buffer.from(rel.split(path.sep).join("/"), "utf8");
    const crc = crc32(data);
    const { header, size } = localHeader({
      nameBytes,
      crc,
      compressSize: body.length,
      uncompressedSize: data.length,
      method: useStore ? 0 : 8,
    });
    local.push(header, body);
    central.push(
      centralHeader({
        nameBytes,
        crc,
        compressSize: body.length,
        uncompressedSize: data.length,
        method: useStore ? 0 : 8,
        offset,
      }),
    );
    offset += size + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const out = Buffer.concat([
    ...local,
    centralBuf,
    endOfCentral({ count: files.length, centralSize: centralBuf.length, centralOffset: offset }),
  ]);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
  return outFile;
}

/** 递归列出目录下所有文件（相对路径，字典序）。 */
/**
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {string[]}
 */
function collectFiles(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...collectFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** 本地文件头（30 字节固定段 + 文件名）。
 *  **compressSize 与 uncompressedSize 是两个字段**：store 模式下两者恰好相等，
 *  只写一个会让带压缩的路径露馅（解压端直接报 Bad CRC-32）。 */
/**
 * @param {{ nameBytes: Buffer, crc: number, compressSize: number, uncompressedSize: number, method: number }} p
 * @returns {{ header: Buffer, size: number }}
 */
function localHeader({ nameBytes, crc, compressSize, uncompressedSize, method }) {
  const size = 30 + nameBytes.length;
  const b = Buffer.alloc(size);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(20, 4); // version needed
  b.writeUInt16LE(0x0800, 6); // flags: UTF-8 文件名
  b.writeUInt16LE(method, 8);
  b.writeUInt16LE(0, 10); // mod time（不定：跨平台时区差异会让包不可复现）
  b.writeUInt16LE(0x21, 12); // mod date（1980-01-01，zip 纪元）
  b.writeUInt32LE(crc >>> 0, 14);
  b.writeUInt32LE(compressSize, 18);
  b.writeUInt32LE(uncompressedSize, 22);
  b.writeUInt16LE(nameBytes.length, 26);
  b.writeUInt16LE(0, 28); // extra len
  nameBytes.copy(b, 30);
  return { header: b, size };
}

/** 中央目录条目。 */
/**
 * @param {{ nameBytes: Buffer, crc: number, compressSize: number, uncompressedSize: number, method: number, offset: number }} p
 * @returns {Buffer}
 */
function centralHeader({ nameBytes, crc, compressSize, uncompressedSize, method, offset }) {
  const b = Buffer.alloc(46 + nameBytes.length);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(20, 4); // version made by
  b.writeUInt16LE(20, 6); // version needed
  b.writeUInt16LE(0x0800, 8);
  b.writeUInt16LE(method, 10);
  b.writeUInt16LE(0, 12);
  b.writeUInt16LE(0x21, 14);
  b.writeUInt32LE(crc >>> 0, 16);
  b.writeUInt32LE(compressSize, 20);
  b.writeUInt32LE(uncompressedSize, 24);
  b.writeUInt16LE(nameBytes.length, 28);
  b.writeUInt16LE(0, 30); // extra
  b.writeUInt16LE(0, 32); // comment
  b.writeUInt16LE(0, 34); // disk
  b.writeUInt16LE(0, 36); // internal attrs
  b.writeUInt32LE(0, 38); // external attrs
  b.writeUInt32LE(offset, 42);
  nameBytes.copy(b, 46);
  return b;
}

/** 中央目录结束记录。 */
/**
 * @param {{ count: number, centralSize: number, centralOffset: number }} p
 * @returns {Buffer}
 */
function endOfCentral({ count, centralSize, centralOffset }) {
  const b = Buffer.alloc(22);
  b.writeUInt32LE(0x06054b50, 0);
  b.writeUInt16LE(0, 4);
  b.writeUInt16LE(0, 6);
  b.writeUInt16LE(count, 8);
  b.writeUInt16LE(count, 10);
  b.writeUInt32LE(centralSize, 12);
  b.writeUInt32LE(centralOffset, 16);
  b.writeUInt16LE(0, 20);
  return b;
}

/** CRC-32（zip 用的那个多项式；Node 没有内置，20 行查表足够）。 */
/** @type {Int32Array | null} */
let crcTable = null;
/**
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c;
    }
  }
  let crc = -1;
  const table = crcTable;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ (table[(crc ^ (buf[i] ?? 0)) & 0xff] ?? 0);
  }
  return (crc ^ -1) >>> 0;
}

/**
 * 一键打包诊断：`current/` + 最近 3 次 `runs/` → `log/exports/diagnostics-<时间>-<runId>.zip`。
 *
 * 用户报 bug 时最需要的就是「一个文件发过来」，比让他截图/翻目录强太多。
 * 导出落点在 exports/ 而**不在** current/ 下：否则下一次归档会把它一趟趟
 * 搬进 runs/，包越滚越大。
 * @param {string} root
 * @param {{ at?: Date, runId?: string }} [options]
 * @returns {Promise<string>}
 */
export async function exportDiagnostics(root, { at = new Date(), runId } = {}) {
  const cur = currentDir(root);
  const meta = readRunJson(root);
  const id = runId ?? (typeof meta?.runId === "string" ? meta.runId : "unknown");
  // 时间戳与 runs 目录名同形（`<日期>_<时分秒>`，无冒号）：用户在 Windows 上
  // 打开 exports/ 时两个地方的名字读起来是同一套写法。
  const stamp = localTimestamp(at)
    .slice(0, 19)
    .replace(" ", "_")
    .replace(/:/g, "");
  const out = path.join(exportsDir(root), `diagnostics-${stamp}-${id}.zip`);
  // 先备一份到临时目录，再按「current/ + 最近几次 runs/」的目录结构打包，
  // 保证解压出来就是 log/ 的形状（用户/我们能直接对照规范 §4 读）。
  const stage = path.join(exportsDir(root), `.stage-${id}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  try {
    if (fs.existsSync(cur)) copyTree(cur, path.join(stage, LOG_LAYOUT.current));
    const recent = listRuns(root).slice(-RETENTION.diagnosticsRuns);
    for (const run of recent) {
      copyTree(run.dir, path.join(stage, LOG_LAYOUT.runs, run.name));
    }
    await zipDirectory(stage, out);
    return out;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
