#!/usr/bin/env node
/**
 * fetch-daily-shell.mjs — 从 CNB 站内每日成品（滚动 nightly Release）获取纯壳单文件，
 * 落到本地指定位置并按需补项目根快捷方式（ISSUE #3699）。
 *
 * ## 它做什么
 *
 * 每日桌包档会把同一份纯壳 `ComfyAPP-shell.exe`（`src-tauri/target/release/app.exe`，
 * 预编译壳、可连本地 dev server，见 `scripts/ci-ga-desktop-relay.mjs`）回传到 CNB 的
 * 滚动 `nightly` Release。这个脚本把它下载下来，保存为本地可用的壳文件，并在项目根
 * 缺少 `Comfy APP.lnk` 时补一个指向该壳的快捷方式。
 *
 * ## 默认落点（与 ISSUE #3699 同口径）
 *
 *   · 下载资产：`ComfyAPP-shell.exe`
 *   · 保存为：  `src-tauri/target/release/app.exe`（相对项目根；父目录不存在会自动创建）
 *   · 快捷方式：项目根 `Comfy APP.lnk`（仅 Windows；已存在则不覆盖，除非显式要求）
 *
 * ## 用法
 *
 *   node scripts/fetch-daily-shell.mjs
 *   node scripts/fetch-daily-shell.mjs --dry-run
 *   node scripts/fetch-daily-shell.mjs --out src-tauri/target/release/app.exe
 *   node scripts/fetch-daily-shell.mjs --repo moon-read/comfy-app-t3 --tag nightly
 *
 * 下载需要能访问 CNB nightly Release 资产。若直连返回 401/403，可通过环境变量提供令牌
 * （按顺序尝试：`CNB_RELEASE_TOKEN` / `CNB_TOKEN` / `CNB_ISSUE_TOKEN`）或传 `--token`。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const HERE = import.meta.dirname;
export const ROOT = path.resolve(HERE, "..");

export const DEFAULT_REPO = "moon-read/comfy-app-t3";
export const DEFAULT_TAG = "nightly";
export const DEFAULT_ASSET = "ComfyAPP-shell.exe";
export const DEFAULT_OUT = path.join("src-tauri", "target", "release", "app.exe");
export const SHORTCUT_NAME = "Comfy APP.lnk";

/**
 * @param {string[]} argv
 * @returns {{dryRun: boolean, repo: string, tag: string, asset: string, out: string, token: string, forceShortcut: boolean, help: boolean}}
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
  return {
    asset: get("--asset") || DEFAULT_ASSET,
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
  return [
    "用法：node scripts/fetch-daily-shell.mjs [选项]",
    "",
    "  --out <path>         保存路径（默认 src-tauri/target/release/app.exe）",
    "  --repo <slug>        CNB 仓库（默认 moon-read/comfy-app-t3）",
    "  --tag <tag>          Release tag（默认 nightly）",
    "  --asset <name>       资产文件名（默认 ComfyAPP-shell.exe）",
    "  --token <token>      下载鉴权 token（也可用 CNB_RELEASE_TOKEN/CNB_TOKEN/CNB_ISSUE_TOKEN）",
    "  --force-shortcut     即使快捷方式已存在也重新生成",
    "  --dry-run            只打印计划，不下载、不写文件",
    "  -h, --help           显示帮助",
  ].join("\n");
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} explicit
 */
export function resolveToken(env, explicit) {
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
  return { token: "", from: "" };
}

/**
 * @param {{repo: string, tag: string, asset: string}} ctx
 */
export function buildDownloadUrl(ctx) {
  const repo = ctx.repo.replaceAll(/^\/+|\/+$/gu, "");
  const tag = encodeURIComponent(ctx.tag);
  const asset = encodeURIComponent(ctx.asset);
  return `https://cnb.cool/${repo}/-/releases/download/${tag}/${asset}`;
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
 * @param {string} outAbs
 * @param {Buffer} bytes
 */
export function writeFileAtomic(outAbs, bytes) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const tmp = `${outAbs}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, outAbs);
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
 * @param {{argv?: string[], env?: NodeJS.ProcessEnv, cwd?: string, fetchImpl?: typeof fetch, platform?: NodeJS.Platform, spawn?: typeof spawnSync}} io
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
  const url = buildDownloadUrl({ asset: args.asset, repo: args.repo, tag: args.tag });
  const { token, from } = resolveToken(io.env ?? process.env, args.token);

  process.stdout.write(`[fetch-daily-shell] 来源：${url}\n`);
  process.stdout.write(`[fetch-daily-shell] 保存到：${outAbs}\n`);
  process.stdout.write(`[fetch-daily-shell] 鉴权：${from || "无（直连）"}\n`);

  if (args.dryRun) {
    const shortcut = path.join(root, SHORTCUT_NAME);
    const exists = fs.existsSync(shortcut);
    process.stdout.write(
      `[fetch-daily-shell] dry-run：将下载并写入 ${outAbs}${process.platform === "win32" ? `；快捷方式${exists && !args.forceShortcut ? "已存在将跳过" : "将补齐"}` : ""}。\n`,
    );
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
      process.stderr.write(
        "[fetch-daily-shell] 提示：CNB Release 资产需要访问权限时，可设置 CNB_RELEASE_TOKEN / CNB_TOKEN / CNB_ISSUE_TOKEN 或传 --token。\n",
      );
    } else if (downloaded.status === 404) {
      process.stderr.write(
        "[fetch-daily-shell] 提示：请确认 nightly Release 中存在该资产（默认 ComfyAPP-shell.exe），或每日桌包是否已成功产出。\n",
      );
    }
    return 1;
  }

  writeFileAtomic(outAbs, downloaded.bytes);
  process.stdout.write(
    `[fetch-daily-shell] ✓ 已下载 ${downloaded.bytes.length} 字节 -> ${outAbs}${downloaded.auth ? "（已鉴权）" : ""}\n`,
  );

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
