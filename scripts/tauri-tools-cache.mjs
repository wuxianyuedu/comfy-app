#!/usr/bin/env node
/**
 * tauri-tools-cache.mjs — 把 tauri bundler 的 **NSIS 工具**做成仓库里问得出的事实
 * （ISSUE #2525）。
 *
 * ## 它补的是哪一格（为什么不是「配个镜像」就完事）
 *
 * `pnpm tauri build` 的 nsis 那一格要**在构建期现下**两件 GitHub release 资产，而 bundler
 * 给下载留的预算实测在 **22–23s** 量级；本机直连取 `nsis-3.13.zip`（2,363,925 B）要 **48.4s**
 * —— 于是那一格的红与「这条链坏了」逐字同形，而真因是「这台机今天取不到工具」。
 * 前缀镜像（`TAURI_BUNDLER_TOOLS_GITHUB_MIRROR`）实测把 zip 压到 **29.5s**，
 * **仍然在那条预算之上** ⇒ 它降低概率，不是结案。
 *
 * 「把这台的缓存种好」又救不了节点：作业跑在 `orange-runner` 服务（**LocalSystem**）下，
 * 它的已知目录落在 systemprofile，普通会话进不去；而 bundler 走 `SHGetKnownFolderPath`，
 * **不读** `LOCALAPPDATA` 环境变量 —— 所以那个前提在仓库里根本读不到。
 *
 * 本文件把前提换成**能问出口的东西**：工具树按内容镜像在常驻根（`resolveToolRoot`，
 * 与两份缓存槽同卷的第四个目录 —— 它不是缓存，删了今天就没包），作业起手先补缓存，
 * 补不上就说「没有结论」并退非零。
 *
 * ## 三条动作（都不删任何东西）
 *
 * · `--seed`：从**本机那份 tauri 自己下好的缓存**把树种进常驻根，逐件记 sha256 + 字节。
 *   入场券是「那份缓存里必需件齐全」，不齐就退 2 —— 空手种一份残缺树比不种更坏。
 *   种的时候按**公开资产的哈希**核一次 `nsis_tauri_utils.dll`：核不过就不是那一件，
 *   不写进常驻根（这一条把「镜像被换过」和「版本升过没同步」分开，后者会安静地红在下一跑）。
 * · `--download`：没有「本机成功打过包」的前提时（GitHub hosted runner 那种即弃机），
 *   从**被钉死的两件公开资产**直接建常驻根镜像：下完先核 sha256 + 字节再落盘，
 *   树的整形照搬 bundler 自己的 `get_and_extract_nsis`（解 zip ⇒ 顶层 `nsis-<版本>/`
 *   改名 `NSIS/` ⇒ dll 落 `Plugins/x86-unicode/additional/`）。解 zip 走仓内既有的
 *   纯 Node `extractZipTo`（`ci-toolchain-browser-fetch.mjs`），不押 Windows 自带 bsdtar ——
 *   GitHub runner 的 `shell: bash` 是 Git Bash、里面的 `tar` 是 GNU tar、不读 zip（§7.7 同族
 *   结论）。传输 / 解压失败 ⇒ 退 2（没有结论，不静默降级）；哈希对不上 ⇒ 退 1。
 *   与 `actions/cache` 配套：workflow 把常驻根的镜像目录做成跨跑缓存，miss 那一跑
 *   付一次下载，后面全命中。
 * · 缺省（`ensure`）：必需件已在场 ⇒ 一个字都不动、退 0；不在场而常驻根里有 ⇒ 按清单拷过去
 *   并逐件复算哈希；两边都没有 ⇒ **退 2**，并把出口（本机跑一次 `--seed`）念出来。
 *
 * ## 版本升上去会怎样（这份镜像的维护边界）
 *
 * `NSIS_PLAN` 里的 `version` 与两件资产的哈希是**钉死的**：tauri 换了 NSIS 版本时
 * `ensure` 会判「常驻根里没有这一份」⇒ 退 2（不是装一个旧版本上去），
 * 于是红的是「镜像该跟着升」这句话，而不是「今天取不到工具」。同批改 `NSIS_PLAN` 是唯一出路。
 *
 * ## 用法
 *
 *   node scripts/tauri-tools-cache.mjs             # 补缓存（CI 那一格用的就是这条）
 *   node scripts/tauri-tools-cache.mjs --seed      # 本机成功打过包之后，把树种进常驻根
 *   node scripts/tauri-tools-cache.mjs --download  # 从被钉的公开资产直接建常驻根镜像（即弃机那一族）
 *   node scripts/tauri-tools-cache.mjs --dry-run   # 只打印会做什么
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { extractZipTo } from "./ci-toolchain-browser-fetch.mjs";
import { TOOLS_ROOT_ENV, resolveToolRoot } from "./ci-cache-slot.mjs";
import { runPnpmSync } from "./launcher-core/shell.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/**
 * 被钉住的那一份 NSIS 工具。
 *
 * 必需件清单不是凑数：bundler 判定「这份缓存完整吗」用的就是这一族路径，缺任何一件它会
 * **先把整个目录删掉再重下**（本机实测读到过那句 `NSIS directory is missing some files.
 * Recreating it.`）—— 所以「补齐」必须按它的清单补，少补一件等于白补。
 */
export const NSIS_PLAN = {
  name: "nsis",
  version: "3.13",
  /** tauri 自己的落点（相对 `%LOCALAPPDATA%\tauri`）。 */
  cacheRel: "NSIS",
  /**
   * 两件公开资产的 URL + 哈希（直连 GitHub 取到的原物，2026-10-27 本机实测；
   * URL 与 tauri bundler dev 分支源码里钉的逐字一致）。
   */
  assets: {
    zip: {
      sha256: "ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8",
      bytes: 2_363_925,
      url: "https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.13/nsis-3.13.zip",
    },
    dll: {
      sha256: "5ba143b5db4a87d32d6e7802e033330aae56cbceabe0d1e3ba41948385ad4709",
      bytes: 34_304,
      url: "https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll",
    },
  },
  /** dll 在缓存树里的落点（正斜杠写，比较时统一分隔符）。 */
  dllRel: "Plugins/x86-unicode/additional/nsis_tauri_utils.dll",
  required: [
    "NSIS.exe",
    "makensis.exe",
    "Include/MUI2.nsh",
    "Include/FileFunc.nsh",
    "Stubs/lzma_solid-x86-unicode",
    "Plugins/x86-unicode/additional/nsis_tauri_utils.dll",
  ],
};

/**
 * 那一份被钉住的东西的形状（`NSIS_PLAN` 的类型名，注入面与生产常量同源）。
 *
 * @typedef {typeof NSIS_PLAN} NsisPlan
 */

/** 常驻根里那份镜像的清单文件名（内容 = 逐件 `sha256` + 字节）。 */
export const TOOLS_MANIFEST_FILE = "manifest.json";

/** @param {string} file @returns {string} 该文件的 sha256（十六进制，小写） */
function sha256File(file) {
  return crypto.hash("sha256", fs.readFileSync(file), "hex");
}

/**
 * 「这台机的 tauri 缓存根」= 已知目录 `LOCALAPPDATA` 下的 `tauri`。
 *
 * 为什么读环境变量而不是调 Win32 已知目录 API：本文件跑在**作业自己的进程里**，
 * 那份环境就是作业看到的那份（LocalSystem 会话里它指向 systemprofile）——
 * 于是「补的地方」与「bundler 读的地方」同源。取不到时判「没有结论」，不猜一个路径。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{dir: string | null, from: string}}
 */
export function resolveTauriCacheRoot(env) {
  const local = String(env.LOCALAPPDATA ?? "").trim();
  if (local) {
    return { dir: path.join(local, "tauri"), from: "环境变量 LOCALAPPDATA" };
  }
  if (process.platform === "win32") {
    return { dir: null, from: "LOCALAPPDATA 无值 ⇒ 不猜已知目录（作业账号里它也该在）" };
  }
  /* 非 Windows：bundler 用的是 XDG 那套，这里只给一个能被验证的落点，不猜。 */
  const xdg = String(env.XDG_CACHE_HOME ?? "").trim();
  if (xdg) {
    return { dir: path.join(xdg, "tauri"), from: "环境变量 XDG_CACHE_HOME" };
  }
  return { dir: null, from: "既无 LOCALAPPDATA 也无 XDG_CACHE_HOME ⇒ 落点问不出来" };
}

/**
 * 递归列出一棵树里的文件（相对路径用正斜杠 —— 清单要跨机器可比）。
 *
 * @param {string} dir @returns {string[]}
 */
export function listTreeFiles(dir) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  /** @param {string} current @param {string} rel */
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const relPath = (rel ? `${rel}/` : "") + entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
    }
  };
  walk(dir, "");
  return out.sort();
}

/** @param {string} dir @param {string[]} rels @returns {string[]} 缺哪些（正斜杠写） */
export function missingRequired(dir, rels) {
  return rels.filter((rel) => !fs.existsSync(path.join(dir, ...rel.split("/"))));
}

/**
 * 镜像目录（`<工具根>/nsis/<版本>`）—— 不带时间戳，一份版本就一个目录，升版本即换目录。
 *
 * @param {string} toolRoot @param {NsisPlan} [plan] @returns {string}
 */
export function mirrorDir(toolRoot, plan = NSIS_PLAN) {
  return path.join(toolRoot, plan.name, plan.version);
}

/** @param {string} mirror @returns {{files: {path: string, sha256: string, bytes: number}[]} | null} */
function readMirrorManifest(mirror) {
  const file = path.join(mirror, TOOLS_MANIFEST_FILE);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed?.files) ? { files: parsed.files } : null;
  } catch {
    return null;
  }
}

/**
 * `--seed`：本机那份 tauri 下好的缓存 → 常驻根。
 *
 * `plan` 可换：用例要的是一份合成树（真件的哈希钉在生产常量里，夹具造不出来），
 * 生产那一跑走 `NSIS_PLAN`。
 *
 * @param {{cacheDir: string, mirror: string, dryRun: boolean, log: (line: string)=>void,
 *   plan?: NsisPlan}} io
 * @returns {number}
 */
export function seed({ cacheDir, mirror, dryRun, log, plan = NSIS_PLAN }) {
  const nsisRoot = path.join(cacheDir, plan.cacheRel);
  log(`[工具缓存] 种源：${nsisRoot}`);
  if (!fs.existsSync(nsisRoot)) {
    log(
      "[工具缓存] **没有结论**：本机没有 tauri 下好的 NSIS 缓存 ⇒ 没东西可种。\n" +
        "  出口是先在本机成功打一次包（`pnpm exec tauri bundle`，读数见规范 §7.7），" +
        "让 bundler 自己把那棵树建出来，再跑 `--seed`。",
    );
    return 2;
  }
  const missing = missingRequired(nsisRoot, plan.required);
  if (missing.length > 0) {
    log(
      `[工具缓存] **没有结论**：种源缺 ${missing.length} 件必需件（${missing.join(", ")}）` +
        " ⇒ 那本身就是一份被删过/没下完的树，种进常驻根等于把缺陷钉成事实。",
    );
    return 2;
  }
  /* 公开资产那一件按**哈希**认，认不过就不是它 —— 这一步是这份镜像的可信锚点：
   * 树里其余文件只能与「本机当时那份」自证一致，而 dll 有 GitHub 上的原物哈希可比。 */
  const dll = path.join(nsisRoot, ...plan.dllRel.split("/"));
  const dllHash = sha256File(dll);
  if (dllHash !== plan.assets.dll.sha256) {
    log(
      `[工具缓存] 失败：${plan.dllRel} 的 sha256 与被钉的那件对不上（读到 ${dllHash.slice(0, 12)}…）。` +
        " 两种可能：tauri 升了版本（⇒ 同批改 `NSIS_PLAN`），或这份缓存被换过内容。不种。",
    );
    return 1;
  }
  const files = listTreeFiles(nsisRoot).map((rel) => {
    const abs = path.join(nsisRoot, ...rel.split("/"));
    return {
      path: rel,
      sha256: sha256File(abs),
      bytes: fs.statSync(abs).size,
    };
  });
  const manifest = {
    name: plan.name,
    version: plan.version,
    seededAt: new Date().toISOString(),
    assetSha256: plan.assets,
    files,
  };
  log(
    `[工具缓存] 要种 ${files.length} 件·合计 ` +
      `${(files.reduce((s, f) => s + f.bytes, 0) / 1024 ** 2).toFixed(1)} MiB → ${mirror}`,
  );
  if (dryRun) {
    log("[工具缓存] --dry-run：不落盘。");
    return 0;
  }
  if (fs.existsSync(mirror)) {
    log(
      `[工具缓存] 失败：${mirror} 已经种过（同版本 = 同一份工具）。要重种请先把那一个目录移走 ——` +
        " 原地覆盖会让「常驻根里这份到底是哪一天的」没有可读的来源。",
    );
    return 1;
  }
  const staging = `${mirror}.staging`;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    for (const f of files) {
      const from = path.join(nsisRoot, ...f.path.split("/"));
      const to = path.join(staging, ...f.path.split("/"));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    fs.writeFileSync(
      path.join(staging, TOOLS_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    /* 整目录改名过去：常驻根里要么是没有这一份，要么是齐全的这一份，没有第三种。 */
    fs.mkdirSync(path.dirname(mirror), { recursive: true });
    fs.renameSync(staging, mirror);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    log(`[工具缓存] 失败：种盘被拒 —— ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  log(`[工具缓存] ✓ 已种 ${files.length} 件；作业里那一格从此不必现下。`);
  log(`[工具缓存]   清单 ${path.join(mirror, TOOLS_MANIFEST_FILE)}`);
  return 0;
}

/**
 * 缺省动作 `ensure`：让 bundler 那一棵树在作业里在场。
 *
 * @param {{cacheDir: string, toolRoot: string, toolRootFrom: string, dryRun: boolean,
 *   log: (line: string)=>void, plan?: NsisPlan}} io
 * @returns {number}
 */
export function ensure({ cacheDir, toolRoot, toolRootFrom, dryRun, log, plan = NSIS_PLAN }) {
  const nsisRoot = path.join(cacheDir, plan.cacheRel);
  const missing = missingRequired(nsisRoot, plan.required);
  log(`[工具缓存] bundler 落点：${nsisRoot}`);
  if (missing.length === 0) {
    log("[工具缓存] ✓ 必需件齐全 ⇒ 不动任何东西（这一跑不必现下）。");
    return 0;
  }
  log(`[工具缓存] 缺 ${missing.length} 件：${missing.join(", ")}`);
  const mirror = mirrorDir(toolRoot, plan);
  const manifest = readMirrorManifest(mirror);
  if (!manifest) {
    log(
      `[工具缓存] **没有结论**：常驻根里没有 ${plan.name} ${plan.version} 的镜像（${mirror}）。` +
        `\n  工具根来源：${toolRootFrom}（配 ${TOOLS_ROOT_ENV} 可显式给）。` +
        "\n  出口：在一台**已经成功打过包**的机器上跑一次 `node scripts/tauri-tools-cache.mjs --seed`。" +
        "\n  这一格**不降级**、也不让 bundler 去现下 —— 那条预算（22–23s）比这台机的正文吞吐（48.4s）短。",
    );
    return 2;
  }
  const total = manifest.files.reduce((s, f) => s + f.bytes, 0);
  log(
    `[工具缓存] 用镜像补：${mirror}·${manifest.files.length} 件·` +
      `${(total / 1024 ** 2).toFixed(1)} MiB`,
  );
  if (dryRun) {
    log("[工具缓存] --dry-run：不落盘。");
    return 0;
  }
  try {
    for (const f of manifest.files) {
      const from = path.join(mirror, ...f.path.split("/"));
      const to = path.join(nsisRoot, ...f.path.split("/"));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      const got = sha256File(to);
      if (got !== f.sha256) {
        log(
          `[工具缓存] 失败：拷过去之后 ${f.path} 的哈希与清单对不上（读到 ${got.slice(0, 12)}…，` +
            `清单 ${f.sha256.slice(0, 12)}…）—— 镜像坏了，不许留着半棵树让打包继续。`,
        );
        return 1;
      }
    }
  } catch (error) {
    log(`[工具缓存] 失败：补盘被拒 —— ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  log("[工具缓存] ✓ 已补齐，必需件在场。");
  return 0;
}

/**
 * 外部命令那一次调用的形状（`curl` / `tar`；测试注入假件的注入点）。
 *
 * @typedef {(cmd: string, args: string[]) => {status: number | null, stdout?: string, stderr?: string}} RunCmd
 */

/**
 * `--download`：从被钉死的两件公开资产**直接建**常驻根镜像（文件头「三条动作」）。
 *
 * 可信锚点与 `--seed` 同一条：下完先核 sha256 + 字节，核不过就不是那一件，宁可退 1
 * 也不写进常驻根。树的整形照搬 bundler 自己的 `get_and_extract_nsis`：解 zip ⇒ 顶层
 * 目录 `nsis-<版本>/` 改名 `NSIS/` ⇒ dll 落 `Plugins/x86-unicode/additional/`。
 * 下载用 `curl`（runner 自带），解 zip 用仓内既有的纯 Node `extractZipTo` —— 不押
 * `tar` 的平台形态（`shell: bash` 的 Git Bash 里是 GNU tar、不读 zip），也不引第三方依赖，
 * 保持 `main()` 的同步形态。用例经 `run` 注入假 `curl`/`tar` 的形状一字未改。
 *
 * 退码：传输 / 解压失败 ⇒ **2**（「今天取不到工具」是外部条件，不是判红，但**不静默
 * 降级** —— 让 bundler 去现下就是去撞那条 22–23s 的预算）；哈希 / 树形状与被钉的对不上
 * ⇒ **1**（红：资产变了 ⇒ 同批改 `NSIS_PLAN`）。
 *
 * @param {{mirror: string, dryRun: boolean, log: (line: string)=>void,
 *   run?: RunCmd, plan?: NsisPlan}} io
 * @returns {number}
 */
export function download({ mirror, dryRun, log, plan = NSIS_PLAN, run }) {
  /** @type {RunCmd} */
  const runCmd =
    run ??
    ((cmd, args) => {
      /* 解 zip 不押外部 `tar`：GitHub runner 的 `shell: bash` 是 Git Bash，`tar` 是 GNU tar、
       * 对 zip 逐字报「This does not look like a tar archive」（本机可复现，§7.7 同族结论）。
       * 改用仓内既有、带 zip-slip 防护的纯 Node 实现；`extractZipTo` 解出的顶层目录正是
       * `nsis-<版本>/`，与下面 `topDir` 的整形逐字对得上。`args` 形状仍是 `tar -xf <zip> -C <dir>`。 */
      if (cmd === "tar") {
        const zip = args[args.indexOf("-xf") + 1];
        const dest = args[args.indexOf("-C") + 1];
        if (!zip || !dest) {
          return { status: 2, stdout: "", stderr: `tar 参数形状不对：${args.join(" ")}` };
        }
        const failure = extractZipTo(zip, dest);
        return failure
          ? { status: 2, stdout: "", stderr: `extractZipTo: ${failure}` }
          : { status: 0, stdout: "", stderr: "" };
      }
      const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 300_000 });
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- 子进程起不来时 stdout/stderr 实测为 undefined（@types/node 声明偏窄）
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    });
  log(`[工具缓存] 下载建镜像：${plan.name} ${plan.version} → ${mirror}`);
  if (readMirrorManifest(mirror)) {
    log("[工具缓存] ✓ 镜像已在场（清单可读）⇒ 不动任何东西。");
    return 0;
  }
  if (fs.existsSync(mirror)) {
    /* 目录在而清单不可读 = 残缺镜像。与 --seed 同一条纪律：不覆盖（覆盖之后「常驻根里
     * 这份是哪一天的」没有可读的来源），念出人工出口。 */
    log(
      `[工具缓存] 失败：${mirror} 已存在但清单不可读 —— 那是一份残缺镜像，` +
        "先人工移走那一个目录再重跑，这一格不覆盖。",
    );
    return 1;
  }
  const zipAsset = plan.assets.zip;
  const dllAsset = plan.assets.dll;
  log(
    `[工具缓存] 两件被钉的资产：\n[工具缓存]   zip ${zipAsset.url}\n[工具缓存]   dll ${dllAsset.url}`,
  );
  if (dryRun) {
    log("[工具缓存] --dry-run：不落盘。");
    return 0;
  }
  const scratch = `${mirror}.staging`;
  /** 最终会成为 `mirror` 的那棵树（scratch 里还躺着 zip / dll 原文，落完一并清）。 */
  const tree = path.join(scratch, "tree");
  const zipFile = path.join(scratch, `${plan.name}.zip`);
  const dllFile = path.join(scratch, "nsis_tauri_utils.dll");
  /**
   * 交账出口：清掉暂存区（不许留半棵树）再念那句话。
   *
   * @param {number} code @param {string} line @returns {number}
   */
  const bail = (code, line) => {
    fs.rmSync(scratch, { recursive: true, force: true });
    log(line);
    return code;
  };
  /**
   * 下一件资产并核 sha256 + 字节。
   *
   * @param {{url: string, sha256: string, bytes: number}} asset @param {string} dest
   * @returns {number | null} null = 通过；否则是退码（已念出原因、已清暂存）
   */
  const fetchAsset = (asset, dest) => {
    const got = runCmd("curl", ["-fSL", "--retry", "3", "-o", dest, asset.url]);
    if (got.status !== 0) {
      return bail(
        2,
        `[工具缓存] **没有结论**：取不到 ${asset.url}（curl exit ${got.status}）` +
          `${got.stderr ? ` —— ${String(got.stderr).trim().slice(0, 200)}` : ""}。` +
          "传输层今天没跑起来，不静默降级。",
      );
    }
    const bytes = fs.statSync(dest).size;
    const sha = sha256File(dest);
    if (sha !== asset.sha256 || bytes !== asset.bytes) {
      return bail(
        1,
        `[工具缓存] 失败：${path.basename(dest)} 与被钉的那件对不上` +
          `（sha256 读到 ${sha.slice(0, 12)}… / 钉 ${asset.sha256.slice(0, 12)}…；` +
          `字节 ${bytes} / 钉 ${asset.bytes}）—— 资产变了或被换过，同批改 \`NSIS_PLAN\`，不落盘。`,
      );
    }
    return null;
  };
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  let bad = fetchAsset(zipAsset, zipFile);
  if (bad !== null) {
    return bad;
  }
  const untar = runCmd("tar", ["-xf", zipFile, "-C", scratch]);
  if (untar.status !== 0) {
    return bail(
      2,
      `[工具缓存] **没有结论**：解不开刚下载的 zip（tar exit ${untar.status}）—— 传输层 / 工具链今天没跑起来，不静默降级。`,
    );
  }
  /* 照搬 bundler 的整形：顶层目录是 `nsis-<版本>/`，改名成缓存树名（`NSIS`）。 */
  const topDir = path.join(scratch, `${plan.name}-${plan.version}`);
  if (!fs.existsSync(topDir)) {
    return bail(
      1,
      `[工具缓存] 失败：zip 顶层目录不是 ${plan.name}-${plan.version}（资产形状与被钉的对不上 ⇒ 同批改 \`NSIS_PLAN\`）。`,
    );
  }
  fs.renameSync(topDir, tree);
  bad = fetchAsset(dllAsset, dllFile);
  if (bad !== null) {
    return bad;
  }
  const dllDest = path.join(tree, ...plan.dllRel.split("/"));
  fs.mkdirSync(path.dirname(dllDest), { recursive: true });
  fs.renameSync(dllFile, dllDest);
  const missing = missingRequired(tree, plan.required);
  if (missing.length > 0) {
    return bail(
      1,
      `[工具缓存] 失败：解出来的树缺 ${missing.length} 件必需件（${missing.join(", ")}）` +
        " —— 资产形状与被钉的对不上，同批改 `NSIS_PLAN`，不落盘。",
    );
  }
  const files = listTreeFiles(tree).map((rel) => {
    const abs = path.join(tree, ...rel.split("/"));
    return { path: rel, sha256: sha256File(abs), bytes: fs.statSync(abs).size };
  });
  const manifest = {
    name: plan.name,
    version: plan.version,
    downloadedAt: new Date().toISOString(),
    assetSha256: plan.assets,
    files,
  };
  try {
    fs.writeFileSync(
      path.join(tree, TOOLS_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    /* 整目录改名过去：常驻根里要么是没有这一份，要么是齐全的这一份，没有第三种。 */
    fs.mkdirSync(path.dirname(mirror), { recursive: true });
    fs.renameSync(tree, mirror);
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch (error) {
    return bail(
      1,
      `[工具缓存] 失败：落盘被拒 —— ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  log(
    `[工具缓存] ✓ 已下载建镜像 ${files.length} 件·合计 ` +
      `${(files.reduce((s, f) => s + f.bytes, 0) / 1024 ** 2).toFixed(1)} MiB → ${mirror}`,
  );
  return 0;
}

/**
 * 主流程。
 *
 * @param {{argv?: string[], env?: Record<string, string | undefined>,
 *   log?: (line: string)=>void, cwd?: string,
 *   runSpawn?: RunCmd,
 *   runStore?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} [io]
 * @returns {number} 0 在场或补齐 / 1 失败（哈希不符、写盘被拒）/ 2 没有结论
 */
export function main(io = {}) {
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const argv = io.argv ?? process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const seeding = argv.includes("--seed");
  const downloading = argv.includes("--download");
  const resolved = resolveToolRoot({
    cwd: io.cwd ?? ROOT,
    env,
    run: io.runStore ?? ((args, opts) => runPnpmSync(args, { ...opts, stdio: "pipe" })),
  });
  log(`[工具缓存] 工具根：${resolved.root ?? "取不到"}（来源：${resolved.from}）`);
  if (!resolved.root) {
    log(`[工具缓存] **没有结论**：问不出工具根 ⇒ 一边都不动。配 ${TOOLS_ROOT_ENV} 是出口。`);
    return 2;
  }
  /* `--download` 建的是常驻根镜像，不读 bundler 落点 ⇒ 不需要 LOCALAPPDATA 那一问。 */
  if (downloading) {
    return download({ dryRun, log, mirror: mirrorDir(resolved.root), run: io.runSpawn });
  }
  const cache = resolveTauriCacheRoot(env);
  if (!cache.dir) {
    log(`[工具缓存] **没有结论**：${cache.from}。`);
    return 2;
  }
  return seeding
    ? seed({
        cacheDir: cache.dir,
        mirror: mirrorDir(resolved.root),
        dryRun,
        log,
      })
    : ensure({
        cacheDir: cache.dir,
        toolRoot: resolved.root,
        toolRootFrom: resolved.from,
        dryRun,
        log,
      });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main());
}
