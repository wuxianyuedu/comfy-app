#!/usr/bin/env node
/**
 * `ci-print-log-chunk.mjs` —— 把回读格落下的**第 i 块**全量日志打进 stage 日志。
 *
 * ## 它为什么存在（以及为什么不是「一次打全」）
 *
 * CNB 单 stage 日志**封顶 102400 字节**（2026-11-05 实测 build `cnb-5le-1k6l64o12`：
 * 超界时 stage 仍是 success，平台保留头部 + `The log length exceeds the limit(102400)`
 * + 尾部 —— 静默截断）。失败 job 的日志动辄几百 KB，一次打全只会看到「头 + 省略 + 尾」，
 * 中间的真因恰好被吞。而「落文件 + 附件」那条路在自托管节点上**不可用**（插件格要 docker，
 * 实测 build `cnb-l4r-1k6lcffnv` 0s 红 `Runner does not enable Docker.`）。
 *
 * 所以全量通道改成 **gzip + base64 + 分块**：`GitHub 判决回读` 那格把失败 job 的正文
 * 压成 `chunk-<i>.b64` + `manifest.json`，随后固定几格（`.cnb.yml` 的 `日志分块 i/N`）
 * 各打一块。块数 / 整包 sha256 / 原文尺寸都在清单里，**拼回来能逐字核对**。
 *
 * ## 边界（这一格**不许**变成必红）
 *
 *   · **没有清单**（本跑没判红 / 没取到日志 / 回读格没跑到）⇒ 打一行「没有分块」、退 0；
 *   · **这一块不存在**（本跑块数少于静态格数）⇒ 打一行「只有 N 块」、退 0；
 *   · **块文件缺失**（清单说有、盘上没有）⇒ 打一行「缺块」、退 0 —— 判决由
 *     `ci-github-verdict-decide.mjs` 那一格退码，这里只负责把已有的事实念出来。
 *   · 只有**参数写错**（配置 bug）才退 2 —— 它不在正常路径上，用例钉着。
 *
 * 用法：`node scripts/ci-print-log-chunk.mjs <i>`（i 从 1 起，与 `日志分块 i/N` 对齐）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  LOG_CHUNKS_DIR_REL,
  LOG_MANIFEST_FILE_NAME,
} from "./ci-github-verdict-logs.mjs";

/** 本仓检出根（`scripts/` 的上一层）。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 读一行/整份文本（用例注入假件，一次真磁盘都不碰）。
 *
 * @param {string} file 绝对路径
 * @returns {string} 文本
 */
const realReadFile = (file) => String(readFileSync(file, "utf8"));

/**
 * 是不是一个可按键取值的对象（`JSON.parse` 的结果是 `unknown`，先过这一跳）。
 *
 * @param {unknown} value 任意值
 * @returns {value is Record<string, unknown>} true ⇒ 可按键取值
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * 把清单里要念的几项收口成对象（形状不对 ⇒ `null`）。
 *
 * @param {unknown} parsed `JSON.parse` 的结果
 * @returns {{chunkCount: number, printedChunks: number, gzipBytes: number, rawBytes: number, sha256: string} | null} 清单读数
 */
export function normalizeManifest(parsed) {
  if (!isRecord(parsed)) {
    return null;
  }
  const record = parsed;
  /** @type {number[]} */
  const numbers = [];
  for (const key of ["chunkCount", "printedChunks", "gzipBytes", "rawBytes"]) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return null;
    }
    numbers.push(value);
  }
  if (typeof record.sha256 !== "string" || record.sha256 === "") {
    return null;
  }
  const [chunkCount = 0, printedChunks = 0, gzipBytes = 0, rawBytes = 0] = numbers;
  return {
    chunkCount,
    printedChunks,
    gzipBytes,
    rawBytes,
    sha256: record.sha256,
  };
}

/**
 * 生成这一格要打的正文（纯函数，用例直接喂清单 / 块）。
 *
 * 三种「没有正文」都**各说各的**，不混成一句：没清单（没判红）/ 没这一块（块数不够）/
 * 块文件缺失（清单与盘对不上）。三种都不是红的理由，但都是读的人要知道的事实。
 *
 * @param {{
 *   index: number,
 *   manifest?: ReturnType<typeof normalizeManifest>,
 *   chunk?: string,
 * }} input 读数
 * @returns {string} 要写进 stage 日志的正文
 */
export function renderChunk({ index, manifest, chunk }) {
  if (manifest === null || manifest === undefined) {
    return "[chunk] 本跑没有日志分块（判决绿 / 没判红 / 没取到日志 / 回读格没跑到）—— 不是错误，判决由「GitHub 判决判定」那一格退码";
  }
  if (index > manifest.chunkCount) {
    return `[chunk ${String(index)}/${String(manifest.chunkCount)}] 这一块不存在：本跑只有 ${String(manifest.chunkCount)} 块（静态格多出来的那几格就是这一形）`;
  }
  const head =
    `[chunk ${String(index)}/${String(manifest.chunkCount)}] 失败日志全量（gzip+base64）· 整包 sha256=${manifest.sha256} · ` +
    `gzip ${String(manifest.gzipBytes)} 字节 / 原文 ${String(manifest.rawBytes)} 字节 · 本跑印 ${String(manifest.printedChunks)} 块`;
  const howto =
    `[chunk ${String(index)}/${String(manifest.chunkCount)}] 拼回：按 chunk-1..${String(manifest.chunkCount)}.b64 顺序拼接（去换行）→ base64 解码 → gunzip → 核对上面的 sha256`;
  if (chunk === undefined || chunk === "") {
    return `${head}\n${howto}\n[chunk ${String(index)}/${String(manifest.chunkCount)}] ⚠️ 块文件缺失（清单说有、盘上没有）—— 这一块只能走下载端点`;
  }
  return `${head}\n${howto}\n${chunk}`;
}

/**
 * 读清单（读不到 / 不是合法 JSON / 形状不对一律 `null`）。
 *
 * @param {(file: string) => string} readFile 读文本
 * @param {string} root 检出根
 * @returns {ReturnType<typeof normalizeManifest>} 清单读数
 */
function readManifest(readFile, root) {
  try {
    const raw = readFile(path.join(root, LOG_CHUNKS_DIR_REL, LOG_MANIFEST_FILE_NAME));
    return normalizeManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * 读一块（读不到 ⇒ 空串，调用方会念「块文件缺失」）。
 *
 * @param {(file: string) => string} readFile 读文本
 * @param {string} root 检出根
 * @param {number} index 块号
 * @returns {string} 块正文
 */
function readChunk(readFile, root, index) {
  try {
    return readFile(path.join(root, LOG_CHUNKS_DIR_REL, `chunk-${String(index)}.b64`));
  } catch {
    return "";
  }
}

/**
 * 真身：读清单 + 读这一块，交出正文与退出码（读不到盘不算错）。
 *
 * @param {number} index 块号（从 1 起）
 * @param {{readFile?: (file: string) => string, root?: string}} [io] 注入面
 * @returns {{exitCode: number, text: string}} 退出码与正文
 */
export function renderChunkFromDisk(index, io = {}) {
  const readFile = io.readFile ?? realReadFile;
  const root = io.root ?? ROOT;
  const manifest = readManifest(readFile, root);
  if (manifest === null) {
    return { exitCode: 0, text: renderChunk({ index, manifest: null }) };
  }
  if (index > manifest.chunkCount) {
    return { exitCode: 0, text: renderChunk({ index, manifest }) };
  }
  const chunk = readChunk(readFile, root, index);
  return { exitCode: 0, text: renderChunk({ index, manifest, chunk }) };
}

/**
 * 参数收口：`<i>` 必须是正整数。
 *
 * @param {string[]} argv `process.argv.slice(2)`
 * @returns {{index: number, usage: string}} 块号（0 = 参数不对）
 */
export function parseIndex(argv) {
  const usage = "用法：node scripts/ci-print-log-chunk.mjs <i>（i 从 1 起，与 .cnb.yml 的「日志分块 i/N」对齐）";
  const [first] = argv;
  const index = Number(first ?? "");
  if (!Number.isInteger(index) || index < 1) {
    return { index: 0, usage };
  }
  return { index, usage };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const { index, usage } = parseIndex(process.argv.slice(2));
  if (index === 0) {
    process.stdout.write(`${usage}\n`);
    process.exit(2);
  }
  const { exitCode, text } = renderChunkFromDisk(index);
  process.stdout.write(`${text}\n`);
  process.exit(exitCode);
}
