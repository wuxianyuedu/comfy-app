/* ── 捕获进程输出流 → 应用日志面板（Node-only）──────────────────────────
 *
 * 面板「什么也没有」的三种成因里，最要命的一种是：**应用服务（Next dev
 * server）自己吐出的报错不在任何被轮询的日志文件里**。
 *
 * 首屏的编译错误、路由表失效、`FATAL: An unexpected Turbopack error`、未捕获的
 * 服务端异常、pino 的 ERROR 行——它们都只落在 `log/nextjs/nextjs-stderr-*.log`
 * 或 stdout（`nextjs-stdout-*.log`），而「应用日志」面板只轮询 launcher /
 * dev-launcher / app-runtime 三路。于是一个「应用服务没起来 / 起来了但页面拿不到
 * 数据」的现场，用户打开面板看到的是一片空白——面板反而比没有更难排查。
 *
 * 这里把两路输出接进面板可见的通道：
 *   1. **进程级**：把 `process.stdout/stderr` 的每一 chunk 原样转录进
 *      `log/nextjs/nextjs-panel-<bootId>.log`（开发期 Next dev server 的完整输出，
 *      含 pino 行）。文件按进程启动标识命名——`dev-launcher.ps1` 每次启动都会
 *      清掉历史 `nextjs-stdout-*`，这里沿用同一条命名，既对齐既有清理规则，也
 *      保证「面板只显示本次运行」的会话边界（见 log-session-scope）。
 *   2. **模块级**：把 `console.error` / `console.warn` 中「值得上报」的部分
 *      结构化补记进 app-runtime（这是给生产构建 standlone 用的，那里没有
 *      dev-launcher 的 redirect 文件）。
 *
 * 硬约束：
 *   - 本模块是 Node-only（`fs` / `process`），**禁止**被客户端图 import
 *     （见 07 §7.12 与 tests/client-bundle-node-builtins.test.ts）。
 *   - 转录**不是** console 包装：`process.stdout.write` 直接写 fd 1，不经过
 *     被 LogProvider 包装过的 console，因此不会与浏览器侧面板集成冲突，
 *     也不会改变任何既有输出行为（终端看到的输出一个字不变）。
 *   - 写入失败静默（日志子系统绝不阻塞业务主流程）。
 */

import fs from "node:fs";
import path from "node:path";

import { NEXTJS_LOG_DIR, NEXTJS_PANEL_LOG_PREFIX } from "~/lib/log/log-paths";

/** 转录文件的绝对路径（单例，模块仅执行一次）。 */
let target: string | null = null;

/** 面板读取本次运行转录文件的路径（服务端路由用）。 */
export function panelCaptureLogPath(): string {
  if (target) return target;
  let boot = "unknown";
  try {
    // 进程启动标识：与 log-store 的会话边界配合，文件按次命名不覆盖旧的。
    boot = `${process.pid}-${Date.now()}`;
  } catch {
    /* 极端环境下取不到也照写，文件名退化为固定值 */
  }
  target = path.join(NEXTJS_LOG_DIR, `${NEXTJS_PANEL_LOG_PREFIX}${boot}.log`);
  return target;
}

/**
 * 目录里按**写入时刻**最新的那份应用服务转录文件；取不到返回 null。
 *
 * 文件名（`nextjs-panel-<pid>-<毫秒>.log`）**不能按字面排序取最新**：`pid` 是
 * 变长十进制，字典序比较的是字符而不是数值，`…-9876-…` 会排在 `…-12345-…`
 * 之后。于是「取最后一份」实际取到的是**某次更早运行**留下的文件——它的行时刻
 * 早于本次会话起点，被 `dropStaleEntries` 整批裁掉，面板「应用服务」一路读到
 * 的就是一个恒为空的来源（用户报的正是「应用服务一条也不显示」）。
 * 与启动器侧 `scripts/launcher-core/orchestrator.mjs` 的 `latestPanelTranscript`
 * 同一口径（那边一直按 mtime 取），只是它服务于失败诊断、这边服务于面板。
 *
 * 本函数是「最新一份转录文件」在**服务端进程内**的唯一事实来源：读（路由）与
 * 轮转（下面的 prune）都问它，两处各写一份必然漂移。
 */
export function latestPanelLogFile(dir = NEXTJS_LOG_DIR): string | null {
  let best: { file: string; mtimeMs: number } | null = null;
  let names: string[];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ dir);
  } catch {
    return null; // 目录还不存在（应用服务从未启动过）——不是错误
  }
  for (const name of names) {
    if (!name.startsWith(NEXTJS_PANEL_LOG_PREFIX) || !name.endsWith(".log")) {
      continue;
    }
    const file = path.join(dir, name);
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(/*turbopackIgnore: true*/ file).mtimeMs;
    } catch {
      continue; // 正在被轮转删掉
    }
    if (!best || mtimeMs > best.mtimeMs) best = { file, mtimeMs };
  }
  return best?.file ?? null;
}

/** 保留最近 N 份转录文件（与 dev-launcher 清理 nextjs-stdout/stderr 的口径一致）。 */
const KEEP_FILES = 5;

/**
 * 轮转历史转录文件：按 mtime 保留最新 `KEEP_FILES` 份（**含本次这一份**）。
 *
 * 调用点在「本次文件刚建出来之前」，所以保留数取 `KEEP_FILES - 1`：加上马上要写
 * 的这份正好是 5。若按 `KEEP_FILES` 保留旧文件，长期跑下来目录里会稳定多出 1 份。
 *
 * 「按 bootId 前缀找同族」是错的：`bootId` 每次都不同，前缀永远只匹配到**自己
 * 这一份**，于是一份也删不掉——文件在每次启动后无限累积，而旧文件越多，
 * 「取错最新一份」的机会就越大（见 `latestPanelLogFile`）。
 */
function pruneOldFiles(): void {
  let entries: { file: string; mtimeMs: number }[];
  try {
    entries = fs
      .readdirSync(/*turbopackIgnore: true*/ NEXTJS_LOG_DIR)
      .filter(
        (name) =>
          name.startsWith(NEXTJS_PANEL_LOG_PREFIX) && name.endsWith(".log"),
      )
      .flatMap((name) => {
        const file = path.join(NEXTJS_LOG_DIR, name);
        try {
          return [
            {
              file,
              mtimeMs: fs.statSync(/*turbopackIgnore: true*/ file).mtimeMs,
            },
          ];
        } catch {
          return [];
        }
      });
  } catch {
    return; // 目录尚不存在等情形直接跳过
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file } of entries.slice(KEEP_FILES - 1)) {
    try {
      fs.unlinkSync(/*turbopackIgnore: true*/ file);
    } catch {
      /* 被占用/已删除都无所谓 */
    }
  }
}

function safeAppend(filePath: string, text: string): void {
  try {
    fs.appendFileSync(/*turbopackIgnore: true*/ filePath, text, "utf-8");
  } catch {
    /* 面板日志写失败绝不影响应用 */
  }
}

/* ── 转录缓冲 ─────────────────────────────────────────────
 * 转录挂在 `process.stdout.write` 上，每条 chunk 都过这里：每条一次
 * `appendFileSync` 等于把 open/write/close 三个系统调用乘上每一行输出 ——
 * 高频日志（pino、Turbopack 编译进度）下事件循环被大量小写入占满。
 * 攒进内存缓冲，满 `FLUSH_BYTES` 或到 `FLUSH_INTERVAL_MS` 再一次落盘。
 * 进程退出时最多丢一份未满的缓冲，对「面板转录」这份用途可以接受；
 * 顺序不受影响（单缓冲 FIFO，flush 是整段 append）。 */
const FLUSH_BYTES = 64 * 1024;
const FLUSH_INTERVAL_MS = 1000;

let buffer = "";
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushBuffer(filePath: string): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!buffer) return;
  const text = buffer;
  buffer = "";
  safeAppend(filePath, text);
}

function bufferedAppend(filePath: string, text: string): void {
  buffer += text;
  if (buffer.length >= FLUSH_BYTES) {
    flushBuffer(filePath);
    return;
  }
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    flushBuffer(filePath);
  }, FLUSH_INTERVAL_MS);
}

let installed = false;

/**
 * 开始把本进程的 stdout / stderr 转录进面板可见日志文件。
 *
 * 只做「额外落一份文件」这一件事：原有 write 行为（终端 / dev-launcher 的
 * redirect 文件 / 上一轮包装器）原样保留。重复调用幂等。
 */
export function installStreamCapture(): void {
  if (installed) return;
  installed = true;

  const filePath = panelCaptureLogPath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
      fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    }
    pruneOldFiles();
    safeAppend(filePath, "----- 应用服务输出（本次运行）-----\n");
    /* app-runtime 的会话横幅**已随一次启动一份文件撤销**（ISSUE #1326）：日志
     * 句柄由 `app-runtime-log.ts` 在首次写入时按 <时刻> 命名建文件，一份文件
     * 就是一个进程的一次启动，不再需要横幅划边界。这里不再写它 —— 写了也没人
     * 读（读侧不再按横幅切分），而「没人读的写法」正是要被清掉的那一类。 */
  } catch {
    /* 目录建不出来就不再转录（退化为原行为，不影响应用） */
  }

  type WriteFn = NodeJS.WriteStream["write"];

  const wrap = (stream: NodeJS.WriteStream, original: WriteFn) => {
    /* 与原签名同形：chunk + 可选 encoding / callback。真实调用方（console、
     * Next 的日志器、库）走的是这两个重载，覆盖它们即可全量转录。 */
    const patched: WriteFn = function patchedWrite(
      chunk: string | Uint8Array,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean {
      try {
        const text =
          typeof chunk === "string"
            ? chunk
            : Buffer.from(chunk).toString("utf-8");
        bufferedAppend(filePath, text);
      } catch {
        /* 转录失败不吞掉输出本身 */
      }
      return original.call(stream, chunk, encodingOrCb as never, cb as never);
    };
    stream.write = patched;
  };

  wrap(process.stdout, process.stdout.write.bind(process.stdout));
  wrap(process.stderr, process.stderr.write.bind(process.stderr));
}
