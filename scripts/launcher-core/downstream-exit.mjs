/**
 * 启动链路的「收尾定性」：一次启动结束后，怎么把「谁退了」翻译成用户看得懂的成因。
 *
 * 这一族（`downstreamExitKind` / `readShellMarkers` / `describeDownstreamExit` /
 * `runtimeExitRecord`）判的都是**同一件事的四个侧面**：谁是先走的、壳留下了什么
 * 正标记、这句话该怎么说给用户听。把它收在编排器的一个子模块里，而不是塞在
 * `dev-launcher.mjs` 的入口流程上：入口文件已经 1600+ 行（§12.6 R5 的姊妹档在
 * 盯着），而这一族既是纯判据（可逐分支单测）、又与主流程的时序无关。
 */

import path from "node:path";

import { currentDirOf } from "./log.mjs";
import { fileHasMarker, readTail } from "./orchestrator.mjs";

/** 「用户放弃本次启动」= 关闭启动页；壳会写 `launch abandoned` 并以 0 退出。
 *  这不是失败：用户刚刚亲手按的 ✕，再报一次红色「启动失败」是误报。 */
export const ABANDONED_MARKER = "launch abandoned";
/** 壳自己非零退出时写下的标记。 */
export const NONZERO_EXIT_MARKER = "exiting with non-zero code";

/** dev server 先退出时的成因分类（判据 = 壳侧写下的**正标记** + 壳是否已退）。
 *
 *  为什么不拿退出码定性：「壳也退出了」是共同现象，用户放弃 / 壳崩溃 / 被任务
 *  管理器结束都会命中它；由现象反推成因会把真故障说成设计内行为（历史事故）。
 * @param {{ shellExited: boolean, abandoned: boolean, shellCrashed: boolean }} input
 * @returns {"dev-server" | "abandoned" | "shell-self-exited" | "shell-terminated"} */
export function downstreamExitKind({ shellExited, abandoned, shellCrashed }) {
  if (!shellExited) {
    return "dev-server";
  }
  if (abandoned) {
    return "abandoned";
  }
  if (shellCrashed) {
    return "shell-self-exited";
  }
  return "shell-terminated";
}

/** 取壳侧 stderr 的两个正标记（大小写不敏感）。
 * @param {string} [root] @returns {{ abandoned: boolean, crashed: boolean, file: string }} */
export function readShellMarkers(root = ".") {
  const file = path.join(currentDirOf("launcher", root), "dev-launcher-stderr.log");
  return {
    abandoned: fileHasMarker(file, ABANDONED_MARKER),
    crashed: fileHasMarker(file, NONZERO_EXIT_MARKER),
    file,
  };
}

/** 把 dev server 提前退出翻译成可行动的报错（抛出的消息即用户可见的失败出口）。
 * @param {string} kind
 * @param {{ devCode: number | null, shellCode: number | null, shellPid?: number | undefined,
 *           stderrFile: string, stdoutFile: string }} ctx
 * @returns {string}
 */
export function describeDownstreamExit(kind, ctx) {
  const errTail = readTail(ctx.stderrFile, 20) || "(无输出)";
  const outTail = readTail(ctx.stdoutFile, 20) || "(无输出)";
  const tail = `最近 stderr：\n${errTail}\n最近 stdout：\n${outTail}\n（完整输出见 ${ctx.stdoutFile} 与 ${ctx.stderrFile}）`;
  if (kind === "abandoned") {
    return "检测到启动页被关闭（壳日志含 launch abandoned 标记）：用户放弃本次启动，按正常收尾处理";
  }
  if (kind === "shell-self-exited") {
    return (
      `本地服务随桌面壳一起退出（壳自身以非零码结束，exit=${ctx.shellCode ?? "?"}）。` +
      `壳侧判据：log/current/launcher/dev-launcher-stderr.log 里的 \`exiting with non-zero code\`；` +
      `若附近还有 \`another instance of this checkout is running\`，说明这次启动只是把已在运行的窗口唤到前台` +
      `——本次双击没有启动新进程，属于设计内行为。\n${tail}`
    );
  }
  if (kind === "shell-terminated") {
    return (
      `本地服务随桌面壳一起退出（exit=${ctx.shellCode ?? "?"}），且 log/current/launcher/dev-launcher-stderr.log 里` +
      `**没有**壳写下的任何收尾标记——说明壳是被强行收走的（另一次启动把它顶掉 / 任务管理器结束了任务 / 壳崩溃）。` +
      `这次双击等于**从未启动**：请只双击一次启动入口并等启动页自己切到主界面。` +
      `另请对照 log/current/shell/shell.log 与 log/current/launcher/dev-launcher-stderr.log。\n${tail}`
    );
  }
  return (
    `Next.js dev server 提前退出（exit=${ctx.devCode ?? "?"}）。` +
    `壳仍在运行，属 dev server 自身退出（编译失败 / 端口被占 / pnpm 异常）。\n${tail}`
  );
}

/**
 * 运行期（服务已就绪之后）退出：要不要写下结束记录、写什么。返回 `null` = 不写。
 *
 * ## 为什么要有这一层
 *
 * 写侧原先只挂在 {@link describeDownstreamExit} 的调用点上，而那条唯一入口在**就绪
 * 等待循环**里。于是「服务起来之后自己没了」——也就是用户在界面上真正会看到的
 * 「应用服务已断开」——永远没有记录：恢复后读回 `null`，界面只能回一句读不到
 * 原因的兜底，而那句话把成因猜成「手工 pnpm dev」。双击 exe（§1.5）走的恰恰
 * 是这条**最常出问题**的档位，却是注定读不到记录的那一档。
 *
 * ## 判据：只有「dev 先退出」才写
 *
 * · 那一刻服务确实没了，而编排器与壳还活着（还写得下去）；
 * · 反过来「壳先退出」是用户关窗 / 壳被收走，服务是**被带走**而不是自己崩的
 *   ——那是壳那一侧的事（standalone 内嵌 server 由壳持句柄写记录），在这里补
 *   一条只会把「用户主动关窗」说成「服务崩了」；
 * · 编排器自己收到 SIGINT/SIGTERM 同理：那是有序收尾（回收整树后退出），不是
 *   应用服务故障。
 *
 * 成因固定为 `dev-server`：服务自己结束了，而 `describeAppServiceExit` 对它的
 * 分档（本地服务自身退出 → 看 log/nextjs/）正是这一档的处置方式。
 *
 * @param {{ who: "dev" | "shell" | "signal", devCode: number | null,
 *           devSignal?: string | null, port?: number | null,
 *           runId?: string | null }} input
 * @returns {{ kind: string, code: number | null, signal: string | null,
 *             reason: string, port: number | null, runId: string | null } | null}
 */
export function runtimeExitRecord({ who, devCode, devSignal = null, port = null, runId = null }) {
  if (who !== "dev") {
    return null;
  }
  return {
    kind: "dev-server",
    code: typeof devCode === "number" ? devCode : null,
    signal: devSignal,
    reason:
      `运行中的 Next.js dev server 已退出（exit=${
        typeof devCode === "number" ? devCode : "?"
      }${devSignal ? `, signal=${devSignal}` : ""}）` + "，此后应用服务一直不可达，直到重新启动。",
    port,
    runId,
  };
}
