/* ── 追加不轮转日志的「会话边界横幅」（唯一实现）────────────────────────
 *
 * `log/services/` 下的 runtime 日志（comfyui / drizzle-studio / ollama /
 * app-runtime）与 `app-runtime.log` 都是**追加不轮转**的：本进程、上一次、
 * 上上一次运行的行全留在同一个文件里。直接看文件的用户（而不是面板）因此
 * 分不清「本次是从哪一行开始的」——条与条之间没有断点，最新一次运行的头几行
 * 接着上一次的尾几行，读起来是一条连续的时间线。
 *
 * 面板侧有会话起点裁剪（`log-session-scope` + `dropStaleEntries`），但那只解决
 * 「面板显示」，**文件本身**仍然要能被人读懂：用户打开 `log/services/*.log`
 * 排查时看到的就是 ISSUE 「每次启动之间日志需要行空白」指的场景。
 *
 * 本模块给出这件事的**唯一实现**——一条两侧留空行、由 box 字符与 ANSI 亮色
 * 勾勒的横幅。此前它在 comfyui / drizzle-studio / ollama 三处各抄了一份
 * （判据见规范 12 §12.12.1：小函数的跨层复制是门禁死角），改口径要改三处、
 * 漏一处就是**不同通道的边界长得不一样**。
 *
 * 口径（与规范 07 §7.14.4 一致）：
 *   - 横幅**不带时刻**：时刻只留在每条日志的行首（`appendRuntimeLog` 的统一
 *     口径），横幅里再写一遍会与紧随其后的行首时刻差 1 秒，用户把两条读成
 *     一条，反而以为「没有新增」；
 *   - **前后各留一个空行**：横幅与上一 / 下一段内容之间有视觉断点，这正是
 *     「每次启动之间需要行空白」的本体；
 *   - 写入失败**静默**：日志子系统绝不阻塞业务主流程（对齐 §7.11）。
 *
 * Node-only 声明（规范 18 §18.4）：本模块只做文件追加写，全部出口都只能服务端用，
 * 调用方也清一色是服务端（route handler / 各 runtime lifecycle / `.server.ts`），
 * 因此用 `.server.ts` 后缀显式声明，与 `capture-streams.server.ts` /
 * `log-session-scope.server.ts` 同一口径。客户端如有需要（当前没有），
 * 只能经服务端端点转交。
 */

import fs from "node:fs";
import path from "node:path";

/** 横幅种类：start（亮绿）= 新会话开始；end（亮黄）= 会话结束。 */
export type SessionBannerKind = "start" | "end";

/** 分隔线宽度：与三个 runtime 通道既有的 72 字符口径一致。 */
const BAR_WIDTH = 72;

/** 横幅用的 ANSI 颜色（亮绿 / 亮黄），面板解析 SGR 后渲染成高亮。 */
const BANNER_COLOR: Record<SessionBannerKind, string> = {
  start: "\x1b[1;32m",
  end: "\x1b[1;33m",
};

/**
 * 构造一条会话边界横幅（**纯函数**，不碰文件系统）。
 *
 * 返回的文本以 `\n` 开头、以 `\n` 结尾：前导换行把横幅与上一段内容隔开，
 * 结尾的换行保证下一次 append 的内容从新的一行开始（不粘在横幅末行）。
 * 调用方按「一次 append 一条"横幅 + 空行"」使用，无需自己补换行。
 *
 * @param kind start / end，决定颜色
 * @param title 横幅中间的信息行（会话说明 / exit code 等，**不含时刻**）
 */
export function buildSessionBanner(
  kind: SessionBannerKind,
  title: string,
): string {
  const bar = "─".repeat(BAR_WIDTH);
  const color = BANNER_COLOR[kind];
  const reset = "\x1b[0m";
  /* 首尾各一个空行：`["", …, ""]` join 后 → `\n<bar>\n  <title>\n<bar>\n`，
   * 再补一个尾部 `\n` 收口，形成「空行 / bar / 标题 / bar / 空行」的呼吸感。 */
  const lines = [
    "",
    `${color}${bar}${reset}`,
    `${color}  ${title}${reset}`,
    `${color}${bar}${reset}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * 把一条会话边界横幅追加进指定日志文件（**唯一 IO 出口**）。
 *
 * 目录不存在时自动建（与各 runtime 的 `appendRuntimeLog` 同口径）；任何
 * 失败都静默吞掉——日志写不进去不该把启动/停止流程带崩。
 *
 * @param filePath 目标日志文件的**绝对路径**，一律取自 `log-paths.ts`
 * @param kind start / end
 * @param title 横幅中间的信息行
 */
export function appendSessionBanner(
  filePath: string,
  kind: SessionBannerKind,
  title: string,
): void {
  try {
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(filePath), {
      recursive: true,
    });
    fs.appendFileSync(
      /*turbopackIgnore: true*/ filePath,
      buildSessionBanner(kind, title),
      "utf-8",
    );
  } catch {
    /* 日志失败不影响主流程 */
  }
}
