#!/usr/bin/env node
/**
 * package-desktop-portable.mjs — 把 `pnpm tauri build` 打出的**同一份载荷**组装成
 * 免安装版（portable）zip（ISSUE #3345）。
 *
 * ## 它补的是哪一格
 *
 * 现成的执行者已经负责「打出来」：`scripts/build-desktop.mjs` 组装 `src-tauri/static`
 * （Next standalone + 运行入口 + sidecar），`pnpm tauri build` 编出壳并打 nsis/msi
 * 安装包。GA 的桌包档此前只把 `bundle/` 整个传上去 —— 安装版与「免安装、解压即用」
 * 是两类分发形态，混在一个 artifact 里，下载的人得自己从一堆 exe 里挑。
 *
 * 本文件**只补组装那一格**：按打包器同布局把散在三个落点的产物收进一个目录，
 * 打成单个 zip，供上传格按名字分开取。它不构建、不重抄体积护栏、不改载荷一个字节。
 *
 * ## 布局为什么是这三件（规范 §7.6 的实测结论，不是推测）
 *
 * NSIS/MSI 装完之后那一层是 `ComfyAPP.exe` + `node.exe` + `static\**`，壳靠
 * `resource_dir()/static` 与 `resource_dir()/node.exe` 定位载荷。免安装版照这同一份
 * 布局落，双击 exe 即起内嵌 standalone server：目录里没有 `package.json` 与
 * `scripts/dev-launcher.mjs`，`ensure_launch_mode` 因此判 standalone（§1.5）。
 * §7.6 的「不装安装包的复演法」用的就是这同一份布局（在检出之外建目录、真双击验过）。
 *
 *   · 壳 exe：`src-tauri/target/release/app[.exe]`（名字由 `defaultShellExe` 判）
 *   · Node sidecar：`src-tauri/binaries/node-<triple>[.exe]` → 落包时改名为 `node[.exe]`
 *     （打包器剥掉三元组后缀，壳侧 `sidecar_binary_name()` 认的就是这个名字）
 *   · 载荷：`src-tauri/static/**` → 原样落 `static/**`
 *
 * ## 为什么「发现 sidecar」而不是重算目标三元组
 *
 * `build-desktop.mjs` 里的 `targetTriple()` 是私有、且那份模块 import 即执行整份构建
 * （没有 main guard），引不进来；在这里再写一份平台映射表就是 §12.12 的第二份实现，
 * 换平台时静默漂掉一边。本脚本改读 `binaries/` 里**本轮真实产出**的那个文件：
 * 它与打包器读的是同一份事实，不需要任何映射表。多于一个 = 没结论（要人清残留），
 * 一个都没有 = 缺件。
 *
 * ## 退出码（三态，与 publish-desktop-bundle.mjs 同口径）
 *
 *   · 0 组装完成。
 *   · 1 失败：缺件（壳 / sidecar / 载荷根的 server.js）/ 输出已存在 / 写盘被拒。
 *   · 2 **没有结论**：`binaries/` 里有多个 sidecar（分不清哪一个是本轮的）。
 *
 * ## 用法
 *
 *   node scripts/package-desktop-portable.mjs
 *   node scripts/package-desktop-portable.mjs --dry-run   # 只打印会做什么
 *   node scripts/package-desktop-portable.mjs --out <zip> --stage <dir>
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { defaultShellExe } from "./launcher-core/shell-ops.mjs";
import { zipDirectory } from "./launcher-core/run.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/** 免安装版的默认资产名（GA 用 --out 显式指定，这里只服务本地自查）。 */
export const PORTABLE_ASSET_NAME = "ComfyAPP-portable.zip";

/** stage 目录的默认落点（构建产物、不入库）。 */
const DEFAULT_STAGE_DIR = path.join("src-tauri", "target", "release", "portable-stage");

/** zip 的默认落点。 */
const DEFAULT_OUT_FILE = path.join("src-tauri", "target", "release", "bundle", PORTABLE_ASSET_NAME);

/**
 * 这一跑的输入。可被注入的只有「读盘 / 日志」这几面 —— 用例不该真往仓库产物
 * 目录写几百 MB，也不该因为某台机器上 cargo 的三元组不同就红。
 *
 * @typedef {{argv?: string[], cwd?: string, platform?: NodeJS.Platform,
 *   log?: (line: string) => void, readFileSync?: typeof fs.readFileSync,
 *   existsSync?: typeof fs.existsSync, readdirSync?: typeof fs.readdirSync,
 *   resolveShellExe?: (root: string) => string | null}} PortableIo
 */

/**
 * @typedef {{stageDir: string, outFile: string, dryRun: boolean,
 *   shellExe: string | null, sidecar: string | null, sidecarCount: number,
 *   sidecarName: string, staticDir: string, appVersion: string,
 *   existsSync: typeof fs.existsSync}} PortablePlan
 */

/** sidecar 落进包里叫什么：**按平台判据**，与 Rust 侧 `sidecar_binary_name()` 同源。 */
/** @param {NodeJS.Platform} [platform] @returns {string} */
export function nodeNameInPackage(platform = process.platform) {
  return platform === "win32" ? "node.exe" : "node";
}

/** `binaries/` 里哪些是本轮可能产出的 sidecar（形状，不认内容）。 */
/** @param {string} name @returns {boolean} */
function looksLikeSidecar(name) {
  // Tauri externalBin 的产物形状：node-<triple>[.exe]，triple 里可以有 - 但没有点。
  // 锚定结尾，别把 `other-node-…` 这类残留也算进来（那正是「多个 sidecar ⇒ 没结论」
  // 那一格要防的误判）。
  return /^node-[A-Za-z0-9_-]+(?:\.exe)?$/.test(name);
}

/**
 * 发现本轮产出的 sidecar。返回 0 个 / 1 个 / 多个，由调用方分三态处置 ——
 * 「多个」不许随手挑第一个（那会把别的平台的残留打进包）。
 *
 * @param {string} binDir @param {PortableIo["readdirSync"]} [readdir]
 * @returns {string[]} 文件名（字典序）
 */
export function findSidecars(binDir, readdir = fs.readdirSync, exists = fs.existsSync) {
  if (!exists(binDir)) {
    return [];
  }
  return readdir(binDir)
    .filter((name) => looksLikeSidecar(String(name)))
    .map(String)
    .sort((a, b) => a.localeCompare(b));
}

/** 从 package.json 读产品版本（只用于日志，不拼进资产名 —— 资产名要能滚动覆盖）。 */
/** @param {string} cwd @param {PortableIo["readFileSync"]} [read] @returns {string} */
function readAppVersion(cwd, read = fs.readFileSync) {
  try {
    const text = read(path.join(cwd, "package.json"), "utf8");
    return String(JSON.parse(String(text)).version ?? "") || "(读不到)";
  } catch {
    return "(读不到)";
  }
}

/**
 * 参数 → 计划（`--dry-run` 打印的就是它，落盘用的也是它 —— 同一份，不分两条路）。
 * @param {PortableIo} [io] @returns {PortablePlan}
 */
export function resolvePlan(io = {}) {
  const {
    argv = process.argv.slice(2),
    cwd = ROOT,
    platform = process.platform,
    existsSync: exists = fs.existsSync,
    readdirSync: readdir = fs.readdirSync,
    resolveShellExe = defaultShellExe,
  } = io;
  const flag = /** @param {string} name */ (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? "" : String(argv[i + 1] ?? "");
  };
  const binDir = path.join(cwd, "src-tauri", "binaries");
  const sidecars = findSidecars(binDir, readdir, exists);
  const only = sidecars.length === 1 ? sidecars[0] : undefined;
  return {
    stageDir: path.resolve(cwd, flag("--stage") || DEFAULT_STAGE_DIR),
    outFile: path.resolve(cwd, flag("--out") || DEFAULT_OUT_FILE),
    dryRun: new Set(argv).has("--dry-run"),
    shellExe: resolveShellExe(cwd),
    sidecar: only ? path.join(binDir, only) : null,
    sidecarCount: sidecars.length,
    sidecarName: nodeNameInPackage(platform),
    staticDir: path.join(cwd, "src-tauri", "static"),
    appVersion: readAppVersion(cwd, io.readFileSync),
    existsSync: exists,
  };
}

/**
 * 缺件检查：三件都在才组装。**不许静默跳过任何一件** —— 少 sidecar 或 server.js
 * 的包在用户机器上表现为「双击没反应」，而构建侧一句 warn 都没有。
 *
 * @param {PortablePlan} plan @returns {string[]} 缺件说明（空 = 齐）
 */
export function missingParts(plan) {
  /** @type {string[]} */
  const missing = [];
  if (!plan.shellExe || !plan.existsSync(plan.shellExe)) {
    missing.push("壳 exe（src-tauri/target/release/app[.exe]）");
  }
  if (!plan.sidecar || !plan.existsSync(plan.sidecar)) {
    missing.push(
      `Node sidecar（src-tauri/binaries/ 下应有且仅有一个 node-<triple>[.exe]，实得 ${plan.sidecarCount} 个）`,
    );
  }
  if (!plan.existsSync(path.join(plan.staticDir, "server.js"))) {
    missing.push(`standalone 载荷（${path.join(plan.staticDir, "server.js")}）`);
  }
  return missing;
}

/**
 * 主流程。
 * @param {PortableIo} [io] @returns {Promise<number>} 0 成功 / 1 失败 / 2 没有结论
 *   （zip 一步异步化后整体变 async，见 launcher-core/run.mjs `zipDirectory` 的 ISSUE #3369 注）
 */
export async function main(io = {}) {
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const plan = resolvePlan(io);
  log(`[免安装版] 版本 ${plan.appVersion} · 输出 ${plan.outFile}`);
  if (plan.sidecarCount > 1) {
    log(
      `[免安装版] **没有结论**：binaries/ 里有 ${plan.sidecarCount} 个 sidecar，分不清哪个是本轮的 —— 清掉残留再跑。`,
    );
    return 2;
  }
  const missing = missingParts(plan);
  if (missing.length > 0) {
    for (const item of missing) {
      log(`[免安装版] 缺件：${item}`);
    }
    log(
      "[免安装版] 失败：先跑 `pnpm tauri build`（它会经 beforeBuildCommand 装配载荷与 sidecar）。",
    );
    return 1;
  }
  if (fs.existsSync(plan.outFile)) {
    log(
      `[免安装版] 失败：输出已存在 ${plan.outFile} —— 不原地覆盖（覆盖会让「这一份是哪次构建的」只能靠 mtime 猜）。`,
    );
    return 1;
  }
  // 缺件检查已过 ⇒ 这两件此刻必然是 string。用守卫收窄，不做断言（lint 的
  // no-unsafe-type-assertion 会判「把 string|null 硬说成 string」为违规）。
  const shellExe = plan.shellExe;
  const sidecar = plan.sidecar;
  if (!shellExe || !sidecar) {
    log("[免安装版] 失败：缺件检查通过后仍取不到壳 / sidecar —— 没有结论，不组装。");
    return 1;
  }
  const shellName = path.basename(shellExe);
  log(`[免安装版] 三件齐：壳 ${shellExe} · sidecar ${sidecar} · 载荷 ${plan.staticDir}`);
  log(
    `[免安装版] 落包形态：${shellName} + ${plan.sidecarName} + static/**（打包器同布局，双击即用）`,
  );
  if (plan.dryRun) {
    log(`[免安装版] --dry-run：会把上面三件收进 ${plan.stageDir} 再打成 ${plan.outFile}。`);
    return 0;
  }
  // stage 是本次构建的中间态，不是别人的成品：已在场就整棵重来，不复用半成品。
  if (fs.existsSync(plan.stageDir)) {
    log(`[免安装版] stage 已在场，整棵重来（中间态，不含成品）：${plan.stageDir}`);
  }
  try {
    fs.rmSync(plan.stageDir, { recursive: true, force: true });

    fs.mkdirSync(path.join(plan.stageDir, "static"), { recursive: true });
    fs.copyFileSync(shellExe, path.join(plan.stageDir, shellName));
    fs.copyFileSync(sidecar, path.join(plan.stageDir, plan.sidecarName));
    fs.cpSync(plan.staticDir, path.join(plan.stageDir, "static"), {
      recursive: true,
      dereference: true,
    });
    await zipDirectory(plan.stageDir, plan.outFile);
  } catch (error) {
    fs.rmSync(plan.stageDir, { recursive: true, force: true });
    fs.rmSync(plan.outFile, { force: true });
    log(`[免安装版] 失败：写盘被拒 —— ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const bytes = fs.statSync(plan.outFile).size;
  log(`[免安装版] 完成：${plan.outFile}（${(bytes / 1024 ** 2).toFixed(1)} MiB）`);
  log(`[免安装版] 用法：解压到任意目录，双击 ${shellName} 即可（无需安装、无需 Node）。`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(await main());
}
