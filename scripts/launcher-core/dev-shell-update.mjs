/**
 * dev-shell-update.mjs — dev 壳启动前的「远端有新壳就更新、再用新壳启动」链路（#4722）
 *
 * 穿起三件原本互不连通的能力：
 *   ① 时效检测：复用 `preflight.mjs` 的 `shellStaleWarning()`（本地壳落后于 src-tauri 源码）；
 *   ② 远端新鲜度：从 nightly Release 取构建信息附件，和本地壳的构建标记比 commit / built_at / run_id；
 *   ③ 取壳：复用 `fetch-daily-shell.mjs` 的 `main()` 覆盖写 app.exe。
 * 更新发生在**启动前**，因此「重新启动」就是随后照常 `Start-Process` 那个被覆盖的 app.exe ——
 * 不需要杀正在跑的壳（硬规则 3：不自己写 kill/taskkill）。
 *
 * 跨平台：逻辑全在本文件（.mjs），Windows 的 `tools/start/start-tauri.ps1` 只调用它并启动壳
 * （硬规则 12：.ps1 是薄入口，编排只写 Node）。`fetch-daily-shell.ps1` 与 `pnpm fetch:daily-shell`
 * 是同一取壳逻辑的另外两个入口。
 *
 * 安全边界：缺令牌 / 网络失败 / 构建信息读不到 / 壳被占用 ⇒ **跳过更新、照常启动**，绝不阻塞
 * 开发启动，也绝不为了覆盖去杀进程。构建标记只在成功取壳后落盘（`target/release` 下、不入 git）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  BUILD_INFO_ASSET,
  DEFAULT_OUT,
  DEFAULT_REPO,
  DEFAULT_TAG,
  ROOT,
  buildDownloadUrl,
  downloadToBuffer,
  resolveEndpoint,
  resolveToken,
  tokenConfigPaths,
} from "../devtools/fetch-daily-shell.mjs";
import { shellStaleWarning } from "./preflight.mjs";

/** 本地构建标记文件名（与壳同目录，target/ 本就不入 git）。 */
export const BUILD_INFO_STAMP = ".comfy-shell-build-info.json";

/** @param {string} outAbs 壳的绝对路径 @returns {string} 构建标记的绝对路径 */
export function stampPathOf(outAbs) {
  return path.join(path.dirname(outAbs), BUILD_INFO_STAMP);
}

/**
 * 从构建信息附件里取出可比较的三个字段。解析不出来回 null（按「读不到」处理，不抛）。
 * @param {Buffer | string} bytes
 * @returns {{built_at: string, commit: string, run_id: string} | null}
 */
export function parseShellBuildInfo(bytes) {
  try {
    const parsed = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    /** @param {unknown} v */
    const text = (v) => (typeof v === "string" ? v.trim() : "");
    const builtAt = text(parsed.built_at);
    const commit = text(parsed.commit);
    const runId = text(parsed.run_id);
    if (!builtAt && !commit && !runId) {
      return null;
    }
    return { built_at: builtAt, commit, run_id: runId };
  } catch {
    return null;
  }
}

/** @param {string} stampAbs @param {{readFileSync?: typeof fs.readFileSync}} [io] */
export function readShellStamp(stampAbs, io = {}) {
  try {
    const raw = (io.readFileSync ?? fs.readFileSync)(stampAbs, "utf8");
    return parseShellBuildInfo(String(raw));
  } catch {
    return null;
  }
}

/**
 * 成功取壳后落构建标记。写失败只回 false（不抛）—— 标记丢了最坏是下次跳过更新，不该让启动失败。
 * @param {string} stampAbs
 * @param {{built_at: string, commit: string, run_id: string}} info
 * @param {{writeFileSync?: typeof fs.writeFileSync, mkdirSync?: typeof fs.mkdirSync}} [io]
 */
export function writeShellStamp(stampAbs, info, io = {}) {
  try {
    (io.mkdirSync ?? fs.mkdirSync)(path.dirname(stampAbs), { recursive: true });
    (io.writeFileSync ?? fs.writeFileSync)(stampAbs, `${JSON.stringify(info, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 比较本地与远端构建标记，给出「远端是否更新」。只在**能排出先后**时才说更新：
 * 优先 built_at（ISO 时间），退而 run_id（nightly 递增）；只有 commit 不同不足以判先后，跳过。
 * @param {{built_at: string, commit: string, run_id: string} | null} local
 * @param {{built_at: string, commit: string, run_id: string} | null} remote
 * @returns {{update: boolean, reason: string}}
 */
export function compareShellBuildInfo(local, remote) {
  if (!remote) {
    return { update: false, reason: "远端构建信息读不到，跳过更新" };
  }
  if (!local) {
    return { update: false, reason: "本地没有构建标记（先用 fetch-daily-shell 取一次壳建立基线）" };
  }
  const lt = Date.parse(local.built_at);
  const rt = Date.parse(remote.built_at);
  if (Number.isFinite(lt) && Number.isFinite(rt)) {
    return rt > lt
      ? { update: true, reason: `远端壳更新（${remote.built_at} > ${local.built_at}）` }
      : { update: false, reason: "本地壳已是远端最新构建" };
  }
  const lRun = Number(local.run_id);
  const rRun = Number(remote.run_id);
  if (local.run_id && remote.run_id && Number.isFinite(lRun) && Number.isFinite(rRun)) {
    return rRun > lRun
      ? { update: true, reason: `远端壳更新（run ${remote.run_id} > ${local.run_id}）` }
      : { update: false, reason: "本地壳已是远端最新构建" };
  }
  return { update: false, reason: "无法比较构建先后（built_at / run_id 都不可用），跳过更新" };
}

/**
 * 启动前检查：本地壳过期 && 远端有更新的构建 ⇒ 该取壳。任何一步读不到都返回 shouldUpdate:false，
 * 绝不抛 —— 调用方据此决定要不要进入取壳分支，其余情况一律照常启动。
 *
 * @param {{root?: string, out?: string, repo?: string, tag?: string, token?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, fetchImpl?: typeof fetch, configPaths?: string[], readFileSync?: typeof fs.readFileSync}} [io]
 */
export async function checkDevShellUpdate(io = {}) {
  const root = path.resolve(io.root ?? ROOT);
  const outRaw = io.out ?? DEFAULT_OUT;
  const outAbs = path.isAbsolute(outRaw) ? outRaw : path.resolve(root, outRaw);
  const stampAbs = stampPathOf(outAbs);
  const repo = io.repo ?? DEFAULT_REPO;
  const tag = io.tag ?? DEFAULT_TAG;
  /**
   * @param {string} reason
   * @param {Record<string, unknown>} [extra]
   */
  const skip = (reason, extra = {}) => ({
    shouldUpdate: false,
    reason,
    outAbs,
    stampAbs,
    repo,
    tag,
    local: null,
    remote: null,
    ...extra,
  });

  const stale = shellStaleWarning(outAbs, root);
  if (!stale) {
    return skip("本地壳未过期，无需检查远端", { stale });
  }

  const env = io.env ?? process.env;
  const platform = io.platform ?? process.platform;
  const configPaths = io.configPaths ?? tokenConfigPaths(env, platform);
  const { token, from } = resolveToken(env, io.token ?? "", { configPaths, platform });
  if (!token) {
    return skip("缺 CNB Release 令牌，跳过远端检查（照常启动）", { stale });
  }

  const url = buildDownloadUrl({
    asset: BUILD_INFO_ASSET,
    endpoint: resolveEndpoint(env),
    repo,
    tag,
  });
  let got;
  try {
    got = await downloadToBuffer(url, { fetchImpl: io.fetchImpl ?? fetch, token });
  } catch {
    return skip("远端构建信息请求失败，跳过更新（照常启动）", { stale });
  }
  if (!got.ok || !("bytes" in got)) {
    return skip(`远端构建信息读不到（HTTP ${String(got.status)}），跳过更新`, { stale });
  }

  const remote = parseShellBuildInfo(got.bytes ?? "");
  const local = readShellStamp(stampAbs, { readFileSync: io.readFileSync });
  /* 没有本地构建标记 = 这份壳不是本工具取的（或取壳工具还没落标记）。这种「基线未知」
     不该让功能永远不触发：拿一次最新壳把基线建起来，后续启动才比得出先后。 */
  if (local === null && remote !== null) {
    return {
      update: true,
      shouldUpdate: true,
      reason: "本地没有构建标记，取最新壳建立基线",
      stale,
      local,
      remote,
      outAbs,
      stampAbs,
      token,
      tokenFrom: from,
      repo,
      tag,
    };
  }
  const cmp = compareShellBuildInfo(local, remote);
  return {
    ...cmp,
    shouldUpdate: cmp.update,
    stale,
    local,
    remote,
    outAbs,
    stampAbs,
    token,
    tokenFrom: from,
    repo,
    tag,
  };
}

/**
 * 检查 + 取壳。取壳走 `fetch-daily-shell.mjs` 的 main()（与 .ps1 / pnpm 脚本同一实现），
 * 成功后写本地构建标记，让下一次启动能比较。取壳失败照常启动。
 *
 * @param {{root?: string, out?: string, repo?: string, tag?: string, token?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, fetchImpl?: typeof fetch, configPaths?: string[], readFileSync?: typeof fs.readFileSync, writeFileSync?: typeof fs.writeFileSync, mkdirSync?: typeof fs.mkdirSync, fetchShell?: (argv: string[]) => Promise<number>, log?: (message: string) => void}} [io]
 */
export async function runDevShellAutoUpdate(io = {}) {
  const log = io.log ?? ((message) => process.stdout.write(`${message}\n`));
  const check = await checkDevShellUpdate(io);
  if (!check.shouldUpdate) {
    log(`[dev-shell-update] 跳过更新：${check.reason}`);
    return { updated: false, reason: check.reason };
  }
  log(`[dev-shell-update] 检测到新壳：${check.reason}`);

  const fetchShell =
    io.fetchShell ??
    (async (argv) => {
      const { main } = await import("../devtools/fetch-daily-shell.mjs");
      return main({
        argv,
        env: io.env,
        cwd: io.root,
        fetchImpl: io.fetchImpl,
        platform: io.platform,
      });
    });
  const argv = ["--out", check.outAbs, "--repo", check.repo, "--tag", check.tag];
  let code;
  try {
    code = await fetchShell(argv);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`[dev-shell-update] 取壳失败（${detail}），照常用现有壳启动。`);
    return { updated: false, reason: `取壳失败：${detail}` };
  }
  if (code !== 0) {
    log(`[dev-shell-update] 取壳失败（退出码 ${String(code)}），照常用现有壳启动。`);
    return { updated: false, reason: `取壳失败（退出码 ${String(code)}）` };
  }

  if (check.remote) {
    writeShellStamp(check.stampAbs, check.remote, {
      writeFileSync: io.writeFileSync,
      mkdirSync: io.mkdirSync,
    });
  }
  log("[dev-shell-update] ✓ 新壳已就位，接下来用更新后的 app.exe 启动。");
  return { updated: true, reason: "新壳已就位", remote: check.remote };
}

const isEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isEntry) {
  try {
    await runDevShellAutoUpdate();
  } catch (error) {
    /* 启动前检查绝不阻塞启动：异常也只念出来，退出码保持 0，调用方照常启动壳。 */
    const detail = error instanceof Error ? error.message : String(error);
    process.stdout.write(`[dev-shell-update] 检查异常（${detail}），照常启动。\n`);
  }
}
