#!/usr/bin/env node
// `.next` 缓存策略与关键依赖完整性预检（跨平台启动编排用）。
//
// 指纹口径与 .ps1 版逐项对齐（规范 §7 缓存策略）：只覆盖**构建配置与依赖**
// （next.config.js / tsconfig.json / package.json / pnpm-lock.yaml），
// 源码（src/**）不进指纹 —— Turbopack 增量编译 + HMR 足够，把源码算进去会导致
// 「改一行 API 就清空 .next 全量重编译」。

import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
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
 * 顶层必须**可解析**的依赖（ISSUE #1721）。
 *
 * 与 `KEY_DEPS` 的分工是两种病、两种动作：那边判「目录在不在、空不空」（安装中断的
 * 残骸），这边判「**声明了的东西解析得到吗**」—— 依赖树整体完好、`.modules.yaml` 与
 * `.bin/next` 都在、lockfile 与仓库那份**实质一致**，而某个包就是解析不到。
 *
 * 立案现场（axe-core）：本地 `node_modules` 停在**装它之前**的那套依赖树上 ——
 * `axe-core` 是后来新加的直接依赖，于是它只以**传递依赖**的旧版本（4.13.0）被
 * `@storybook/addon-a11y` 拖进来、落在**包自己的私有层**里，顶层既没有提升出来的
 * 那一份、也没有任何 `.pnpm` 目录树能解析到它。表现：
 *
 *   - `tsc --noEmit` / `eslint` 报 `Cannot find module 'axe-core'`（TS2307）——
 *     而这两条**都只信自己的 resolve**，所以只要它们真的跑起来就一定看得见；
 *     真正的问题是当时的环境里它们根本没跑（§13.6.3 那格的镜像）；
 *   - `check-deps-freshness.mjs` 的 ③ 与启动器的 lockfile 预检**判绿** ——
 *     它们比的是两份 lockfile 的**文本**，而文本里没有「谁解析得到」这一栏；
 *   - `brokenKeyDeps()` 也判绿 —— 它只点名 typescript / next，而那两个恰好没事，
 *     新加的那个包从来不在这份清单上。
 *
 * 所以这一档存在的理由不是「再判一遍依赖装没装」，而是：**上面那三条判据的取值口径
 * 里都没有「解析」这个维度**。判据自己的代价要付得起 —— 这几条是跑门禁时无论如何
 * 都要解析到的包，多解析一次不产生新的工作。
 *
 * 清单**只定义一次**：权威定义在 `docs/reference-facts.md` 的 `deps.resolveProbes`
 * 那一行（`scripts/doc-facts.cjs` 反向解析它），这里的字面量由
 * `tests/deps-freshness-gate.test.ts` 逐项核对 —— 两处各记一份必然分叉，而分叉之后
 * 「哪一份是真的」没有判据能回答（同 §18「白名单只定义一次」那条口径）。
 */
export const RESOLVE_PROBES = ["typescript", "next", "axe-core"];

/**
 * 逐个探测 `RESOLVE_PROBES` 在**仓库根**的解析结果（数组为空 = 全都能解析）。
 *
 * 解析用 `createRequire(<root>/package.json)` 显式定根，而不是 `import.meta.resolve`：
 * 后者从**本模块**出发，本模块在真实检出里落在 `scripts/launcher-core/`（能上溯到根
 * `node_modules`，结论碰巧一样），而契约测试把它拷进临时工作区后是否同层全看拷法 ——
 * 同一份判据在两种布局下给出不同答案，那不是判据、是运气。定根之后探针的语义才唯一：
 * **「在这个仓库根上 import 这个包」能不能解析**，与 `tsconfig` / eslint 看到的是同一个根。
 *
 * 探测**不做类型检查**：`tsc` 那条路要求包带类型声明，这里只问「模块在不在」。
 * 两者不等价（`@types/*` 在别的包上），但这一档要抓的是「压根解析不到」，
 * 不是「类型不全」——后者是 tsc 自己的活。
 *
 * @param {string} root
 * @returns {string[]} 解析不到的包名（保持 `RESOLVE_PROBES` 的顺序）
 */
export function unresolvableDeclaredDeps(root) {
  // 依赖从来没装过：`no-install` 那一态有专门的话术与动作，这里不抢答
  // （对着一棵不存在的树报「这几个包解析不到」是**准确的噪声**）。
  if (!fs.existsSync(path.join(root, "node_modules", ".modules.yaml"))) {
    return [];
  }
  let req;
  try {
    req = createRequire(path.join(root, "package.json"));
  } catch {
    return [];
  }
  const missing = [];
  for (const name of RESOLVE_PROBES) {
    try {
      req.resolve(`${name}/package.json`);
    } catch {
      missing.push(name);
    }
  }
  return missing;
}

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
    if (!fs.existsSync(full)) {
      continue;
    }
    const digest = crypto.hash("sha256", fs.readFileSync(full), "hex");
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
export function syncNextCache(root, env, fingerprint = configFingerprint(root)) {
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
  const saved = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8").trim() : "";
  if (saved === fingerprint.hash) {
    return { cleaned: false, reason: "配置指纹未变，保留缓存" };
  }
  const changed = Object.keys(fingerprint.files).filter((rel) => {
    let previous;
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
    let real;
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
      if (fs.readdirSync(real).length === 0) {
        broken.push(rel);
      }
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
  let hasNext;
  try {
    hasNext = fs.readdirSync(binDir).some((name) => name.startsWith("next"));
  } catch {
    hasNext = false;
  }
  if (!hasNext) {
    reasons.push("缺 node_modules/.bin/next");
  }
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
  let entries;
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

/** lockfile 漂移判定的短路缓存（键是两份文件的 size+mtime 指纹）。 */
/** @type {{ repoStamp: string | null, modulesStamp: string | null, result: { state: "fresh" | "no-install" | "no-lockfile" | "drift", modulesLock: string | null, diff?: import("../lockfile/lock-diff.d.mts").LockDiff | null } } | null} */
let driftCache = null;

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
  if (!fs.existsSync(repoLock)) {
    return { state: "no-lockfile", modulesLock: null };
  }
  if (!fs.existsSync(modulesLock)) {
    return { state: "no-install", modulesLock: null };
  }

  /* 全量 diff 的短路缓存：每次启动都要解析两份 ~1.2 万行的 YAML（数百 ms），
   * 而两份文件的 (size, mtime) 都没变时结论不可能变 —— `pnpm install` 与
   * `git pull` 都必然触碰文件、mtime 必变，缓存自然失效。 */
  const repoStamp = stampOf(repoLock);
  const modulesStamp = stampOf(modulesLock);
  if (
    driftCache?.repoStamp === repoStamp &&
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
      state: /** @type {"fresh" | "drift"} */ (isEmptyDiff(diff) ? "fresh" : "drift"),
      modulesLock,
      diff,
    };
    driftCache = { repoStamp, modulesStamp, result };
    return result;
  } catch {
    return { state: "no-install", modulesLock: null };
  }
}

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
  if (!modules.healthy) {
    return { ok: false, reason: modules.reasons.join("；") };
  }
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
