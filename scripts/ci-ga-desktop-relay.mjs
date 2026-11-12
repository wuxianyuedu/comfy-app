#!/usr/bin/env node
/**
 * `ci-ga-desktop-relay.mjs` —— GA 桌包档收尾把**构建成品**回传到 CNB 侧（ISSUE #3607）。
 *
 * ## 它补的是哪一格
 *
 * `pnpm tauri build`（`package-desktop.yml`）已经在 GA 的 Windows runner 上产出两类成品，
 * 但它们的落点此前只有 GitHub：run artifact（14 天、按 run 翻）+ 滚动 `nightly` Release。
 * 用户是在 **CNB** 这一侧提诉求、拿包的（ISSUE #3607：本地双击 `build-all.ps1` 得 release
 * 壳，希望「这步的产物能在 CNB 侧执行和获取」）。GitHub 对这条链是镜像仓，不是取包地。
 *
 * 本格把同一份成品复制到 CNB 的滚动 `nightly` Release —— 站内、按名字取、每天都指向
 * 最新一份。与 #3437 的日志搬运、#3102 一族的结论回调同一条「GA 写 / CNB 站内读」分工，
 * 载荷从日志/结论换成真正的二进制成品。
 *
 * ## 为什么用 CNB Release（不是制品库 / Issue 附件）
 *
 *   · Release 附件有**稳定下载 URL**（`/{repo}/-/releases/download/{tag}/{filename}`），
 *     人点开就能拿，正好对位「方便获取」；
 *   · 滚动 tag + `overwrite` = 每天一份最新，不堆历史（与 GA nightly 同形）；
 *   · 制品库（npm / generic / OCI）要客户端、要包格式，安装包是裸 exe/msi/zip，不适配；
 *   · Issue/PR 附件（#3437 那套）随评论「发布」才可读、按 PR 号找，不是成品的长久落点。
 *
 * ## 上传链路（Swagger 逐格坐实，`repo-release:rw`）
 *
 *   1. `GET /{repo}/-/releases/tags/nightly`：拿到滚动 tag 的 `id`；404 ⇒ 第 2 步建。
 *   2. `POST /{repo}/-/releases`（缺席时）：`{tag_name, name, prerelease:true, body,
 *      target_commitish}` ⇒ `id`。`target_commitish` 是服务端硬必填（swagger 的
 *      `PostReleaseForm` 有这个 property 却没标进 `required`，按 schema 抄字段极易漏）：
 *      `nightly` 这个 tag 本不存在，服务端要基于它给 tag 定目标提交 / 自动建 tag，
 *      漏带就是 400 `target_commitish is required`（ISSUE #3611 现场）。缺省取默认分支
 *      `MASTER_REF`（CNB 与镜像仓同名），可由 `CNB_RELEASE_TARGET` 覆盖；**不用
 *      `GITHUB_SHA`** —— 那是镜像仓的 commit，CNB 仓未必有同一个 sha。
 *   3. 对每个文件 `POST /{repo}/-/releases/{id}/asset-upload-url`
 *      `{asset_name, size, overwrite:true}` ⇒ `{upload_url, verify_url}`。
 *   4. `PUT <upload_url>`：二进制正文（`Content-Type: application/octet-stream`、
 *      `Content-Length`），**不带 Authorization**（预签名 URL 自带授权，见 cnb CLI 的 Yy）。
 *   5. `POST /{repo}/-/releases/{id}/asset-upload-confirmation/{upload_token}/{asset_path}?ttl=0`：
 *      `upload_token` / `asset_path` 从 `verify_url` 的路径尾段拆（CLI 明示这一口径）。
 *      确认之后附件才正式关联到版本；`ttl=0` = 永久（滚动 tag 自己轮替，不靠 TTL 淘汰）。
 *
 * ## 边界（与 `ci-ga-logs-relay.mjs` 同一口径）
 *
 *   · **不碰构建结论**：workflow 那一步带 `continue-on-error: true`。回传失败只多一行
 *     读数 + 本 step 红，绝不反过来把「桌包打出来了」判成失败，也不改本 run 的 conclusion。
 *   · **前提不全 ⇒ 没判过（2）**，不是绿：缺令牌 / 仓库 / 成品目录 / 一个成品都没有，
 *     都退 2 并逐条点名。「今天没有新包」与「今天没能把包放出去」在日志里逐字不同。
 *   · **令牌不落日志**（硬规则 17）：失败回话体先过 `redact`，令牌形状抹成 `<redacted>`。
 *   · **不猜成品名**：从盘上真读，nsis/msi 按扩展名收、portable zip 按固定落点收，
 *     文件名随 tauri 版本变化不写死。
 *
 * ## 用法（`package-desktop.yml` 的收尾 step）
 *
 * ```text
 * node scripts/ci-ga-desktop-relay.mjs            # 前提全从 env 读
 * node scripts/ci-ga-desktop-relay.mjs --dry-run  # 只打印计划，一条网络都不发
 * ```
 *
 * env：`CNB_RELEASE_TOKEN`（`repo-release:rw`，写 CNB Release；**专用**，不给其它令牌扩权）、
 * `CNB_REPO_SLUG`、`CNB_API_ENDPOINT`（缺省 `https://api.cnb.cool`）、
 * `GITHUB_RUN_ID` / `GITHUB_SHA`（进 Release 描述与文件名，便于追哪一跑）、
 * `DESKTOP_BUNDLE_DIR`（缺省 `src-tauri/target/release/bundle`）、
 * `DESKTOP_PORTABLE`（缺省 `portable/ComfyAPP-portable.zip`）、
 * `CNB_RELEASE_TARGET`（缺省默认分支 `master`；建 `nightly` tag 时的 `target_commitish`）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { CODE, MASTER_REF } from "./ci-github-mirror-push.mjs";
import { cnbRequest } from "./ci-ga-logs-relay.mjs";

/** 滚动 tag：每天都指向最新一份，与 GA nightly 同名同义。 */
export const RELEASE_TAG = "nightly";

/** 单次请求的墙钟上限（与 `cnbRequest` 同源，这里只给二进制 PUT 用）。 */
const REQUEST_TIMEOUT_MS = 60_000;

/** 安装包扩展名（`pnpm tauri build` 的 bundle 主形，Windows）。 */
const INSTALLER_EXTENSIONS = new Set([".exe", ".msi"]);

/**
 * 收集的单个成品：`assetName` 是上传时的附件名（带形态前缀，避免 nsis/msi 同名撞车），
 * `absPath` / `bytes` 供 PUT 与 `size` 用。
 *
 * @typedef {{assetName: string, absPath: string, bytes: number, kind: "installer" | "portable"}} BundleFile
 */

/**
 * 收前提。任一缺席都攒进 `reasons`（不抛、不静默补默认值）。
 *
 * `token` 专用 `CNB_RELEASE_TOKEN`（`repo-release:rw`）—— 复用 `CNB_ISSUE_TOKEN`
 * （`repo-notes:rw`）会 403，给它扩权又违反最小权限；这枚是新配的、只服务本格。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ok:true, token:string, repo:string, endpoint:string, runId:string, sha:string, bundleDir:string, portable:string, targetCommitish:string} | {ok:false, reasons:string[]}}
 */
export function resolveDesktopRelayContext(env) {
  const token = String(env.CNB_RELEASE_TOKEN ?? "").trim();
  const repo = String(env.CNB_REPO_SLUG ?? "").trim();
  const endpoint = String(env.CNB_API_ENDPOINT || "https://api.cnb.cool").replace(/\/+$/u, "");
  const runId = String(env.GITHUB_RUN_ID ?? "").trim();
  const sha = String(env.GITHUB_SHA ?? "").trim();
  const bundleDir = String(env.DESKTOP_BUNDLE_DIR || "src-tauri/target/release/bundle").trim();
  const portable = String(env.DESKTOP_PORTABLE || "portable/ComfyAPP-portable.zip").trim();
  /* 建 nightly tag 的 target_commitish：缺省默认分支，env 可覆盖（不用 GITHUB_SHA，见文件头）。 */
  const targetCommitish = String(env.CNB_RELEASE_TARGET ?? "").trim() || MASTER_REF;
  /** @type {string[]} */
  const reasons = [];
  if (!token) reasons.push("`CNB_RELEASE_TOKEN` 缺席（写 CNB Release 要 repo-release:rw）");
  if (!repo) reasons.push("`CNB_REPO_SLUG` 缺席");
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    bundleDir,
    endpoint,
    ok: true,
    portable,
    repo,
    runId,
    sha,
    targetCommitish,
    token,
  };
}

/**
 * 抹掉回话体里的令牌形状（硬规则 17）：精确值、`ghp_`/`github_pat_` 族、Bearer 尾段。
 * 只用在失败话术，成功的 JSON 由调用方按需取字段、不整包回显。
 *
 * @param {string} text
 * @param {string} token
 * @returns {string}
 */
export function redact(text, token) {
  let out = text;
  if (token) out = out.split(token).join("<redacted>");
  return out
    .replaceAll(/gh[pousr]_[A-Za-z0-9_]{20,}/gu, "<redacted>")
    .replaceAll(/github_pat_[A-Za-z0-9_]{20,}/gu, "<redacted>")
    .replaceAll(/Bearer\s+[A-Za-z0-9._-]{12,}/giu, "Bearer <redacted>");
}

/**
 * 从盘上真读两类成品，不硬编码 tauri 生成的文件名。
 *
 * 安装包：递归 `bundleDir`，只收 `.exe` / `.msi`；附件名带 `nsis-` / `msi-` 前缀，
 * 免得两种打包器偶然同名互相覆盖。免安装版：单个固定落点的 zip。
 *
 * @param {{bundleDir: string, portable: string}} paths
 * @param {string} cwd 相对落点的解析根
 * @returns {BundleFile[]}
 */
export function collectBundles({ bundleDir, portable }, cwd = process.cwd()) {
  /** @type {BundleFile[]} */
  const files = [];
  const root = path.resolve(cwd, bundleDir);
  if (fs.existsSync(root)) {
    /** @param {string} dir @param {string} rel */
    const walk = (dir, rel) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(abs, relPath);
        } else if (INSTALLER_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          const kind = path.basename(rel).toLowerCase();
          const prefix = path.basename(path.dirname(relPath)).toLowerCase() || kind;
          files.push({
            absPath: abs,
            assetName: `${prefix}-${entry.name}`,
            bytes: fs.statSync(abs).size,
            kind: "installer",
          });
        }
      }
    };
    walk(root, "");
  }
  const portableAbs = path.resolve(cwd, portable);
  if (fs.existsSync(portableAbs) && fs.statSync(portableAbs).isFile()) {
    files.push({
      absPath: portableAbs,
      assetName: path.basename(portableAbs),
      bytes: fs.statSync(portableAbs).size,
      kind: "portable",
    });
  }
  return files.sort((a, b) => a.assetName.localeCompare(b.assetName));
}

/**
 * 从 `verify_url` 拆 `upload_token` / `asset_path`（CLI 明示：这两个 path 参数从
 * 上传地址接口返回的 `verify_url` 里提取）。`asset_path` 可能含 `/`，保留整段。
 *
 * 兼容绝对 URL 与相对路径；命中不了尾段返回 null（调用方判「没判过」，不猜）。
 *
 * @param {string} verifyUrl
 * @returns {{uploadToken: string, assetPath: string} | null}
 */
export function parseVerifyUrl(verifyUrl) {
  if (typeof verifyUrl !== "string" || verifyUrl === "") return null;
  let pathname = verifyUrl;
  try {
    pathname = new URL(verifyUrl).pathname;
  } catch {
    /* 相对 verify_url：直接当路径用。 */
  }
  const marker = "/asset-upload-confirmation/";
  const at = pathname.indexOf(marker);
  if (at === -1) return null;
  const tail = pathname.slice(at + marker.length);
  const slash = tail.indexOf("/");
  if (slash <= 0 || slash === tail.length - 1) return null;
  return {
    assetPath: decodeURIComponent(tail.slice(slash + 1)),
    uploadToken: decodeURIComponent(tail.slice(0, slash)),
  };
}

/**
 * 把一句话收成对象（失败话术用，脱敏 + 截断）。
 *
 * @param {{ctx:{endpoint:string,repo:string,token:string}, fetchImpl:typeof fetch}} io
 * @param {"GET"|"PATCH"|"POST"|"PUT"} method
 * @param {string} target
 * @param {{json?:unknown}} [body]
 * @returns {Promise<{ok:true, status:number, json:unknown} | {ok:false, status:number, detail:string}>}
 */
async function jsonRequest(io, method, target, body = {}) {
  const res = await cnbRequest({ ctx: io.ctx, fetchImpl: io.fetchImpl }, method, target, body);
  if (!res.ok) {
    return { detail: redact(res.detail, io.ctx.token), ok: false, status: res.status };
  }
  return { json: res.json, ok: true, status: res.status };
}

/**
 * 是不是可按字段取值的对象（type predicate，避免 object → Record 的不安全断言）。
 *
 * @param {unknown} v 任意值
 * @returns {v is Record<string, unknown>} true ⇒ 对象
 */
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 取 release 的 `data` 字段（CNB OpenAPI 的信封：`{status, data}` 或直接对象都认）。
 *
 * @param {unknown} json
 * @returns {Record<string, unknown> | null}
 */
function unwrap(json) {
  if (!isRecord(json)) return null;
  return isRecord(json.data) ? json.data : json;
}

/**
 * 拿（或建）滚动 `nightly` Release，返回 `release_id`。
 *
 * @param {{ctx:{endpoint:string,repo:string,token:string}, fetchImpl:typeof fetch, log:(l:string)=>void}} io
 * @param {{runId:string, sha:string, targetCommitish:string}} meta
 * @returns {Promise<{ok:true, id:string, created:boolean} | {ok:false, detail:string}>}
 */
export async function ensureRelease(io, meta) {
  const api = `${io.ctx.endpoint}/${io.ctx.repo}`;
  const byTag = await jsonRequest(io, "GET", `${api}/-/releases/tags/${RELEASE_TAG}`);
  if (byTag.ok) {
    const id = String(unwrap(byTag.json)?.id ?? "");
    if (id) return { created: false, id, ok: true };
    return { detail: "按 tag 读到了 Release 但没有 id 字段", ok: false };
  }
  /* 404 = 还没有 nightly，建一份；其余（401/403/5xx/网络）不能当「没有」接着建。 */
  if (byTag.status !== 404) {
    return {
      detail: `按 tag 读 Release 失败（HTTP ${String(byTag.status)}）：${byTag.detail}`,
      ok: false,
    };
  }
  const body = [
    "桌包每日滚动成品（GA 构建 → CNB 站内回传，ISSUE #3607）。",
    `run ${meta.runId || "noid"} · sha ${meta.sha.slice(0, 12) || "noid"}`,
    "安装版 = *-setup.exe / *.msi；免安装版 = *-portable.zip（解压后双击 app.exe 即用）。",
  ].join("\n");
  const created = await jsonRequest(io, "POST", `${api}/-/releases`, {
    json: {
      body,
      name: "每日桌面成品（CNB 站内）",
      prerelease: true,
      tag_name: RELEASE_TAG,
      /* 服务端硬必填：nightly tag 不存在，要基于它定目标提交 / 自动建 tag（ISSUE #3611）。 */
      target_commitish: meta.targetCommitish,
    },
  });
  if (!created.ok) {
    return {
      detail: `创建 nightly Release 失败（HTTP ${String(created.status)}）：${created.detail}`,
      ok: false,
    };
  }
  const id = String(unwrap(created.json)?.id ?? "");
  if (!id) return { detail: "创建 Release 成功但回话没有 id 字段", ok: false };
  io.log("[ga-desktop-relay] 滚动 nightly Release 已创建");
  return { created: true, id, ok: true };
}

/**
 * 二进制 PUT 到预签名 URL。刻意**不带** Authorization（URL 自带授权，见 cnb CLI 的 Yy），
 * 也不复用 `cnbRequest`——那一层只发字符串，二进制要 Buffer 正文。
 *
 * 用 `readFileSync` 的 Buffer 而非 `createReadStream`：成品是有界的（安装包 ~85MB、
 * portable zip 同量级，远在 Node Buffer 上限内），Buffer 让 Content-Length 与正文同源、
 * 且不带「流谁消费 / 失败时谁 destroy」的生命周期问题（那一族在假件与网络抖动下会冒出
 * 未处理的 `error` 事件）。
 *
 * @param {{fetchImpl:typeof fetch, log:(l:string)=>void}} io
 * @param {{uploadUrl:string, absPath:string, bytes:number, assetName:string}} job
 * @returns {Promise<{ok:true} | {ok:false, detail:string}>}
 */
export async function putAsset(io, job) {
  try {
    const body = fs.readFileSync(job.absPath);
    const res = await io.fetchImpl(job.uploadUrl, {
      body,
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/octet-stream",
      },
      method: "PUT",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { detail: `PUT 失败（HTTP ${String(res.status)}）`, ok: false };
    }
    return { ok: true };
  } catch (error) {
    return { detail: `PUT 网络层没跑起来：${String(error)}`, ok: false };
  }
}

/**
 * 上传单个成品：取上传地址 → PUT → 确认。三步任一失败即返回失败（不假装送达）。
 *
 * @param {{ctx:{endpoint:string,repo:string,token:string}, fetchImpl:typeof fetch, log:(l:string)=>void}} io
 * @param {string} releaseId
 * @param {BundleFile} file
 * @returns {Promise<{ok:true, assetName:string, bytes:number} | {ok:false, detail:string}>}
 */
export async function uploadAsset(io, releaseId, file) {
  const api = `${io.ctx.endpoint}/${io.ctx.repo}`;
  const got = await jsonRequest(io, "POST", `${api}/-/releases/${releaseId}/asset-upload-url`, {
    json: { asset_name: file.assetName, overwrite: true, size: file.bytes },
  });
  if (!got.ok) {
    return { detail: `取上传地址失败（HTTP ${String(got.status)}）：${got.detail}`, ok: false };
  }
  const info = unwrap(got.json);
  const uploadUrl = String(info?.upload_url ?? "");
  const parsed = parseVerifyUrl(String(info?.verify_url ?? ""));
  if (!uploadUrl || !parsed) {
    return {
      detail: "上传地址回话缺 upload_url / verify_url（或 verify_url 拆不出 token/path）",
      ok: false,
    };
  }
  const put = await putAsset(io, {
    absPath: file.absPath,
    assetName: file.assetName,
    bytes: file.bytes,
    uploadUrl,
  });
  if (!put.ok) return { detail: `[${file.assetName}] ${put.detail}`, ok: false };
  const confirm = await jsonRequest(
    io,
    "POST",
    `${api}/-/releases/${releaseId}/asset-upload-confirmation/${encodeURIComponent(parsed.uploadToken)}/${parsed.assetPath}?ttl=0`,
  );
  if (!confirm.ok) {
    return {
      detail: `[${file.assetName}] 确认失败（HTTP ${String(confirm.status)}）：${confirm.detail}`,
      ok: false,
    };
  }
  io.log(`[ga-desktop-relay] 已回传 ${file.assetName}（${String(file.bytes)} 字节，${file.kind}）`);
  return { assetName: file.assetName, bytes: file.bytes, ok: true };
}

/**
 * 主流程：收前提 → 收成品 → 拿/建 Release → 逐个上传 → 确认。
 *
 * @param {{argv?:string[], env?:Record<string,string|undefined>, fetchImpl?:typeof fetch, log?:(l:string)=>void, cwd?:string}} io
 * @returns {Promise<number>} 0 送达 / 1 失败 / 2 没判过
 */
export async function main(io = {}) {
  const env = io.env ?? process.env;
  const argv = io.argv ?? process.argv.slice(2);
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
  const fetchImpl = io.fetchImpl ?? fetch;
  const cwd = io.cwd ?? process.cwd();
  const dryRun = argv.includes("--dry-run");
  const ctx = resolveDesktopRelayContext(env);
  if (!ctx.ok) {
    for (const r of ctx.reasons) log(`[ga-desktop-relay] 没判过：${r}`);
    return CODE.NO_FACT;
  }
  const files = collectBundles({ bundleDir: ctx.bundleDir, portable: ctx.portable }, cwd);
  if (files.length === 0) {
    log(
      `[ga-desktop-relay] 没判过：${ctx.bundleDir} 下没有安装包、也没有 ${ctx.portable} —— ` +
        "构建那一格没打出成品，或落点改了没同步本脚本",
    );
    return CODE.NO_FACT;
  }
  log(
    `[ga-desktop-relay] 计划回传 ${String(files.length)} 份成品到 CNB ${ctx.repo} ` +
      `滚动 Release「${RELEASE_TAG}」：${files.map((f) => f.assetName).join(", ")}`,
  );
  if (dryRun) {
    log("[ga-desktop-relay] DRY-RUN：一条网络都不发");
    return CODE.OK;
  }
  const relayCtx = { endpoint: ctx.endpoint, repo: ctx.repo, token: ctx.token };
  const wiring = { ctx: relayCtx, fetchImpl, log };
  const release = await ensureRelease(wiring, {
    runId: ctx.runId,
    sha: ctx.sha,
    targetCommitish: ctx.targetCommitish,
  });
  if (!release.ok) {
    log(`[ga-desktop-relay] 回传失败：${release.detail}`);
    return CODE.FAIL;
  }
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop -- 逐个串行上传：共享同一个 release_id，且失败即停不并发放大
    const done = await uploadAsset(wiring, release.id, file);
    if (!done.ok) {
      log(`[ga-desktop-relay] 回传失败：${done.detail}`);
      return CODE.FAIL;
    }
  }
  log(
    `[ga-desktop-relay] 已搬到 CNB：${ctx.repo} 的滚动 Release「${RELEASE_TAG}」 · ` +
      `${String(files.length)} 份 · run ${ctx.runId || "noid"} · ` +
      `下载 ${ctx.endpoint}/${ctx.repo}/-/releases/download/${RELEASE_TAG}/<文件名>`,
  );
  return CODE.OK;
}

/* 直接执行（被 import 做单测时不跑）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`[ga-desktop-relay] 没判过：${String(error)}`);
      process.exitCode = CODE.NO_FACT;
    },
  );
}
