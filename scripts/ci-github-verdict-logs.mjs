#!/usr/bin/env node
/**
 * `ci-github-verdict-logs.mjs` —— 判决回读判红时，把**失败 job 的 Actions 日志**变成可排障的读数。
 *
 * ## 为什么不是「直接 console.log 全量」
 *
 * 2026-11-05 实测（CNB 自托管节点，`cnb build start-build` 临时流水线，build
 * `cnb-5le-1k6l64o12`）：
 *
 * - **单 stage 日志封顶 102400 字节**，超界时平台**保留头部 + 一行
 *   `The log length exceeds the limit(102400)` + `......` + 尾部**，stage 仍是 **success**
 *   （静默截断，不红；不是整行丢弃，也不是直接打断）。
 * - 单行 8 KiB / 64 KiB / 1 MiB 的探针：8 KiB / 64 KiB 原样保留；1 MiB 那一行被截到
 *   约 102398 字符，首部的 `HEAD-C` 与尾部的 `TAIL-C` 都在（字节与行同受这一个上限）。
 * - 6 个 stage 各自独立封顶：**上限是按 stage 计的**，不是整条流水线共享。
 *
 * 失败 job 的日志动辄几 MB —— 直接往 stage 日志里打，用户看到的只会是「头 + 省略 + 尾」，
 * 中间的真因恰好被吞。所以这里的通道是：**stage 里给能直接排障的那一段**（摘要 + 失败注解 +
 * 失败 step 窗口，窗口总字节压在 {@link STAGE_WINDOW_MAX_BYTES} = 60 KiB 内），**全量给
 * GA 自己的日志端点**（`GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`，需
 * `actions: read`）+ 一份本地脱敏落盘（构建结束即回收）。
 *
 * 「落文件 + 附件」那条路在这一档上**实测不可用**（2026-11-05，build `cnb-l4r-1k6lcffnv`）：
 * `cnbcool/attachments` 那类上传格要 docker，自托管节点没开容器能力，0s 红
 * `Runner does not enable Docker.`。「按行切块、分多条 stage 打印」同样不成立：30 MB ÷
 * 100 KB ≈ 300 个 stage，而 `.cnb.yml` 是静态清单、不会按日志大小长出来。
 *
 * ## 边界
 *
 * 1. **日志取不到 ≠ 判红**。令牌缺 `actions: read`（401/403）/ 404 / 网络不通，都只多一行
 *    「缺了什么、缺因为什么（HTTP 状态）」，**不改三态判定与退码**；本模块永不抛异常。
 * 2. **「取不到」与「取到了但为空」分开念**：前者带 HTTP / 网络错误，后者是 200 + 空正文。
 * 3. **落盘的是脱敏后的正文**（硬规则 17）：精确令牌值与 `ghp_…` / `github_pat_…` 形状
 *    一律 `<redacted>`；文件写在 `.comfy-ci/tmp/github-verdict-logs/`（gitignore 内，
 *    不进仓库），**每次回读先清空上一次的文件**（单 run 只留一份，防大文件堆积）。
 * 4. **stage 里始终直接可见**：哪条 run / 哪个 job / 哪个 step 失败、全部 `##[error]` 注解、
 *    以及失败 step 的原始日志窗口。窗口超 {@link STAGE_WINDOW_MAX_BYTES} 时保留首尾并
 *    明示「已截到 N 行 / 上限 M 字节（全量见下载端点）」，每个失败 job 另打一行下载端点。
 * 5. **只回读主路径（runs API）**：Checks API 的 check-run 没有 job 日志端点。
 */
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { requestJson, requestText } from "./ci-github-verdict-request.mjs";

/** 落盘文件里单 job 日志的字节上限（64 MiB）：正常失败日志远小于它，超界时保留首尾并明示。 */
export const JOB_LOG_FILE_MAX_BYTES = 64 * 1024 * 1024;

/** 一次回读落盘的总量上限（256 MiB）：多 job 都超界时也不至于把磁盘写爆。 */
export const RUN_LOGS_TOTAL_MAX_BYTES = 256 * 1024 * 1024;

/**
 * stage 日志里「失败 step 窗口」的字节预算（60 KiB）。
 *
 * 取法：CNB 单 stage 封顶 102400 字节（实测），本格还要打 run / job / step / 注解
 * 与落盘路径，留 40 KiB 给这些读数 ⇒ 窗口压到 60 KiB 以内，保证窗口**自己**完整可见。
 */
export const STAGE_WINDOW_MAX_BYTES = 60 * 1024;

/** 失败窗口找不到 `##[group]` 边界时，兜底取末这么多行（没有边界时末段最接近真因）。 */
export const FAILURE_WINDOW_TAIL_LINES = 200;

/** 窗口截断时保留的首尾行数（与 `truncateJobLog` 同一族口径）。 */
export const WINDOW_HEAD_LINES = 60;
export const WINDOW_TAIL_LINES = 160;

/** 落盘目录（相对检出根，`.comfy-ci/` 在 `.gitignore` 内）。 */
export const JOB_LOGS_DIR_REL = ".comfy-ci/tmp/github-verdict-logs";

/** 落盘文件名（一次回读一份）。 */
export const JOB_LOGS_FILE_NAME = "verdict-logs.txt";

/** 判定文件（回读格只**写**它、退码 0；`ci-github-verdict-decide.mjs` 读它、退真码）。 */
export const VERDICT_DECISION_FILE_NAME = "decision.json";

/**
 * 压缩分块的单块 base64 字节上限：**90000**。
 *
 * 取法：CNB 单 stage 日志封顶 102400 字节（实测），一块还要摊上首部读数（块号 / 校验和 /
 * 整包尺寸，约 200 字节）与 base64 按 120 字符折行带来的约 0.8% 换行开销
 * （90000 × 1.008 ≈ 90720）⇒ 单 stage 合计约 91 KiB，留 11 KiB 余量给平台自己那行。
 */
export const LOG_CHUNK_MAX_BYTES = 90_000;

/** base64 每行字符数（折行只为让日志可读 / 可复制，不改变字节语义）。 */
export const LOG_CHUNK_WRAP_CHARS = 120;

/**
 * 静态分块 stage 的块数（`.cnb.yml` 里就这么多格）——**别搞出几十个**。
 *
 * 取法（2026-11-05 用真实失败 job 日志实测）：两条判红 run / 4 个失败 job 的全量脱敏正文本
 * **616395 字节** → gzip 118375 → base64 157836 → **2 块**。3 块 = 270000 base64 字节
 * ≈ 200 KB gzip ≈ 按实测 5.2:1 的压缩比约 **1 MB 原文**，覆盖到现实现场之上还有余量；
 * 超出的那一档照实念「只有前 3 块」，全量仍走每个 job 的下载端点（不静默丢）。
 */
export const LOG_CHUNK_STATIC_STAGES = 3;

/** 分块落地目录（相对检出根，与全量正文同一个 `tmp` 子树，gitignore 内）。 */
export const LOG_CHUNKS_DIR_REL = `${JOB_LOGS_DIR_REL}/chunks`;

/** 分块清单文件名（块数 / 整包 sha256 / 尺寸都在它里面）。 */
export const LOG_MANIFEST_FILE_NAME = "manifest.json";

/** `ghp_…` / `github_pat_…` 这类令牌形状（脱敏兜底；精确令牌值另有一跳）。 */
const TOKEN_SHAPES = [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu];

/** 本仓检出根（`scripts/` 的上一层）。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 是不是一个可按键取值的对象（API 回话里的条目都是 `unknown`，先过这一跳）。
 *
 * @param {unknown} value 任意值
 * @returns {value is Record<string, unknown>} true ⇒ 对象（非 null / 非数组之外的标量）
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * 数组读数（不是数组时给空表 —— 调用方不必再判一次）。
 *
 * @param {unknown} value 任意值
 * @returns {Array<unknown>} 列表
 */
function asList(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * job 清单 URL。
 *
 * @param {string} repo `owner/repo`
 * @param {string | number} runId workflow run 的 id
 * @returns {string} API URL
 */
export function runJobsUrl(repo, runId) {
  return `https://api.github.com/repos/${repo}/actions/runs/${String(runId)}/jobs?per_page=100`;
}

/**
 * 单 job 日志 URL（`/actions/jobs/{job_id}/logs`，需 `actions: read`）。
 *
 * @param {string} repo `owner/repo`
 * @param {string | number} jobId job 的 id
 * @returns {string} API URL
 */
export function jobLogUrl(repo, jobId) {
  return `https://api.github.com/repos/${repo}/actions/jobs/${String(jobId)}/logs`;
}

/**
 * 抹掉令牌：**精确值**先抹（环境变量里那一串），再抹 `ghp_…` / `github_pat_…` 形状 ——
 * 日志里可能带别的令牌片段，形状兜底不留空档。落盘前必须过这一跳。
 *
 * @param {unknown} text 原始文本
 * @param {string} token 当前令牌（只用来精确替换，不参与回显）
 * @returns {string} 脱敏后的文本
 */
export function redactSecrets(text, token) {
  let out = String(text ?? "");
  if (token && token.length >= 8) {
    out = out.split(token).join("<redacted>");
  }
  for (const shape of TOKEN_SHAPES) {
    out = out.replace(shape, "<redacted>");
  }
  return out;
}

/**
 * 按字节上限截断一段文本：未超界原样返回；超界保留首尾并明示截了多少。
 * 单行超长时只在整体超界的情形下再压行（防「一行几十 MB」）。
 *
 * @param {string} text 已脱敏的日志正文
 * @param {number} maxBytes 字节上限
 * @returns {{bytes: number, shownLines: number, text: string, totalLines: number, truncated: boolean}} 截断结果
 */
export function truncateJobLog(text, maxBytes = JOB_LOG_FILE_MAX_BYTES) {
  const raw = String(text ?? "");
  const bytes = Buffer.byteLength(raw, "utf8");
  const lines = raw.split("\n");
  const totalLines = raw === "" ? 0 : lines.length;
  if (bytes <= maxBytes) {
    return { bytes, shownLines: totalLines, text: raw, totalLines, truncated: false };
  }
  const head = lines.slice(0, WINDOW_HEAD_LINES);
  const tail = lines.slice(-WINDOW_TAIL_LINES);
  const omitted = Math.max(0, totalLines - head.length - tail.length);
  const marker = `…（中间省略 ${String(omitted)} 行）…`;
  /** @param {string} line 一行正文 @returns {string} 压到单行上限后的正文 */
  const shortenLine = (line) =>
    line.length > 4000 ? `${line.slice(0, 4000)}…（本行已截到 4000 字符）` : line;
  return {
    bytes,
    shownLines: head.length + tail.length,
    text: [...head.map(shortenLine), marker, ...tail.map(shortenLine)].join("\n"),
    totalLines,
    truncated: true,
  };
}

/**
 * 从一段 job 日志里抽出「失败窗口」：优先取 `##[error]` 所在的 `##[group]` 段
 * （GitHub 把每一步的日志用 `##[group]Run …` 包起来），找不到边界时取末
 * {@link FAILURE_WINDOW_TAIL_LINES} 行。窗口不受 stage 预算以外的任何截断。
 *
 * @param {string} text 已脱敏的日志正文
 * @returns {{errors: string[], lines: string[], startLine: number}} `errors` 是全部 `##[error]` 行（注解）
 */
export function extractFailureWindow(text) {
  const lines = String(text ?? "").split("\n");
  const errors = lines.filter((line) => line.includes("##[error]"));
  const errIdx = lines.findIndex((line) => line.includes("##[error]"));
  if (errIdx === -1) {
    const start = Math.max(0, lines.length - FAILURE_WINDOW_TAIL_LINES);
    return { errors, lines: lines.slice(start), startLine: start + 1 };
  }
  let start = 0;
  for (let i = errIdx; i >= 0; i -= 1) {
    if (lines[i]?.startsWith("##[group]")) {
      start = i;
      break;
    }
  }
  let end = lines.length;
  for (let i = errIdx; i < lines.length; i += 1) {
    if (lines[i]?.startsWith("##[endgroup]")) {
      end = i + 1;
      break;
    }
  }
  return { errors, lines: lines.slice(start, end), startLine: start + 1 };
}

/**
 * 把失败窗口压进 stage 预算：超界保留首尾，写「已截到 N 行 / 上限 M 字节（全量见下载端点）」。
 *
 * `maxBytes` 是**这一格还剩多少**预算（多 run / 多失败 job 共用同一个 stage）——
 * 缺省是 {@link STAGE_WINDOW_MAX_BYTES}，但调用方必须传剩余值：否则第二个窗口会把
 * 总量顶过 CNB 的 102400 字节上限，头部读数与「全量日志已落盘」那一行先被吞掉。
 *
 * @param {{errors: string[], lines: string[], startLine: number}} win 失败窗口
 * @param {number} [maxBytes] 这一窗可用的字节上限
 * @returns {{errors: string[], lines: string[], shownLines: number, totalLines: number, truncated: boolean, maxBytes: number}} 可打印的窗口
 */
export function capStageWindow(win, maxBytes = STAGE_WINDOW_MAX_BYTES) {
  const text = win.lines.join("\n");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return {
      errors: win.errors,
      lines: win.lines,
      shownLines: win.lines.length,
      totalLines: win.lines.length,
      truncated: false,
      maxBytes,
    };
  }
  const maxLines = Math.max(1, Math.min(WINDOW_TAIL_LINES, win.lines.length - 1));
  /** 先取尾（失败 step 的真因就在尾部），再按剩余字节补头部。 */
  const tail = win.lines.slice(-maxLines);
  const marker = `…（失败窗口中间省略 ${String(win.lines.length)} 行；全量见下载端点）…`;
  let head = win.lines.slice(0, WINDOW_HEAD_LINES);
  let lines = [...head, marker, ...tail];
  /**
   * 逐行让位，直到落进这一窗的字节预算（保留末尾 = 保留最接近真因的那几行）。
   *
   * @param {string[]} arr 行数组
   * @returns {number} 这些行按换行拼起来的 UTF-8 字节数
   */
  const bytesOf = (arr) => Buffer.byteLength(arr.join("\n"), "utf8");
  while (bytesOf(lines) > maxBytes && head.length > 0) {
    head = head.slice(0, -1);
    lines = [...head, marker, ...tail];
  }
  while (bytesOf(lines) > maxBytes && tail.length > 1) {
    tail.shift();
    lines = [...head, marker, ...tail];
  }
  if (bytesOf(lines) > maxBytes && tail.length > 0) {
    /* 只剩一行仍超界（单行几 MB 那种）：硬压这一行，压到进预算为止。 */
    let line = String(tail.at(-1) ?? "");
    while (line.length > 0 && bytesOf([...head, marker, line]) > maxBytes) {
      line = line.slice(0, Math.max(0, line.length - 500));
    }
    tail[tail.length - 1] = `${line}…（本行已截短）`;
    lines = [...head, marker, ...tail];
  }
  return {
    errors: win.errors,
    lines,
    shownLines: head.length + tail.length,
    totalLines: win.lines.length,
    truncated: true,
    maxBytes,
  };
}

/**
 * 把一次读数的失败形态翻译成**一行可读的缺因**（带 HTTP 状态 / 网络错误原文）。
 *
 * @param {(line: string) => void} log 日志出口
 * @param {string} what 缺的是什么（`job 列表` / `job「…」日志`）
 * @param {{kind?: string, status?: number, error?: string}} res 失败读数
 * @returns {void}
 */
function noteReadFailure(log, what, res) {
  if (res.kind === "auth") {
    log(
      `[verdict]   ${what}取不到：HTTP ${String(res.status)}（令牌缺 actions: read）—— 缺的只是日志，判决不受影响`,
    );
    return;
  }
  if (res.kind === "http") {
    const hint = res.status === 404 ? "（job / run 不在，或日志已过期）" : "";
    log(
      `[verdict]   ${what}取不到：HTTP ${String(res.status)}${hint}—— 缺的只是日志，判决不受影响`,
    );
    return;
  }
  log(`[verdict]   ${what}取不到：网络没通（${String(res.error ?? "未知")}）—— 缺的只是日志，判决不受影响`);
}

/**
 * 真身落盘：先清掉上一次的文件（单 run 只留一份，防大文件堆积），再写这一份。
 *
 * @param {string} text 已脱敏的全量日志
 * @returns {string} 落盘路径（相对检出根）
 */
function writeLogsFile(text) {
  const dir = path.join(ROOT, JOB_LOGS_DIR_REL);
  rmSync(dir, { force: true, recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, JOB_LOGS_FILE_NAME), text, "utf8");
  return `${JOB_LOGS_DIR_REL}/${JOB_LOGS_FILE_NAME}`;
}

/**
 * base64 折行（纯函数）：只换行、不改字符 —— 拼回来必须与原串逐字相同。
 *
 * @param {string} text base64 正文
 * @param {number} [width] 每行字符数
 * @returns {string} 折行后的正文
 */
export function wrapBase64(text, width = LOG_CHUNK_WRAP_CHARS) {
  const raw = String(text ?? "");
  /** @type {string[]} */
  const lines = [];
  for (let i = 0; i < raw.length; i += width) {
    lines.push(raw.slice(i, i + width));
  }
  return lines.join("\n");
}

/**
 * 把全量正文压成可打印的分块包（纯函数）：`gzip` → `base64` → 按
 * {@link LOG_CHUNK_MAX_BYTES} 切块。
 *
 * 为什么是「只取失败 job 的日志」而不是整 run：`dumpFailingRunLogs` 交进来的
 * `archiveText` 本来就只含**判红 job** 的正文（成功的 job 不进这份），所以这里压的是
 * 真因那一半，体积与压缩比都按它算。
 *
 * 校验和取 **gzip 包**的 sha256（不是原文的）：拼回那一步只要「拼接 base64 → decode →
 * 对 sha256」，不必先解压再核对；解压后再拿 `rawBytes` 核字数即可。
 *
 * @param {string} text 已脱敏的全量正文
 * @returns {{base64Bytes: number, chunks: string[], gzipBytes: number, rawBytes: number, sha256: string}} 分块包
 */
export function packFailingLogs(text) {
  const raw = String(text ?? "");
  const gzip = gzipSync(Buffer.from(raw, "utf8"), { level: 9 });
  const base64 = Buffer.from(gzip).toString("base64");
  /** @type {string[]} */
  const chunks = [];
  for (let i = 0; i < base64.length; i += LOG_CHUNK_MAX_BYTES) {
    chunks.push(base64.slice(i, i + LOG_CHUNK_MAX_BYTES));
  }
  return {
    base64Bytes: base64.length,
    chunks,
    gzipBytes: gzip.length,
    rawBytes: Buffer.byteLength(raw, "utf8"),
    sha256: createHash("sha256").update(gzip).digest("hex"),
  };
}

/**
 * 分块清单（纯函数）：块数 / 印几块 / 整包 sha256 / 尺寸 / 拼回命令，一次写全。
 *
 * 清单要能回答三个问题，缺一个就没法重建：**一共几块**（少一块就拼不回去）、
 * **这一跑只印了几块**（超出静态格数时不许假装齐了）、**拼回来该是什么**（校验和）。
 *
 * @param {{base64Bytes: number, chunks: string[], gzipBytes: number, rawBytes: number, sha256: string}} pack 分块包
 * @param {number} [printed] 静态 stage 能印的块数
 * @returns {{base64Bytes: number, chunkCount: number, gzipBytes: number, printedChunks: number, rawBytes: number, reconstruct: string, sha256: string, truncated: boolean, version: number}} 清单
 */
export function buildChunkManifest(pack, printed = LOG_CHUNK_STATIC_STAGES) {
  const chunkCount = pack.chunks.length;
  const printedChunks = Math.min(chunkCount, printed);
  return {
    version: 1,
    chunkCount,
    printedChunks,
    truncated: chunkCount > printedChunks,
    rawBytes: pack.rawBytes,
    gzipBytes: pack.gzipBytes,
    base64Bytes: pack.base64Bytes,
    sha256: pack.sha256,
    reconstruct:
      "按 chunk-1.b64 … chunk-N.b64 顺序拼接（去掉换行）→ base64 解码 → gunzip → 取 sha256 核对",
  };
}

/**
 * 真身落分块：与全量正文同一个 `tmp` 子树，**每次先清空上一次的块**（单 run 只留一份）。
 *
 * @param {{base64Bytes: number, chunks: string[], gzipBytes: number, rawBytes: number, sha256: string}} pack 分块包
 * @param {ReturnType<typeof buildChunkManifest>} manifest 清单
 * @returns {string} 清单落盘路径（相对检出根）
 */
function writeChunkFiles(pack, manifest) {
  const dir = path.join(ROOT, LOG_CHUNKS_DIR_REL);
  rmSync(dir, { force: true, recursive: true });
  mkdirSync(dir, { recursive: true });
  pack.chunks.forEach((chunk, i) => {
    writeFileSync(path.join(dir, `chunk-${String(i + 1)}.b64`), wrapBase64(chunk), "utf8");
  });
  writeFileSync(path.join(dir, LOG_MANIFEST_FILE_NAME), JSON.stringify(manifest, null, 2), "utf8");
  return `${LOG_CHUNKS_DIR_REL}/${LOG_MANIFEST_FILE_NAME}`;
}

/**
 * 判红那一跑的回读入口：**永不抛异常、永不改判据**。
 *
 * stage 日志里打摘要 + 注解 + 窗口（总量压在 {@link STAGE_WINDOW_MAX_BYTES} 内）；
 * 全量正文脱敏后落一份本地文件（构建结束即回收），并逐个 job 打 GA 的日志下载端点。
 * 落盘失败也只是少一份本地文件，不改判决。
 *
 * @param {{token: string, log: (line: string) => void, fetchImpl: typeof fetch, sleep: (ms: number) => Promise<void>, writeLogFile?: (text: string) => string, writeLogChunks?: (pack: ReturnType<typeof packFailingLogs>, manifest: ReturnType<typeof buildChunkManifest>) => string, root?: string}} io 注入面
 * @param {string} repo `owner/repo`
 * @param {Array<unknown>} runs 主路径读到的本跑（`main.runs`）
 * @param {ReadonlySet<string>} redConclusions 判红词表（与主路径同一份，不抄第二份）
 * @returns {Promise<void>} 到点兑现
 */
export async function dumpFailingRunLogs(io, repo, runs, redConclusions) {
  try {
    const redRuns = runs.filter(
      (run) => isRecord(run) && redConclusions.has(String(run.conclusion)),
    );
    if (redRuns.length === 0) {
      io.log(
        "[verdict] 回读 job 日志：主路径这一轮没有判红的 run 对象（只回读 conclusion）—— 判决不受影响",
      );
      return;
    }
    const writeLogFile = io.writeLogFile ?? writeLogsFile;
    /** 落盘的全量正文（多 run / 多 job 串成一份）。 */
    const archive = [
      "# GitHub Actions 失败日志回读（全量正文，已脱敏）",
      `# 单 job 文件上限 ${String(JOB_LOG_FILE_MAX_BYTES / 1024 / 1024)} MB；stage 窗口上限 ${String(STAGE_WINDOW_MAX_BYTES / 1024)} KiB（CNB 单 stage 实测 102400 字节）`,
    ];
    let archiveBytes = 0;
    let archiveFiles = 0;
    /** stage 日志里还能打多少字节窗口（避免把这一段自己顶到 CNB 的 102400 上限）。 */
    let stageBudget = STAGE_WINDOW_MAX_BYTES;
    io.log(
      `[verdict] ── 回读失败 job 日志：${String(redRuns.length)} 条判红的 run（stage 窗口上限 ${String(STAGE_WINDOW_MAX_BYTES / 1024)} KiB，全量见每个 job 的下载端点）──`,
    );
    for (const run of redRuns) {
      if (!isRecord(run)) {
        continue;
      }
      const runId = run.id;
      const title = String(run.display_title ?? "");
      if (runId === undefined || runId === null) {
        io.log("[verdict]   run 回话里没有 id —— 跳过 job 日志（只回读 conclusion）");
        continue;
      }
      io.log(`[verdict] ── run ${String(runId)} 的失败 job 日志${title === "" ? "" : `（${title}）`}──`);
      // oxlint-disable-next-line no-await-in-loop -- 回读逐 run 串行，并行会把输出顺序打乱
      const res = await requestJson(io, runJobsUrl(repo, String(runId)), "job 列表");
      if (!res.ok) {
        noteReadFailure(io.log, "job 列表", res);
        continue;
      }
      const body = isRecord(res.body) ? res.body : {};
      const jobs = asList(body.jobs);
      if (jobs.length === 0) {
        io.log("[verdict]   job 列表读到了但为空（0 个 job）—— 与「取不到」不是同一形");
        continue;
      }
      const failed = jobs.filter(
        (job) =>
          isRecord(job) &&
          job.status === "completed" &&
          redConclusions.has(String(job.conclusion)),
      );
      if (failed.length === 0) {
        io.log(`[verdict]   这条 run 的 ${String(jobs.length)} 个 job 里没有判红的（日志无对象）`);
        continue;
      }
      for (const job of failed) {
        if (!isRecord(job)) {
          continue;
        }
        const name = String(job.name ?? "(未命名 job)");
        io.log(`[verdict]   ✗ job「${name}」（${String(job.conclusion)}）`);
        for (const step of asList(job.steps)) {
          if (!isRecord(step)) {
            continue;
          }
          if (redConclusions.has(String(step.conclusion))) {
            io.log(
              `[verdict]     失败 step #${String(step.number ?? "?")}「${String(step.name ?? "(未命名 step)")}」（${String(step.conclusion)}）`,
            );
          }
        }
        if (job.id === undefined || job.id === null) {
          io.log(`[verdict]   job「${name}」没有 id —— 跳过日志（只回读 conclusion）`);
          continue;
        }
        // oxlint-disable-next-line no-await-in-loop -- 日志逐 job 串行取，并行会把输出顺序打乱
        const logRes = await requestText(io, jobLogUrl(repo, String(job.id)), `job「${name}」日志`);
        if (!logRes.ok) {
          noteReadFailure(io.log, `job「${name}」日志`, logRes);
          continue;
        }
        if (logRes.text.trim() === "") {
          io.log(`[verdict]   job「${name}」日志取到了但为空（0 行）—— 与「取不到」不是同一形`);
          continue;
        }
        const clean = redactSecrets(logRes.text, io.token);
        /* 全量通道 = GA 的日志端点本身（这一档上没 docker：`cnbcool/attachments` 那类上传格
         * 0s 就红 `Runner does not enable Docker.`）。给 URL，不再把正文印第二遍。 */
        io.log(
          `[verdict]     全量下载：${jobLogUrl(repo, String(job.id))}（需 actions: read；共 ${String(clean.split("\n").length)} 行 / ${String(Buffer.byteLength(clean, "utf8"))} 字节）`,
        );
        if (archiveBytes < RUN_LOGS_TOTAL_MAX_BYTES) {
          const cut = truncateJobLog(clean, JOB_LOG_FILE_MAX_BYTES);
          archiveBytes += cut.bytes;
          archiveFiles += 1;
          archive.push(
            "",
            `== run ${String(runId)} / job「${name}」（${String(job.conclusion)}）==`,
            cut.truncated
              ? `# 已截到 ${String(cut.shownLines)} 行 / 上限 ${String(JOB_LOG_FILE_MAX_BYTES)} 字节（原始 ${String(cut.totalLines)} 行 / ${String(cut.bytes)} 字节）`
              : `# ${String(cut.totalLines)} 行 / ${String(cut.bytes)} 字节`,
            cut.text,
          );
        } else {
          io.log(
            `[verdict]   job「${name}」日志不再落盘：本次总量已到上限 ${String(RUN_LOGS_TOTAL_MAX_BYTES / 1024 / 1024)} MB（判决不受影响）`,
          );
        }
        const raw = extractFailureWindow(clean);
        /* 注解也要计预算：它们是「谁红、红在哪」的读数，但**不能**把窗口挤掉 ——
         * 两者共用同一个 stage（CNB 102400 字节实测上限），谁先花完谁让位。 */
        let shownErrors = 0;
        for (const line of raw.errors) {
          const cost = Buffer.byteLength(line, "utf8") + 1;
          if (stageBudget - cost <= 0) {
            break;
          }
          stageBudget -= cost;
          shownErrors += 1;
          io.log(`[verdict]     失败注解：${line}`);
        }
        if (shownErrors < raw.errors.length) {
          io.log(
            `[verdict]     其余 ${String(raw.errors.length - shownErrors)} 条注解不再打（stage 预算用尽；全量见下载端点）`,
          );
        }
        if (stageBudget <= 0) {
          io.log(`[verdict]   失败窗口不再打（stage 预算已用尽；全量见下载端点）`);
          continue;
        }
        const win = capStageWindow(raw, stageBudget);
        const body$ = win.lines.join("\n");
        const need = Buffer.byteLength(body$, "utf8");
        stageBudget -= need;
        io.log(
          `[verdict]   ── job「${name}」失败窗口（${String(win.totalLines)} 行 / ${String(need)} 字节）开始 ──`,
        );
        if (win.truncated) {
          io.log(
            `[verdict]   已截到 ${String(win.shownLines)} 行 / 上限 ${String(win.maxBytes)} 字节（全量见下载端点）`,
          );
        }
        for (const line of win.lines) {
          io.log(line);
        }
        io.log(`[verdict]   ── job「${name}」失败窗口结束 ──`);
      }
    }
    if (archiveFiles === 0) {
      io.log("[verdict] 没有取到任何 job 日志正文 —— 不落盘（判决不受影响）");
      return;
    }
    const archiveText = archive.join("\n");
    const file = writeLogFile(archiveText);
    const absPath = path.isAbsolute(file) ? file : path.join(io.root ?? ROOT, file);
    io.log(
      `[verdict] 全量日志已落盘：${absPath}（${String(archiveFiles)} 份 job / ${String(archiveBytes)} 字节）—— ` +
        `构建结束后工作区回收，跨跑请用上面每个 job 的「全量下载」端点（需 actions: read）`,
    );
    /* 全量**也**走 stage 日志：gzip → base64 → 按块进 `日志分块 1..N` 那几格。
     * 为什么要这几格：下载端点要一枚带 `actions: read` 的令牌才读得到，而「CI 上直接看见」
     * 不该再额外依赖一枚令牌；分块 + sha256 让读者能把日志里那几段拼回原文件再核对。
     * 为什么不是「几十个 stage」：单 stage 封顶 102400 字节（实测），块数按实测体积定 3；
     * 超出时只印前 3 块并明念「其余见下载端点」（不静默丢）。 */
    const pack = packFailingLogs(archiveText);
    const manifest = buildChunkManifest(pack);
    const writeChunks = io.writeLogChunks ?? writeChunkFiles;
    const manifestPath = writeChunks(pack, manifest);
    io.log(
      `[verdict] 全量可重建：原文 ${String(pack.rawBytes)} 字节 → gzip ${String(pack.gzipBytes)} → base64 ${String(pack.base64Bytes)} → ${String(manifest.chunkCount)} 块 ` +
        `（静态 ${String(LOG_CHUNK_STATIC_STAGES)} 格；整包 sha256 ${manifest.sha256}）`,
    );
    io.log(
      `[verdict]   分块清单：${manifestPath}；拼回：按 chunk-1..${String(manifest.chunkCount)}.b64 顺序拼接（去换行）→ base64 解码 → gunzip → 核对 sha256`,
    );
    if (manifest.truncated) {
      io.log(
        `[verdict]   ⚠️ 本次 ${String(manifest.chunkCount)} 块超过静态 ${String(LOG_CHUNK_STATIC_STAGES)} 格：**只印前 ${String(manifest.printedChunks)} 块**，其余全量见上面每个 job 的下载端点`,
      );
    }

  } catch (error) {
    /* 这一格只加读数：任何意外都折成一行脱敏读数，绝不改变调用方的退码。 */
    io.log(
      `[verdict] 回读 job 日志时出现异常（不影响判决）：${redactSecrets(String(error), io.token)}`,
    );
  }
}
