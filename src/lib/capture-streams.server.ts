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

import { APP_RUNTIME_LOG, NEXTJS_LOG_DIR } from "@/lib/log-paths";
import { appendSessionBanner } from "@/lib/session-banner.server";

export const PANEL_LOG_PREFIX = "nextjs-panel-";

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
  target = path.join(NEXTJS_LOG_DIR, `${PANEL_LOG_PREFIX}${boot}.log`);
  return target;
}

/** 保留最近 N 份转录文件（与 dev-launcher 清理 nextjs-stdout/stderr 的口径一致）。 */
const KEEP_FILES = 5;

function pruneOldFiles(filePath: string): void {
  try {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const prefix = base.slice(0, base.indexOf(".") + 1);
    const siblings = fs
      .readdirSync(/*turbopackIgnore: true*/ dir)
      .filter((name) => name.startsWith(prefix) && name !== base)
      .sort()
      .reverse()
      .slice(KEEP_FILES - 1);
    for (const name of siblings) {
      try {
        fs.unlinkSync(/*turbopackIgnore: true*/ path.join(dir, name));
      } catch {
        /* 被占用/已删除都无所谓 */
      }
    }
  } catch {
    /* 目录尚不存在等情形直接跳过 */
  }
}

function safeAppend(filePath: string, text: string): void {
  try {
    fs.appendFileSync(/*turbopackIgnore: true*/ filePath, text, "utf-8");
  } catch {
    /* 面板日志写失败绝不影响应用 */
  }
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
    pruneOldFiles(filePath);
    safeAppend(filePath, "----- 应用服务输出（本次运行）-----\n");
    /* app-runtime.log 是**追加不轮转**的：上一次、上上一次运行的行全留在同一
     * 个文件里。面板侧靠会话起点裁剪（log-session-scope），但**文件本身**还要
     * 能被人读懂——用户打开 log/services/app-runtime.log 排查时，最新一次运行的
     * 头几行接着上一次的尾几行，分不清本次从哪开始（ISSUE #592）。
     * 这里在每次应用服务启动时写一条会话边界横幅（两侧各留空行），与其他
     * runtime 通道（comfyui / drizzle-studio / ollama）口径一致。 */
    appendSessionBanner(APP_RUNTIME_LOG, "start", "▶ 应用运行日志（本次运行）");
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
          typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
        safeAppend(filePath, text);
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
