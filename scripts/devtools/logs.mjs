#!/usr/bin/env node
/**
 * logs.mjs — 从 log/current/<分区> 查看日志的统一入口（`pnpm logs`）。
 *
 * 此前看日志靠人肉 `Get-Content … -Tail`，落点与参数各写一套。这里只做三件事：
 * 选分区、选该分区最新一份按次命名的日志、按 tail / follow 输出。
 * 分区就是规范 §4 的布局（launcher / nextjs / services / tools / comfyui / shell / dev）。
 */
import { createReadStream, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const LOG_ROOT = path.join(ROOT, "log", "current");
export const PARTITIONS = ["comfyui", "dev", "launcher", "nextjs", "services", "shell", "tools"];

/**
 * 解析参数；未知旗标与分区不当默认值猜，直接报错。
 * @param {ReadonlyArray<string>} argv
 */
export function parseArgs(argv) {
  /** @type {{partition: string | null, follow: boolean, tail: number, help: boolean}} */
  const out = { partition: null, follow: false, tail: 40, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--follow" || arg === "-f") {
      out.follow = true;
    } else if (arg === "--tail" || arg === "-n") {
      const value = argv[i + 1];
      if (value === undefined || !/^\d+$/.test(value)) {
        throw new Error("--tail 需要一个非负整数");
      }
      out.tail = Number(value);
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`未知旗标：${arg}`);
    } else if (out.partition === null) {
      out.partition = arg;
    } else {
      throw new Error(`多余参数：${arg}`);
    }
  }
  if (out.partition !== null && !PARTITIONS.includes(out.partition)) {
    throw new Error(`未知分区：${out.partition}（可用：${PARTITIONS.join(" / ")}）`);
  }
  return out;
}

/**
 * 取分区里最近写入的一份日志；没有则 null。
 * @param {string} partition
 * @param {number} [now]
 */
export function latestLog(partition, now = Date.now()) {
  const dir = path.join(LOG_ROOT, partition);
  let best = null;
  let bestMs = -1;
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    let st;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    if (!st.isFile() || st.mtimeMs > now) {
      continue;
    }
    if (st.mtimeMs > bestMs) {
      best = file;
      bestMs = st.mtimeMs;
    }
  }
  return best;
}

/**
 * 读文件末尾 N 行：日志一般 MB 级，流式读完再取尾段（比一次 readFile 平稳）。
 * @param {string} file
 * @param {number} count
 */
export async function tailLines(file, count) {
  if (count === 0) {
    return "";
  }
  const chunks = [];
  const handle = createReadStream(file, { encoding: "utf8" });
  for await (const chunk of handle) {
    chunks.push(chunk);
  }
  const lines = chunks.join("").split(/\r?\n/);
  /* 末行可能是空串（文件以换行结尾），去掉不影响内容。 */
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.slice(-count).join("\n");
}

function helpText() {
  return [
    "用法：pnpm logs [分区] [--tail N] [--follow]",
    `分区：${PARTITIONS.join(" / ")}（缺省列出各分区最新文件）`,
    "--tail N  最近 N 行（缺省 40）",
    "--follow  跟随追加（-f）",
  ].join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }
  const partitions = opts.partition === null ? PARTITIONS : [opts.partition];
  const files = partitions
    .map((p) => ({ partition: p, file: latestLog(p) }))
    .filter((entry) => entry.file !== null);
  /* filter 之后 TS 仍把 file 当 string | null，这里显式收窄给下游用。 */
  const found = files.flatMap((entry) =>
    entry.file === null ? [] : [{ partition: entry.partition, file: entry.file }],
  );
  if (found.length === 0) {
    process.stdout.write("没有找到日志（先跑 pnpm dev:log）。\n");
    return;
  }
  /* 各分区互不依赖，并行读完再按分区顺序输出（不在循环里 await）。 */
  const bodies = await Promise.all(found.map((entry) => tailLines(entry.file, opts.tail)));
  found.forEach(({ partition, file }, index) => {
    if (opts.partition === null) {
      process.stdout.write(`=== ${partition}: ${path.relative(ROOT, file)} ===\n`);
    }
    process.stdout.write(`${bodies[index] ?? ""}\n`);
  });
  if (opts.follow) {
    /* 跟随交给系统 tail -f 的语义：这里只打印路径与提示，不自己轮询文件，
     * 避免与 §11.14 的测试裸 sleep 纪律冲突。 */
    process.stdout.write(`[logs] 跟随请用：tail -f ${found[0]?.file ?? ""}\n`);
  }
}

/* 只在被直接执行时跑：测试 import 纯函数不应产生 stdout / 子副作用。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[logs] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
