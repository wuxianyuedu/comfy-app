#!/usr/bin/env node
/**
 * fetch-daily-shell.mjs — 从 CNB 站内每日成品（滚动 nightly Release）获取纯壳单文件，
 * 落到本地指定位置并按需补项目根快捷方式（ISSUE #3699）。
 *
 * ## 它做什么
 *
 * 每日桌包档会把同一份纯壳 `ComfyAPP-shell.exe`（`src-tauri/target/release/app.exe`，
 * 预编译壳、可连本地 dev server，见 `scripts/ci/ci-ga-desktop-relay.mjs`）回传到 CNB 的
 * 滚动 `nightly` Release。这个脚本把它下载下来，保存为本地可用的壳文件，并在项目根
 * 缺少 `Comfy APP.lnk` 时补一个指向该壳的快捷方式。取壳时同址取回该壳的**构建信息**
 * 附件（`ComfyAPP-shell-build-info.json`，构建时间 / commit / run / 大小 / sha256，
 * ISSUE #4056）并展示、对账 —— 不再是「拉下来不知道什么时候构建的」。
 *
 * ## 默认落点（与 ISSUE #3699 同口径）
 *
 *   · 下载资产：`ComfyAPP-shell.exe`
 *   · 保存为：  `src-tauri/target/release/app.exe`（相对项目根；父目录不存在会自动创建）
 *   · 快捷方式：项目根 `Comfy APP.lnk`（仅 Windows；已存在则不覆盖，除非显式要求）
 *
 * ## 用法
 *
 *   node scripts/devtools/fetch-daily-shell.mjs
 *   node scripts/devtools/fetch-daily-shell.mjs --dry-run
 *   node scripts/devtools/fetch-daily-shell.mjs --out src-tauri/target/release/app.exe
 *   node scripts/devtools/fetch-daily-shell.mjs --repo moon-read/comfy-app-t3 --tag nightly
 *
 * 下载走 CNB OpenAPI 端点 `https://api.cnb.cool`（官方文档地址，也与
 * `ci-ga-desktop-relay.mjs` 回传后打印的取包地址同源），**不是**网页站 `cnb.cool`：
 * 后者不带 Bearer 时匿名 404、带令牌 400 `Invalid argument`。私有仓库的 Release 附件
 * 需要登录态（`repo-release:r`），可用 `CNB_RELEASE_TOKEN` / `CNB_TOKEN` /
 * `CNB_ISSUE_TOKEN`、`--token`，或用户级令牌文件（见 `tokenConfigPaths()`）提供；
 * `CNB_API_ENDPOINT` 可覆盖端点（私有化部署）。
 *
 * ## 令牌文件「不存在」是正常态
 *
 * 用户级令牌文件是**你按需建**的一份凭据文件，缺省时这些路径一个都不会存在——
 * 脚本会静默跳过、退回匿名下载，因此也需要人来建（`--config` 就是这件事的入口，
 * 它把令牌写进候选路径里的第一个）。候选清单不写死在某一份文档里：`--help` 与
 * `--dry-run` 都逐条打印，且标明每一条「已有 / 不存在」。
 */

import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const HERE = import.meta.dirname;
export const ROOT = path.resolve(HERE, "..", "..");

/** CNB OpenAPI 缺省端点；与回传侧同一个口径，私有化部署用 CNB_API_ENDPOINT 覆盖。 */
export const DEFAULT_API_ENDPOINT = "https://api.cnb.cool";
export const DEFAULT_REPO = "moon-read/comfy-app-t3";
export const DEFAULT_TAG = "nightly";
export const DEFAULT_ASSET = "ComfyAPP-shell.exe";
export const DEFAULT_OUT = path.join("src-tauri", "target", "release", "app.exe");
export const SHORTCUT_NAME = "Comfy APP.lnk";

/**
 * 纯壳的**构建信息**附件（ISSUE #4056，与回传侧 `ci-ga-desktop-relay.mjs` 同名同义）：
 * 取壳时按同一 tag 一并取回并展示 —— 构建时间 / commit / run，并对到手字节做
 * sha256 与大小对账。附件缺席（旧包）时降级指到 Release 页，不影响壳本体。
 */
export const BUILD_INFO_ASSET = "ComfyAPP-shell-build-info.json";

/**
 * @param {string[]} argv
 * @returns {{dryRun: boolean, repo: string, tag: string, asset: string, out: string, token: string, config: string | null, configOnly: boolean, forceShortcut: boolean, help: boolean}}
 */
export function parseArgs(argv = process.argv.slice(2)) {
  /** @param {string} flag */
  const get = (flag) => {
    const i = argv.indexOf(flag);
    if (i === -1) {
      return "";
    }
    return (argv[i + 1] ?? "").trim();
  };
  /* `--config` 的取值看着像旗标就不吃：`--config --token xxx` 是最自然的写法，
   * 不判这一下会把「--token」当成目标路径，写出一个名叫 `--token` 的文件。 */
  const rawConfig = get("--config");
  return {
    asset: get("--asset") || DEFAULT_ASSET,
    config: argv.includes("--config") && !rawConfig.startsWith("-") ? rawConfig : null,
    /* `--config --token <v>` 时 token 是给 --config 用的值，不再进下载链；否则传了
     * --token 却因为少了下载分支而白跑一趟（这一族的现场就是「我明明贴了令牌」）。 */
    configOnly: argv.includes("--config"),
    dryRun: argv.includes("--dry-run"),
    forceShortcut: argv.includes("--force-shortcut"),
    help: argv.includes("--help") || argv.includes("-h"),
    out: get("--out") || DEFAULT_OUT,
    repo: get("--repo") || DEFAULT_REPO,
    tag: get("--tag") || DEFAULT_TAG,
    token: get("--token"),
  };
}

export function usage() {
  const paths = tokenConfigPaths(process.env, process.platform);
  return [
    "用法：node scripts/devtools/fetch-daily-shell.mjs [选项]",
    "",
    "  --out <path>         保存路径（默认 src-tauri/target/release/app.exe）",
    "  --repo <slug>        CNB 仓库（默认 moon-read/comfy-app-t3）",
    "  --tag <tag>          Release tag（默认 nightly）",
    "  --asset <name>       资产文件名（默认 ComfyAPP-shell.exe）",
    "  --token <token>      下载鉴权 token（也可用环境变量或令牌文件）",
    "  --config             把 --token 的值写进令牌文件（候选路径里的第一个，见下）",
    "  --force-shortcut     即使快捷方式已存在也重新生成",
    "  --dry-run            只打印计划，不下载、不写文件",
    "  -h, --help           显示帮助",
    "",
    "鉴权（私有仓 Release 附件需 repo-release:r）：",
    "  环境变量：CNB_RELEASE_TOKEN / CNB_TOKEN / CNB_ISSUE_TOKEN",
    "  令牌文件：将 token 单独写入以下任一路径（按顺序读取首个非空文件，内容取首行/trim）：",
    ...paths.map(
      (p, i) => `    ${i === 0 ? "*" : " "} ${p}${i === 0 ? "   ← --config 默认写这里" : ""}`,
    ),
    "",
    "  这些路径缺省都不存在（不存在 = 还没建，不是错误）：新建是",
    "    node scripts/devtools/fetch-daily-shell.mjs --config --token <token>",
    "  或自己建目录与文件；Windows 上建议顺手 icacls 收成仅当前用户可读。",
    "",
    "环境变量：CNB_API_ENDPOINT 覆盖下载端点（缺省 https://api.cnb.cool）。",
  ].join("\n");
}

/**
 * 用户级令牌文件候选路径（按优先级）。用于双击/无参运行时的持久化鉴权配置（ISSUE #3736）。
 *
 * @param {Record<string, string | undefined>} env
 * @param {NodeJS.Platform} [platform]
 * @returns {string[]}
 */
export function tokenConfigPaths(env = process.env, platform = process.platform) {
  /* homedir 先从传入的 env 里取（`HOME` / `USERPROFILE`）：候选路径是「用户级」的，
   * 而 `os.homedir()` 读的是进程启动时的真实用户，注入 env 做验证时会指错人。 */
  const home = (env.HOME ?? env.USERPROFILE ?? "").trim() || os.homedir();
  /** @type {string[]} */
  const paths = [];
  if (platform === "win32") {
    const appData = (env.APPDATA ?? "").trim();
    if (appData) {
      paths.push(path.join(appData, "comfy-app", "cnb-release-token"));
    }
    paths.push(path.join(home, "AppData", "Roaming", "comfy-app", "cnb-release-token"));
  }
  // 通用位置（跨平台兜底，Windows 上也可用）
  paths.push(path.join(home, ".config", "comfy-app", "cnb-release-token"));
  paths.push(path.join(home, ".comfy-app", "cnb-release-token"));
  // 去重并保序
  return [...new Set(paths.map((p) => path.normalize(p)))];
}

/**
 * @param {string[]} paths
 * @param {{readFileSync?: (path: string, encoding: BufferEncoding) => string | Buffer}} [io]
 */
export function readTokenFromConfigFiles(paths, io = {}) {
  const readFileSync = io.readFileSync ?? fs.readFileSync;
  for (const file of paths) {
    try {
      const raw = readFileSync(file, "utf8");
      // 仅取首个非空行，避免误读多行文件里的注释/噪声
      const token =
        String(raw)
          .replace(/^\uFEFF/u, "")
          .split(/\r?\n/u)
          .map((l) => l.trim())
          .find((l) => l.length > 0) ?? "";
      if (token) {
        return { token, from: path.normalize(file) };
      }
    } catch {
      // 文件不存在或不可读：继续尝试下一候选
    }
  }
  return { token: "", from: "" };
}

/**
 * 把令牌写进候选路径里的第一个（`--config` 的落地动作）。
 *
 * 为什么需要它：令牌文件是「按需建」的凭据文件，缺省时一个都不存在 —— 光在 401 出口
 * 打印路径，人只会得到「我这儿没有这个路径」这句话，而脚本自己不提供建它的入口。
 * 写入取 `0o600`（Windows 上靠 ACL 兜底），只写令牌本体 + 换行，不写注释/多余字段，
 * 避免哪一行被 `readTokenFromConfigFiles` 的全表读法误取。
 *
 * @param {{token: string, target: string, mkdirSync?: typeof fs.mkdirSync, writeFileSync?: typeof fs.writeFileSync}} io
 * @returns {string} 实际写入的规范路径
 */
export function writeTokenConfigFile(io) {
  const target = path.normalize(io.target);
  const mkdir = io.mkdirSync ?? fs.mkdirSync;
  const write = io.writeFileSync ?? fs.writeFileSync;
  mkdir(path.dirname(target), { recursive: true });
  write(target, `${io.token.trim()}\n`, { encoding: "utf8", mode: 0o600 });
  return target;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} explicit
 * @param {{platform?: NodeJS.Platform, configPaths?: string[], readFileSync?: (path: string, encoding: BufferEncoding) => string | Buffer}} [opts]
 */
export function resolveToken(env, explicit, opts = {}) {
  const direct = explicit.trim();
  if (direct) {
    return { token: direct, from: "--token" };
  }
  for (const key of ["CNB_RELEASE_TOKEN", "CNB_TOKEN", "CNB_ISSUE_TOKEN"]) {
    const value = (env[key] ?? "").trim();
    if (value) {
      return { token: value, from: key };
    }
  }
  const paths = opts.configPaths ?? tokenConfigPaths(env, opts.platform ?? process.platform);
  return readTokenFromConfigFiles(paths, { readFileSync: opts.readFileSync });
}

/**
 * 「缺令牌」时唯一要人照抄的那一行。三条出口（无令牌的前置读数、`--dry-run`、401/403 失败）
 * 都念它，避免同一条命令在两处写法不同、或某条出口漏掉它 —— 缺令牌的人最需要的是可执行的
 * 下一步，不是一份「你可以设环境变量 / 也可以建文件」的选项清单。
 */
export const MISSING_TOKEN_HINT = [
  "pnpm fetch:daily-shell --config --token",
  " <你的CNB_",
  "RELEASE_TOKEN>",
].join("");

/**
 * 把「候选令牌文件在不在」念成一段可读文本（只念路径与有无，绝不回显令牌内容）。
 *
 * @param {string[]} paths
 * @param {{exists?: (p: string) => boolean}} [io]
 */
export function describeTokenCandidates(paths, io = {}) {
  const exists = io.exists ?? fs.existsSync;
  const seen = paths.map((p) => `  · ${p}（${exists(p) ? "已有" : "不存在"}）`);
  return `[fetch-daily-shell] 令牌文件候选（缺省都不存在，按顺序取首个非空）：\n${seen.join("\n")}\n`;
}

/**
 * 取下载端点：与仓内其它 CNB API 脚本一样，缺省 api.cnb.cool、允许环境变量覆盖。
 *
 * @param {Record<string, string | undefined>} env
 */
export function resolveEndpoint(env) {
  return (
    String(env.CNB_API_ENDPOINT ?? "")
      .trim()
      .replace(/\/+$/u, "") || DEFAULT_API_ENDPOINT
  );
}

/**
 * @param {{asset: string, endpoint?: string, repo: string, tag: string}} ctx
 */
export function buildDownloadUrl(ctx) {
  const repo = ctx.repo.replaceAll(/^\/+|\/+$/gu, "");
  const tag = encodeURIComponent(ctx.tag);
  const asset = encodeURIComponent(ctx.asset);
  const endpoint = (ctx.endpoint || DEFAULT_API_ENDPOINT).replace(/\/+$/u, "");
  return `${endpoint}/${repo}/-/releases/download/${tag}/${asset}`;
}

/**
 * 是能按字段取值的普通对象（type predicate，避开 JSON.parse 的 any 断言；
 * 与 `ci-ga-desktop-relay.mjs` 的同名判据同形 —— 本脚本是 node 直跑的独立件，
 * 不 import `src/lib/is-record`）。
 *
 * @param {unknown} v 任意值
 * @returns {v is Record<string, unknown>} true ⇒ 可按键取值
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 把构建信息的 `built_at`（回传侧 `new Date().toISOString()` 的 ISO UTC 文本）
 * 换算成本地时间展示，并保留 UTC 原值供对账。此前原样打印 ISO 串——中国用户在
 * CNB Release 页看到的是北京时间（如 19:50），脚本输出却是 `…T11:50…Z`，会被
 * 误读成上午构建的（ISSUE #4653）。解析不了（非 ISO 文本）就原样给出，不抛错。
 *
 * @param {string} raw 附件里的 built_at 原文
 * @returns {string} 可直接拼进「构建时间」一行的文本
 */
export function describeBuiltAt(raw) {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    return raw;
  }
  const d = new Date(ms);
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const local =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return `${local}（本地；UTC 原值 ${raw}）`;
}

/**
 * 把构建信息附件整理成给人看的两段话（ISSUE #4056）：`info` 进 stdout（构建时间 /
 * commit / run + 对账结果），校验不一致的 `warn` 进 stderr。字段缺席就少念；
 * sha256 / 大小与到手字节对不上要明说（nightly 滚动覆盖时「exe 与清单不同批」
 * 是最常见的来源），但不下架已到手的壳 —— 壳本身能用，要紧的是让人知道拿到的
 * 不是清单里那一份。附件不是合法 JSON 同样降级，不抛。
 *
 * @param {Buffer} infoBytes 构建信息附件的原始字节
 * @param {{exeBytes: number, exeSha256: string}} actual 到手 exe 的实测值
 * @returns {{info: string, warn: string}}
 */
export function describeBuildInfo(infoBytes, actual) {
  let parsed;
  try {
    parsed = JSON.parse(infoBytes.toString("utf8"));
  } catch {
    return {
      info: "[fetch-daily-shell] 构建信息附件不是合法 JSON —— 构建时间与来源以 Release 页为准。\n",
      warn: "",
    };
  }
  const rec = isPlainObject(parsed) ? parsed : {};
  /**
   * 取字符串字段并去首尾空白；缺席 / 非字符串一律空串（不抛、不断言）。
   *
   * @param {Record<string, unknown>} source
   * @param {string} key
   * @returns {string}
   */
  const text = (source, key) => {
    const value = source[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const parts = [];
  const builtAt = text(rec, "built_at");
  if (builtAt) parts.push(`构建时间 ${describeBuiltAt(builtAt)}`);
  const commit = text(rec, "commit");
  if (commit) parts.push(`commit ${commit.slice(0, 12)}`);
  const runId = text(rec, "run_id");
  if (runId) parts.push(`run ${runId}`);
  const head =
    parts.length > 0
      ? `[fetch-daily-shell] 构建信息：${parts.join(" · ")}\n`
      : "[fetch-daily-shell] 构建信息附件在场但没有可读字段 —— 构建时间与来源以 Release 页为准。\n";
  /** @type {string[]} */
  const checks = [];
  /** @type {string[]} */
  const mismatches = [];
  const manifestSha = text(rec, "sha256");
  if (manifestSha) {
    if (manifestSha.toLowerCase() === actual.exeSha256.toLowerCase()) {
      checks.push("sha256 一致");
    } else {
      mismatches.push(
        `sha256 与构建信息不一致（清单 ${manifestSha.slice(0, 12)}… / 实测 ${actual.exeSha256.slice(0, 12)}…）` +
          "—— 多半是 nightly 滚动覆盖时 exe 与清单不同批",
      );
    }
  }
  const manifestSize = typeof rec.size === "number" ? rec.size : -1;
  if (manifestSize >= 0) {
    if (manifestSize === actual.exeBytes) {
      checks.push(`大小一致（${String(manifestSize)} 字节）`);
    } else {
      mismatches.push(
        `大小与构建信息不一致（清单 ${String(manifestSize)} / 实测 ${String(actual.exeBytes)}）`,
      );
    }
  }
  const info =
    checks.length > 0 ? `${head}[fetch-daily-shell] 校验：${checks.join(" · ")}\n` : head;
  const warn =
    mismatches.length > 0
      ? `[fetch-daily-shell] ⚠ ${mismatches.join("；")} —— 壳本体已到手，但与清单对不上，别拿它当清单里那一份排查问题。\n`
      : "";
  return { info, warn };
}

/**
 * @param {string} url
 * @param {{token: string, fetchImpl?: typeof fetch}} io
 */
export async function downloadToBuffer(url, io) {
  const fetchImpl = io.fetchImpl ?? fetch;
  /** @type {RequestInit} */
  const init = {
    headers: {},
    redirect: "follow",
  };
  const attempts = io.token
    ? [
        { auth: false, label: "anonymous" },
        { auth: true, label: "authenticated" },
      ]
    : [{ auth: false, label: "anonymous" }];

  /** @type {Response | null} */
  let last = null;
  /* oxlint-disable no-await-in-loop -- 顺序尝试匿名/鉴权下载与回退读取响应体，不能并行 */
  for (const attempt of attempts) {
    /** @type {Record<string, string>} */
    const headers = {};
    if (attempt.auth && io.token) {
      headers.Authorization = `Bearer ${io.token}`;
    }
    const res = await fetchImpl(url, { ...init, headers });
    last = res;
    if (res.ok) {
      const ab = await res.arrayBuffer();
      return {
        ok: true,
        status: res.status,
        bytes: Buffer.from(ab),
        auth: attempt.auth,
      };
    }
    // 401/403 且还有带 token 的尝试机会时重试一次
    if ((res.status === 401 || res.status === 403) && !attempt.auth && io.token) {
      continue;
    }
    // 其他失败直接返回
    const text = await safeReadText(res);
    return {
      ok: false,
      status: res.status,
      detail: text,
      auth: attempt.auth,
    };
  }
  /* oxlint-enable no-await-in-loop */

  if (last) {
    const detail = await safeReadText(last);
    return {
      ok: false,
      status: last.status,
      detail,
      auth: false,
    };
  }
  return { ok: false, status: 0, detail: "no response", auth: false };
}

/**
 * @param {Response} res
 */
async function safeReadText(res) {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * rename 落位时值得重试的错误码：Windows 上目标文件被其它句柄短暂占用时，
 * `MoveFileEx(REPLACE_EXISTING)` 会以 EPERM / EACCES / EBUSY 失败，而占用方
 * （杀软扫描、索引器、备份工具）往往几秒内就放手 —— 退避重试比直接失败更有用。
 */
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/** 重试间隔（毫秒），总预算约 3 秒：足以跨过一次杀软扫描，又不至于让双击入口久等。 */
export const RENAME_RETRY_DELAYS_MS = [100, 200, 400, 800, 1600];

/**
 * tasklist 子进程结果里本脚本用得到的形状（比 SpawnSyncReturns 宽松，便于测试注入）。
 *
 * @typedef {{status: number | null, stdout?: string | Buffer | null}} TasklistSpawnResult
 */

/**
 * 按映像名列举正在运行的进程（只读查询，不杀进程）。用于落位失败时回答
 * 「是不是应用还开着」—— Windows 上运行中的 exe 会被系统锁住，rename 覆盖必失败。
 *
 * @param {string} imageName 目标文件名（如 app.exe）
 * @param {{platform?: NodeJS.Platform, spawnImpl?: (command: string, args: string[], options?: {encoding: "utf8", windowsHide: boolean, stdio: "pipe"}) => TasklistSpawnResult}} [io]
 * @returns {Array<{name: string, pid: number}>}
 */
export function findRunningProcessesByImage(imageName, io = {}) {
  const platform = io.platform ?? process.platform;
  const spawnImpl = io.spawnImpl ?? spawnSync;
  if (platform !== "win32" || !imageName) {
    return [];
  }
  let res;
  try {
    res = spawnImpl("tasklist", ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: "pipe",
    });
  } catch {
    return [];
  }
  if (res?.status !== 0 || !res?.stdout) {
    return [];
  }
  /** @type {Array<{name: string, pid: number}>} */
  const found = [];
  const lower = imageName.toLowerCase();
  for (const row of String(res.stdout).split(/\r?\n/u)) {
    /* CSV 行形如 `"app.exe","1234","Console","1","…"`；首列映像名、次列 PID。 */
    const m = row.match(/^"(?<name>[^"]+)"\s*,\s*"(?<pid>\d+)"/u);
    const name = m?.groups?.name;
    const pid = m?.groups?.pid;
    if (name !== undefined && pid !== undefined && name.trim().toLowerCase() === lower) {
      found.push({ name: name.trim(), pid: Number(pid) });
    }
  }
  return found;
}

/**
 * 把 rename 失败翻译成「下一步做什么」。目标被锁在 Windows 上最常见的原因是
 * 旧壳还在运行（或杀软正在扫描）；按能不能查到同名进程分别给提示。
 *
 * @param {NodeJS.ErrnoException} err rename 抛出的原始错误
 * @param {string} outAbs 目标落点绝对路径
 * @param {{platform?: NodeJS.Platform, spawnImpl?: (command: string, args: string[], options?: {encoding: "utf8", windowsHide: boolean, stdio: "pipe"}) => TasklistSpawnResult}} [io]
 * @returns {string}
 */
export function describeRenameFailure(err, outAbs, io = {}) {
  const tag = err?.code ? `（${err.code}）` : "";
  const lines = [`无法把下载的壳落位到 ${outAbs}${tag}：${err?.message ?? "未知错误"}。`];
  const running = findRunningProcessesByImage(path.basename(outAbs), io);
  if (running.length > 0) {
    const pids = running.map((p) => `${p.name}(PID ${p.pid})`).join("、");
    lines.push(
      `检测到同名进程正在运行：${pids} —— 它锁住了目标文件。请先退出 Comfy APP（注意托盘/后台实例），再重新获取。`,
    );
  } else {
    lines.push(
      "目标文件被占用：多半是应用仍在运行、或杀毒软件正在扫描新文件。请先关闭应用，稍等几秒后重试；若反复出现，把杀软的该目录扫描加入白名单。",
    );
  }
  return lines.join("\n");
}

/**
 * 原子落盘：先写同目录临时文件，再 rename 到目标。rename 遇到可重试的占用错误时
 * 按退避间隔重试；耗尽后清掉临时文件，并抛出带「下一步」提示的错误（保留原错误为 cause）。
 *
 * @param {string} outAbs
 * @param {Buffer} bytes
 * @param {{delays?: number[], sleep?: (ms: number) => Promise<void>, platform?: NodeJS.Platform, spawnImpl?: (command: string, args: string[], options?: {encoding: "utf8", windowsHide: boolean, stdio: "pipe"}) => TasklistSpawnResult}} [opts]
 */
export async function writeFileAtomic(outAbs, bytes, opts = {}) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const tmp = `${outAbs}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, bytes);
  const delays = opts.delays ?? RENAME_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  /* oxlint-disable no-await-in-loop -- 退避重试必须逐次等待，不能并行 */
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, outAbs);
      return;
    } catch (error) {
      if (!isRetryableRenameError(error)) {
        /* 非占用类错误不是重试能解决的：清掉临时文件后原样抛出，不包装占用提示。 */
        removeTempQuietly(tmp);
        throw error;
      }
      if (attempt >= delays.length) {
        removeTempQuietly(tmp);
        const wrapped = new Error(describeRenameFailure(error, outAbs, opts));
        wrapped.cause = error;
        throw wrapped;
      }
      await sleep(delays[attempt] ?? 0);
    }
  }
  /* oxlint-enable no-await-in-loop */
}

/**
 * 判断抛出的值是不是「目标被占用」一族的 rename 错误（EPERM / EACCES / EBUSY）。
 * 用类型守卫收窄 unknown，避免对 unknown 做不安全断言。
 *
 * @param {unknown} v
 * @returns {v is NodeJS.ErrnoException}
 */
function isRetryableRenameError(v) {
  if (!(v instanceof Error) || !("code" in v)) {
    return false;
  }
  return RETRYABLE_RENAME_CODES.has(typeof v.code === "string" ? v.code : "");
}

/**
 * 清掉半途残留的临时文件；清不掉就留着，别为清理再抛一个错盖住真因。
 *
 * @param {string} tmp
 */
function removeTempQuietly(tmp) {
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* 残留不影响结论；真因在原错误里 */
  }
}

/**
 * @param {{root: string, exeAbs: string, force: boolean, dryRun: boolean, platform?: NodeJS.Platform, spawn?: typeof spawnSync, exists?: typeof fs.existsSync, log?: (s:string)=>void}} opts
 */
export function ensureRootShortcut(opts) {
  const platform = opts.platform ?? process.platform;
  const spawn = opts.spawn ?? spawnSync;
  const exists = opts.exists ?? fs.existsSync;
  const log = opts.log ?? ((s) => process.stdout.write(`${s}\n`));
  const shortcut = path.join(opts.root, SHORTCUT_NAME);

  if (platform !== "win32") {
    log(`[fetch-daily-shell] 非 Windows 平台，跳过快捷方式（${SHORTCUT_NAME} 为 .lnk）。`);
    return { ok: true, skipped: true, reason: "non-windows" };
  }
  if (exists(shortcut) && !opts.force) {
    log(`[fetch-daily-shell] 快捷方式已存在，跳过：${shortcut}`);
    return { ok: true, skipped: true, reason: "exists" };
  }
  if (opts.dryRun) {
    log(`[fetch-daily-shell] dry-run：将生成快捷方式 ${shortcut} -> ${opts.exeAbs}`);
    return { ok: true, skipped: true, reason: "dry-run" };
  }

  const script = path.join(opts.root, "tools", "start", "Create-AppShortcut.ps1");
  if (!exists(script)) {
    return { ok: false, skipped: false, reason: `未找到快捷方式脚本：${script}` };
  }

  const res = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-ExePath",
      opts.exeAbs,
      "-ProjectRoot",
      opts.root,
    ],
    { cwd: opts.root, encoding: "utf8", stdio: "pipe" },
  );
  if (res.status !== 0) {
    const stderr = String(res.stderr ?? "").trim();
    const stdout = String(res.stdout ?? "").trim();
    const err = stderr === "" ? stdout : stderr;
    return {
      ok: false,
      skipped: false,
      reason: err === "" ? `exit ${String(res.status)}` : err,
    };
  }
  log(`[fetch-daily-shell] 已确保快捷方式：${shortcut}`);
  return { ok: true, skipped: false, reason: "created" };
}

/**
 * @param {{argv?: string[], env?: NodeJS.ProcessEnv, cwd?: string, fetchImpl?: typeof fetch, platform?: NodeJS.Platform, spawn?: typeof spawnSync, configPaths?: string[], writeFile?: typeof writeFileAtomic}} io
 */
export async function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const root = path.resolve(io.cwd ?? ROOT);
  const outAbs = path.isAbsolute(args.out) ? args.out : path.resolve(root, args.out);
  const env = io.env ?? process.env;
  const url = buildDownloadUrl({
    asset: args.asset,
    endpoint: resolveEndpoint(env),
    repo: args.repo,
    tag: args.tag,
  });
  const configPaths = tokenConfigPaths(env, io.platform ?? process.platform);

  /* `--config`：把 --token 的值落进令牌文件。目标路径可显式给，缺省是候选清单里的第一个
   * （Windows 上就是 %APPDATA%\comfy-app\cnb-release-token）。这条路径存在的意义是
   * 「这些文件缺省一个都不存在」—— 人需要一个入口去建它，而不是自己去猜目录。 */
  if (args.configOnly) {
    const target = args.config || configPaths[0] || "";
    const written = (args.token ?? "").trim();
    if (!written) {
      process.stderr.write(
        "[fetch-daily-shell] --config 需要一个令牌值：--config [路径] --token <token>。\n",
      );
      return 2;
    }
    if (!target) {
      process.stderr.write(
        "[fetch-daily-shell] --config 找不到可写的候选路径（APPDATA 与 homedir 都取不到），请显式给：--config <路径>。\n",
      );
      return 2;
    }
    const abs = path.isAbsolute(target) ? target : path.join(root, target);
    const saved = writeTokenConfigFile({ token: written, target: abs });
    process.stdout.write(`[fetch-daily-shell] ✓ 令牌已写入：${saved}\n`);
    process.stdout.write(
      "[fetch-daily-shell] 提示：该文件在项目检出之外，勿复制进仓库/`.env`；Windows 上建议 icacls 收成仅当前用户可读。\n",
    );
    return 0;
  }

  /* `io.configPaths` 是注入面：用例要证明「这些路径缺省都不存在」，就不能读到跑用例
   * 那台机器上真实存在的令牌文件。生产路径不传，仍是 `tokenConfigPaths()` 的结果。 */
  const { token, from } = resolveToken(env, args.token, {
    configPaths: io.configPaths ?? configPaths,
  });

  process.stdout.write(`[fetch-daily-shell] 来源：${url}\n`);
  process.stdout.write(`[fetch-daily-shell] 保存到：${outAbs}\n`);
  process.stdout.write(`[fetch-daily-shell] 鉴权：${from || "无（直连）"}\n`);
  if (!from) {
    /* 「本地没有这个路径」是这一族最常见的卡点：路径不存在本来就是正常态，问题在于
     * 没人告诉你它在找哪儿、以及怎么建。所以无令牌时把候选清单连同存在状态一起念
     * 出来（只念路径与有无，绝不回显令牌内容）。 */
    process.stdout.write(describeTokenCandidates(configPaths));
    process.stdout.write(`[fetch-daily-shell] 缺令牌，先执行：${MISSING_TOKEN_HINT}\n`);
  }

  if (args.dryRun) {
    const shortcut = path.join(root, SHORTCUT_NAME);
    const exists = fs.existsSync(shortcut);
    process.stdout.write(
      `[fetch-daily-shell] dry-run：将下载并写入 ${outAbs}${process.platform === "win32" ? `；快捷方式${exists && !args.forceShortcut ? "已存在将跳过" : "将补齐"}` : ""}。\n`,
    );
    if (!from) {
      /* dry-run 是「下载前的预演」，此刻就是补齐令牌的最后时机：只看计划容易以为一切就绪，
       * 真跑起来才发现 401。所以缺令牌在这里当降级读数念出来（走 stderr、退 2），
       * 而不是静默退 0 —— 退码与正文一致，不许「说完就算过」。 */
      process.stderr.write(
        `[fetch-daily-shell] 未配置令牌：本计划按匿名下载执行，私有仓会以 HTTP 401 失败。\n`,
      );
      process.stderr.write(`[fetch-daily-shell] 缺令牌，先执行：${MISSING_TOKEN_HINT}\n`);
      return 2;
    }
    return 0;
  }

  const downloaded = await downloadToBuffer(url, {
    fetchImpl: io.fetchImpl ?? fetch,
    token,
  });
  if (!downloaded.ok || !("bytes" in downloaded) || !downloaded.bytes) {
    process.stderr.write(
      `[fetch-daily-shell] 下载失败（HTTP ${String(downloaded.status)}）：${url}\n`,
    );
    if ("detail" in downloaded && downloaded.detail) {
      process.stderr.write(`[fetch-daily-shell] 响应片段：${downloaded.detail}\n`);
    }
    if (downloaded.status === 401 || downloaded.status === 403) {
      const cfg = configPaths[0] ?? "";
      process.stderr.write(
        "[fetch-daily-shell] 提示：该 Release 附件需要登录态与 repo-release:r 权限。\n",
      );
      process.stderr.write(
        "[fetch-daily-shell] 可选配置：\n" +
          "  · 环境变量：CNB_RELEASE_TOKEN / CNB_TOKEN / CNB_ISSUE_TOKEN\n" +
          `  · 令牌文件：将带 repo-release:r 权限的 token 写入 ${cfg || "用户级 comfy-app/cnb-release-token 文件"}（仅首个非空行生效）\n` +
          "  · 或本次传入：--token <token>\n",
      );
      /* 按「这一跑实际解析到的结果」判，不看 args.token：`token` 是所有来源的合成值，
       * 用它判会让「文件没建成」的那一态悄悄少一句关键提示。 */
      if (!from) {
        process.stderr.write(
          "[fetch-daily-shell] 当前未检测到可用令牌（环境变量与令牌文件均为空/缺失）。\n",
        );
        /* 「本地根本没有这个路径」是这一族最常见的卡点：路径本该不存在，要人去建它。
         * 目标路径不缺省时不点名（`--config` 的缺省落点就是候选清单第一个，念它只会让人以为
         * 必须手写路径）。 */
        const target = cfg ? `[fetch-daily-shell] （令牌将写入候选清单第一个：${cfg}）\n` : "";
        process.stderr.write(
          `[fetch-daily-shell] 缺令牌，先执行：${MISSING_TOKEN_HINT}\n${target}`,
        );
      }
    } else if (downloaded.status === 404) {
      /* 端点修对以后，404 才是真的「这个 tag / 资产名下没有这份附件」；与落点无关，
       * 别再引向改路径，也别把网页端点的匿名 404 念成「上游没产出」。 */
      process.stderr.write(
        `[fetch-daily-shell] 提示：该地址下没有 ${args.asset}；请核对 nightly Release 页的附件清单、--tag 与 --repo，资产名不同时用 --asset 指定。\n`,
      );
      process.stderr.write(
        `[fetch-daily-shell] 本次失败与保存路径无关（默认 ${DEFAULT_OUT}），不要改落点；立即可用的替代是 tools/build/build-tauri-release.ps1 本地编壳。\n`,
      );
    }
    return 1;
  }

  try {
    await (io.writeFile ?? writeFileAtomic)(outAbs, downloaded.bytes);
  } catch (error) {
    /* 落位失败不再是裸栈：把「先关应用再重试」的可执行出口直接念给双击入口的人。 */
    process.stderr.write(`[fetch-daily-shell] 写入落点失败：${outAbs}\n`);
    process.stderr.write(
      `[fetch-daily-shell] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    const causeStack =
      error instanceof Error && error.cause instanceof Error ? error.cause.stack : null;
    if (causeStack) {
      process.stderr.write(`[fetch-daily-shell] ${causeStack}\n`);
    }
    return 1;
  }
  process.stdout.write(
    `[fetch-daily-shell] ✓ 已下载 ${downloaded.bytes.length} 字节 -> ${outAbs}${downloaded.auth ? "（已鉴权）" : ""}\n`,
  );

  /* 构建信息（ISSUE #4056）：取壳的人要能答出「这是什么时候、哪一笔构建」。
   * 附件按同一 tag 同址取回；缺席（旧包）/ 读不到都不影响壳本体 —— 降级念一句
   * 去向，不装作读过。 */
  const exeSha256 = createHash("sha256").update(downloaded.bytes).digest("hex");
  const infoUrl = buildDownloadUrl({
    asset: BUILD_INFO_ASSET,
    endpoint: resolveEndpoint(env),
    repo: args.repo,
    tag: args.tag,
  });
  const info = await downloadToBuffer(infoUrl, {
    fetchImpl: io.fetchImpl ?? fetch,
    token,
  });
  if (info.ok && "bytes" in info && info.bytes) {
    const shown = describeBuildInfo(info.bytes, {
      exeBytes: downloaded.bytes.length,
      exeSha256,
    });
    process.stdout.write(shown.info);
    if (shown.warn) {
      process.stderr.write(shown.warn);
    }
  } else if (info.status === 404) {
    process.stdout.write(
      `[fetch-daily-shell] 该 nightly 没带构建信息附件（${BUILD_INFO_ASSET}，功能上线前的旧包）—— 构建时间与来源以 Release 页为准。\n`,
    );
  } else {
    process.stdout.write(
      `[fetch-daily-shell] 构建信息读不到（HTTP ${String(info.status)}）—— 不影响已下载的壳；构建时间与来源以 Release 页为准。\n`,
    );
  }

  const shortcutResult = ensureRootShortcut({
    dryRun: false,
    exeAbs: outAbs,
    force: args.forceShortcut,
    platform: io.platform ?? process.platform,
    root,
    spawn: io.spawn ?? spawnSync,
  });
  if (!shortcutResult.ok) {
    process.stderr.write(
      `[fetch-daily-shell] 壳已下载，但快捷方式未能补齐：${shortcutResult.reason}\n`,
    );
    return 1;
  }

  return 0;
}

const isEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isEntry) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? String(error)) : String(error);
    process.stderr.write(`[fetch-daily-shell] ${detail}\n`);
    process.exit(1);
  }
}
