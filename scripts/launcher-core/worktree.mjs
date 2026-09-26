#!/usr/bin/env node
// `.next` 缓存策略与关键依赖完整性预检（跨平台启动编排用）。
//
// 指纹口径与 .ps1 版逐项对齐（规范 §7 缓存策略）：只覆盖**构建配置与依赖**
// （next.config.js / tsconfig.json / package.json / pnpm-lock.yaml），
// 源码（src/**）不进指纹 —— Turbopack 增量编译 + HMR 足够，把源码算进去会导致
// 「改一行 API 就清空 .next 全量重编译」。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// 两份 lockfile 的**实质**差异（唯一实现，与质量门禁 / diff-cli 同源）。
// 纯逻辑模块（无 IO、无副作用），静态 import 不带来平台或加载顺序问题。
import { diffLockfiles, isEmptyDiff } from "../lockfile/lock-diff.mjs";

/** 进指纹的文件（与 .ps1 的 $targets 同一份清单）。 */
export const FINGERPRINT_FILES = [
  "next.config.js",
  "tsconfig.json",
  "package.json",
  "pnpm-lock.yaml",
];

/** 关键依赖目录（「目录在但内容空」是 pnpm 中断安装的典型残骸）。 */
const KEY_DEPS = ["typescript", "@typescript/native", "next"];

/**
 * 关键配置指纹：逐文件 sha256 + 组合 hash，并保留逐文件明细。
 * @param {string} root
 * @returns {{ hash: string, files: Record<string, string> }}
 */
export function configFingerprint(root) {
  const combined = crypto.createHash("sha256");
  /** @type {Record<string, string>} */
  const files = {};
  for (const rel of FINGERPRINT_FILES) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const digest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(full))
      .digest("hex");
    files[rel] = digest;
    combined.update(`${rel}\u0000${digest}\u0000`);
  }
  return { hash: combined.digest("hex"), files };
}

/**
 * 按指纹决定是否清空 `.next`（FORCE_CLEAN=1 强制清、SKIP_CLEAN=1 强制留）。
 * @param {string} root
 * @param {Record<string, string | undefined>} env
 * @param {{ hash: string, files: Record<string, string> }} [fingerprint]
 * @returns {{ cleaned: boolean, reason: string }}
 */
export function syncNextCache(
  root,
  env,
  fingerprint = configFingerprint(root),
) {
  const nextDir = path.join(root, ".next");
  const hashFile = path.join(nextDir, "config-fingerprint");
  const filesFile = path.join(nextDir, "config-fingerprint-files.json");
  const writeMarks = () => {
    try {
      fs.writeFileSync(hashFile, fingerprint.hash, "utf8");
      fs.writeFileSync(filesFile, JSON.stringify(fingerprint.files), "utf8");
    } catch {
      /* 缓存标记写不进去最多导致下次全量重编译，不阻断启动 */
    }
  };
  /** @param {string} reason @returns {string} */
  const wipe = (reason) => {
    fs.rmSync(nextDir, { recursive: true, force: true });
    fs.mkdirSync(nextDir, { recursive: true });
    writeMarks();
    return reason;
  };

  if (env.FORCE_CLEAN === "1") {
    return { cleaned: fs.existsSync(nextDir), reason: wipe("FORCE_CLEAN=1") };
  }
  if (env.SKIP_CLEAN === "1") {
    return { cleaned: false, reason: "SKIP_CLEAN=1" };
  }
  if (!fs.existsSync(nextDir)) {
    fs.mkdirSync(nextDir, { recursive: true });
    writeMarks();
    return { cleaned: false, reason: "首次启动：写入初始指纹，执行全量编译" };
  }
  const saved = fs.existsSync(hashFile)
    ? fs.readFileSync(hashFile, "utf8").trim()
    : "";
  if (saved === fingerprint.hash) {
    return { cleaned: false, reason: "配置指纹未变，保留缓存" };
  }
  const changed = Object.keys(fingerprint.files).filter((rel) => {
    let previous = "";
    try {
      previous = JSON.parse(fs.readFileSync(filesFile, "utf8"))[rel] ?? "";
    } catch {
      previous = "";
    }
    return previous !== fingerprint.files[rel];
  });
  const detail = changed.length ? `：${changed.join("、")}` : "";
  return {
    cleaned: true,
    reason: wipe(
      `指纹变化 ${saved.slice(0, 12) || "(无)"} → ${fingerprint.hash.slice(0, 12)}${detail}`,
    ),
  };
}

/**
 * 找出「存在但为空 / 悬空」的关键依赖目录（空数组 = 健康）。
 *
 * 检查的是**链接目标的真实目录**：pnpm 布局下顶层依赖目录是指向 .pnpm store 的
 * 符号链接，对链接本身枚举在不同 Node 版本上不一致，健康安装也可能被误判成空。
 * @param {string} root
 * @returns {string[]}
 */
export function brokenKeyDeps(root) {
  const broken = [];
  for (const rel of KEY_DEPS) {
    const dir = path.join(root, "node_modules", rel);
    let real = null;
    try {
      real = fs.realpathSync(dir);
    } catch {
      broken.push(rel);
      continue;
    }
    try {
      if (!fs.statSync(real).isDirectory()) {
        broken.push(rel);
        continue;
      }
      if (fs.readdirSync(real).length === 0) broken.push(rel);
    } catch {
      broken.push(rel);
    }
  }
  return broken;
}

/**
 * node_modules 完整性预检（.modules.yaml + .bin/next + 关键依赖目录）。
 * @param {string} root
 * @returns {{ healthy: boolean, reasons: string[] }}
 */
export function checkNodeModules(root) {
  const reasons = [];
  if (!fs.existsSync(path.join(root, "node_modules", ".modules.yaml"))) {
    reasons.push("缺 .modules.yaml（依赖从未装好）");
  }
  const binDir = path.join(root, "node_modules", ".bin");
  let hasNext = false;
  try {
    hasNext = fs.readdirSync(binDir).some((name) => name.startsWith("next"));
  } catch {
    hasNext = false;
  }
  if (!hasNext) reasons.push("缺 node_modules/.bin/next");
  for (const dep of brokenKeyDeps(root)) {
    reasons.push(`关键依赖目录 node_modules/${dep} 为空或缺失`);
  }
  return { healthy: reasons.length === 0, reasons };
}

/**
 * 只保留最近 `keep` 份按次命名的日志（目录无限堆积会把磁盘与排查都拖垮）。
 * @param {string} dir
 * @param {string[]} prefixes
 * @param {number} [keep]
 */
export function pruneTimestampedLogs(dir, prefixes, keep = 5) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const prefix of prefixes) {
    const matches = entries
      .filter((name) => name.startsWith(prefix) && name.endsWith(".log"))
      .sort()
      .reverse();
    for (const stale of matches.slice(keep)) {
      try {
        fs.rmSync(path.join(dir, stale), { force: true });
      } catch {
        /* 删不掉不影响启动 */
      }
    }
  }
}

// ── 依赖与 lockfile 漂移（「拉了新代码但没重装依赖」）───────────────────────────
//
// 为什么必须判「漂移」而不是「装没装」：`node_modules` 的存在与「装的是不是当前
// lockfile」是两件事。拉了更新（新依赖进 lockfile）后没重装时，`.modules.yaml`
// 与 `.bin/next` 都在 → 被当成「已就绪」，而真正的新依赖缺席，报错落在**业务模块
// 解析失败**上，与「依赖没装」这句结论长得完全不一样。
//
// 判据：pnpm 会把**最近一次成功安装**用的 lockfile 复制到
// `node_modules/.pnpm/lock.yaml`。差异明细复用 `scripts/lockfile/lock-diff.mjs`
// （唯一实现，质量门禁同源）。

/**
 * lockfile 漂移判定。
 *
 * 判据是 `diffLockfiles()` 的**实质差异**（`isEmptyDiff`），**不是字节相等**：
 * pnpm 写进 `node_modules/.pnpm/lock.yaml` 的那份与仓库根那份必然不同形（少了
 * YAML 文档头 `---`、`settings:` 段落位置不同；实测干净安装后两份 12300 / 12142 行、
 * 首行就不同）。用哈希比对会让**每次启动都判成漂移并重装一遍** —— 正是本条要消灭的
 * 静默浪费；而实质性 diff 只看顶层字段 / importer 依赖 / packages / snapshots 的
 * 增删改，注释、空行、条目顺序都不算差异。
 *
 * @param {string} root
 * @returns {{ state: "fresh" | "no-install" | "no-lockfile" | "drift",
 *             modulesLock: string | null,
 *             diff?: import("../lockfile/lock-diff.d.mts").LockDiff | null }}
 */
export function lockfileDrift(root) {
  const repoLock = path.join(root, "pnpm-lock.yaml");
  const modulesLock = path.join(root, "node_modules", ".pnpm", "lock.yaml");
  if (!fs.existsSync(repoLock))
    return { state: "no-lockfile", modulesLock: null };
  if (!fs.existsSync(modulesLock))
    return { state: "no-install", modulesLock: null };

  /* 全量 diff 的短路缓存：每次启动都要解析两份 ~1.2 万行的 YAML（数百 ms），
   * 而两份文件的 (size, mtime) 都没变时结论不可能变 —— `pnpm install` 与
   * `git pull` 都必然触碰文件、mtime 必变，缓存自然失效。 */
  const repoStamp = stampOf(repoLock);
  const modulesStamp = stampOf(modulesLock);
  if (
    driftCache &&
    driftCache.repoStamp === repoStamp &&
    driftCache.modulesStamp === modulesStamp
  ) {
    return driftCache.result;
  }

  try {
    const diff = diffLockfiles(
      fs.readFileSync(modulesLock, "utf8"),
      fs.readFileSync(repoLock, "utf8"),
    );
    const result = {
      state: /** @type {"fresh" | "drift"} */ (
        isEmptyDiff(diff) ? "fresh" : "drift"
      ),
      modulesLock,
      diff,
    };
    driftCache = { repoStamp, modulesStamp, result };
    return result;
  } catch {
    return { state: "no-install", modulesLock: null };
  }
}

/** lockfile 漂移判定的短路缓存（键是两份文件的 size+mtime 指纹）。 */
/** @type {{ repoStamp: string | null, modulesStamp: string | null, result: { state: "fresh" | "no-install" | "no-lockfile" | "drift", modulesLock: string | null, diff?: import("../lockfile/lock-diff.d.mts").LockDiff | null } } | null} */
let driftCache = null;

/** 文件指纹：size + 毫秒级 mtime（读不到返回 null）。 */
/** @param {string} file @returns {string | null} */
function stampOf(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${Math.trunc(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

/** 「依赖真的可用」的复核入口：只认产物，不认退出码。
 *
 *  pnpm 在 postinstall / 目录写入失败时会给非零退出，但那不是唯一形态：
 *  `.modules.yaml` + 关键依赖目录 + 「安装时 lockfile 与仓库 lockfile 实质一致」
 *  才是「依赖真的可用」的最小充分条件（§9.2 第 4 条：判据不看退出码）。
 *
 * @param {string} root
 * @returns {{ ok: boolean, reason: string }}
 */
export function verifyInstall(root) {
  const modules = checkNodeModules(root);
  if (!modules.healthy)
    return { ok: false, reason: modules.reasons.join("；") };
  const drift = lockfileDrift(root);
  if (drift.state !== "fresh") {
    return {
      ok: false,
      reason:
        drift.state === "drift"
          ? "node_modules/.pnpm/lock.yaml 与仓库 pnpm-lock.yaml 仍不一致"
          : "拿不到安装时 lockfile（node_modules/.pnpm/lock.yaml）",
    };
  }
  return { ok: true, reason: "" };
}
