/**
 * ComfyUI 生命周期的**会话落盘两件事**：上一次会话的标记文件（下次启动反推
 * 「上次那家伙不是正常结束的」）与本次启动的 runtime 日志写入器。
 *
 * 为什么单独一份：这两件都只做「写盘 + 读回」，与启动判决、窗口期、状态缓存无关
 * （那些留在 `lifecycle.ts`）。它们此前与主流程同住一个文件，而文件在 oxlint
 * `curly` 那批机械改写后越过了文件长度硬闸（规范 §12.6） —— 拆的是**职责边界**，
 * 不是把行数摊平：`lifecycle.ts` 保留「什么时候写」，这里收「怎么写、写到哪」。
 *
 * 形态与 `lifecycle-exit` / `lifecycle-derive` 一族一致：纯 Node 宿主、无 `server-only`
 * （`lifecycle.ts` 被启动编排与 Next 两侧共用，见那边的 §18.4 说明）。
 */
import fs from "node:fs";

import { SERVICES_LOG_DIR } from "~/lib/log/log-paths";
import {
  openRuntimeLogWriter,
  pruneRuntimeLogFiles,
  type RuntimeLogWriter,
} from "~/lib/log/runtime-log-pack.server";
import { formatLocalStamp } from "~/lib/time-format";

import { noteComfyExit } from "./liveness-signal";
import {
  describeStaleSession,
  type ComfyExitReport,
  type ComfySessionMark,
} from "./lifecycle-exit";

/** 「上一次 ComfyUI 会话」的标记文件。
 *
 *  存在的理由：**应用/系统也一起没了**那一档（编排器退出时 Windows Job Object
 *  连带静默杀树、强制关机、任务管理器结束进程）没有任何活着的进程能写日志 ——
 *  只能在下一次启动时读这个文件反推「上次那家伙不是正常结束的」。
 *  「有开始没结束」就是那类情况的指纹。 */
const COMFY_SESSION_MARK = `${SERVICES_LOG_DIR}/comfyui-last-session.json`;

export function readSessionMark(): ComfySessionMark | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(COMFY_SESSION_MARK, "utf-8"));
    if (parsed === null || typeof parsed !== "object") {
      return null;
    }
    return /* SAFETY: 类型断言已复核 */ parsed as ComfySessionMark;
  } catch {
    return null;
  }
}

function writeSessionMark(mark: ComfySessionMark): void {
  try {
    fs.mkdirSync(SERVICES_LOG_DIR, { recursive: true });
    fs.writeFileSync(COMFY_SESSION_MARK, JSON.stringify(mark), "utf-8");
  } catch {
    /* 标记写不进去不该影响启动本身：最坏的结果只是下次启动少一条对账提示 */
  }
}

export function markComfySessionStart(info: {
  mode: ComfySessionMark["mode"];
  pid: number | null;
}): void {
  writeSessionMark({
    pid: info.pid,
    mode: info.mode,
    startedAt: new Date().toISOString(),
    exited: null,
  });
}

export function markComfySessionEnd(report: ComfyExitReport): void {
  /* 先发信号、再落盘（ISSUE #1351）：退出事件的**唯一**客户端通路在这里 ——
   * bound 的 `child.on("exit")` 与保活的窗口监督器都汇到这一步，所以只需要
   * 一处就能把「毫秒级事件」推向浏览器。放在 `prev === null` 的早退之前：
   * 「没有会话标记」是**对账**这件事无话可说，不是「没发生退出」——
   * 把它一起吞掉会让客户端在最需要立刻知道的时候反而等下一拍轮询。 */
  noteComfyExit(report);
  const prev = readSessionMark();
  if (prev === null) {
    return;
  }
  writeSessionMark({
    ...prev,
    exited: { at: new Date().toISOString(), reason: report.reason },
  });
}

/** 每进程只对一次账（启动尝试可能被 WS 重连反复触发，重复提示是噪音）。 */
let staleSessionChecked = false;

/** 下次启动时反推「上一次会话为什么没有结局」。
 *  @param comfyUp 这次启动时 ComfyUI 是否还活着（保活移交时据此闭嘴）。 */
export function warnStaleComfySession(note: (msg: string) => void, comfyUp: boolean): void {
  if (staleSessionChecked) {
    return;
  }
  staleSessionChecked = true;
  const stale = describeStaleSession(readSessionMark(), comfyUp);
  if (stale !== null) {
    note(`⚠ ${stale}`);
  }
}

/** 本地时间戳（YYYY-MM-DD HH:mm:ss）：runtime 日志是给本机用户看的，
 *  toISOString 的 UTC 在 +8 时区会凭空差出 8 小时。 */
export function localTimestamp(): string {
  return formatLocalStamp(new Date());
}

/** 本次启动的 runtime 日志写入器（`comfyui-runtime-<时刻>.log`）。
 *
 * 一次启动一份文件（ISSUE #1326）：句柄**跟着这一次启动走**，启动时由
 * `beginRuntimeSession()` 换一份新的，因此「这个文件属于哪一次启动」不再需要
 * 靠行时刻或横幅去推断 —— 它就是文件本身。
 *
 * 为 null（还没启动过任何一次）时写日志静默跳过：状态行 / 启动流程本来就会
 * 各自 `note()` 到 logger 与面板，缺一份文件不该把流程带崩。 */
let runtimeWriter: RuntimeLogWriter | null = null;

/**
 * 开一次启动的日志：轮转旧文件 → 换上新的一份 → 落首行标题。
 *
 * **必须在写第一条业务行之前调用**（`runEnsureLaunch` 拉起前那一步）：
 * 顺序反了会把本次的头几行写进上一次的文件里，而那正是「日志看起来少了一次」
 * 的现场（没有报错、只是归属错了）。同秒内重复启动由写入器自己分叉
 * （`-2` / `-3`），不会覆盖前一次的现场。
 */
export function beginRuntimeSession(at: Date = new Date()): string {
  pruneRuntimeLogFiles();
  runtimeWriter = openRuntimeLogWriter("comfyui-runtime", at);
  appendRuntimeLog("▶ ComfyUI 启动会话");
  return runtimeWriter.file;
}

export function appendRuntimeLog(line: string): void {
  runtimeWriter?.write(`${localTimestamp()} ${line}`);
}
