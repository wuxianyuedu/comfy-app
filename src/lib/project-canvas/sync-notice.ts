"use client";

/* ── 画布「服务端镜像」的失败状态 ─────────────────────────────────────────
 * 首行标 `"use client"` 是把这个事实写死：本模块只跑在浏览器（它读的是
 * `localStorage` 那一侧的状态，出口是 `emitAppEvent` 与 `console`）。
 * 这也让「日志唯一通道」那条门禁（`tests/single-logger-channel.test.ts`）
 * 能把这里的 console 与**服务端**的直接 console 区分开 —— 服务端直写会绕开
 * 脱敏与 ERROR 镜像，而浏览器侧的 console 正是项目规定的客户端日志口
 * （`LogProvider` 拦截后落进应用日志面板，规范 07 §7.6）。
 *
 * 画布的事实源是 localStorage，服务端那份是**镜像**（换端口 / 换设备时才用得上）。
 * 镜像写失败原本被 `catch {}` 吞掉，把两种**该做不同事**的失败压成同一种静默：
 * 「服务端**确定不收**这一份」（项目 id 属于别人、名字为空、会话已失效…）与
 * 「服务端**此刻拿不到**」（离线、正在重启、限流）。
 *
 * 后者的静默是对的 —— 本地优先的界面不该因为一次网络抖动打断用户，下一个 500ms
 * 防抖还会再试。前者的静默是**错的**：再试一万次也不会成功，而用户以为
 * 「已经存进服务端了」，于是换端口 / 换设备后画布是空的，且毫无线索
 *（台账 A3 那次装上归属闸之后，这一格才第一次真实存在）。
 *
 * 所以本模块只做一件事：**把「确定不收」登记成一个可查的状态**，并广播一次
 * `comfyapp:canvas-sync-changed`，让视图层去决定用什么通道告诉用户
 *（§18.4 / §12.12：地基里不放任何一侧的传输层代码 —— `src/lib` 不 import
 * `ToastProvider`，那属于视图层）。
 *
 * 状态**必须可查**而不只是「广播一下」：写镜像的入口不止画布那一页 ——
 * 工作区首页的「新建项目」、`ProjectGate` 的重名新建、作品画廊的删除，都会把镜像
 * 发出去，而那些页面**没有挂提示器**。那一次的广播发出去没人接，而 `emitAppEvent`
 * 承诺不排队重放，于是只靠事件的读侧必然漏掉它；留在表里，用户下一次进画布时
 * 由「挂载时先读一次」看见。读侧的口径因此是「先读表，再订阅变化」。
 */

import type { TRPC_ERROR_CODE_KEY } from "@trpc/server";

import { emitAppEvent } from "~/lib/app-events";
import { errorCode, errorText, rawErrorDetail } from "~/lib/error-message";

/** 一条「这份画布没能进服务端」的记录。 */
export interface SyncNotice {
  projectId: string;
  /** 拒收时那条画布的名字 —— 用户认得出的是名字，不是 `proj_1727…` 这种 id。 */
  projectName: string;
  /** 已经过 `errorText` 翻译的详情（含动作前缀，可直接给人读）。 */
  detail: string;
}

/**
 * 「重试也不会成功」的 tRPC 码集合。
 *
 * 判据是**这条请求的语义**，不是 HTTP 状态码区间：`TIMEOUT`(408) 与
 * `TOO_MANY_REQUESTS`(429) 也是 4xx，但它们是「现在别打这么勤」，
 * 归到可重试那一档；`INTERNAL_SERVER_ERROR` / `SERVICE_UNAVAILABLE` /
 * `BAD_GATEWAY` / `GATEWAY_TIMEOUT` / `NOT_IMPLEMENTED` 是服务端的问题，
 * 重试有可能变好（tRPC 自己就把这四条列进 `retryableRpcCodes`）；
 * `PARSE_ERROR` 与 `CLIENT_CLOSED_REQUEST` 在本仓库里的真实身份是
 * 「dev server 正在重启 / React Query 中止了上一轮」（见 `~/lib/error-message`
 * 的网络层翻译表），同样是暂时。
 *
 * **取不到码 = 压根没拿到响应**（离线、连不上）⇒ 暂时，不进登记表。
 * 这一条决定了整个判据的方向：只有服务端**明确回了一句「不收」**才算被拒。
 *
 * 成员类型钉在 `TRPC_ERROR_CODE_KEY` 上：这一族的名字里有 `PARSE_ERROR` 而不是
 * `PARSE_FAILED`，写错一个字的后果不是编译报错，而是**那一档永远匹配不上**、
 * 于是「服务正在重启」会被判成「确定拒收」并给用户弹一条永远不该弹的提示。
 */
const TRANSIENT_CODES: ReadonlySet<string> = new Set<TRPC_ERROR_CODE_KEY>([
  "TIMEOUT",
  "TOO_MANY_REQUESTS",
  "INTERNAL_SERVER_ERROR",
  "NOT_IMPLEMENTED",
  "BAD_GATEWAY",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
  "PARSE_ERROR",
  "CLIENT_CLOSED_REQUEST",
]);

/** 这条失败是不是「服务端确定不收这份内容」。 */
export function isPermanentRefusal(e: unknown): boolean {
  const code = errorCode(e);
  if (code === null) return false;
  return !TRANSIENT_CODES.has(code);
}

/** 键用项目 id：同一份画布的重复拒收只留一条（自动保存每 500ms 就会再撞一次）。 */
const notices = new Map<string, SyncNotice>();

/**
 * 浏览器侧的镜像诊断口。
 *
 * 单独导出一次，是为了让 `canvas-store` 那边（读服务端列表失败）不再自己
 * 写第二处 `console.warn`：这一族的日志通道只有这一条，而那条通道归
 * `tests/single-logger-channel.test.ts` 管（豁免清单点名的是**本文件**，
 * 不是整个 `project-canvas` 目录）。
 */
export function logSyncIssue(
  action: string,
  e: unknown,
  projectId?: string,
): void {
  /* 一行里给两份：`errorText` 是翻译过的人话（「服务返回了非预期内容…」），
   * `rawErrorDetail` 是**服务端原文 + 码**（`code=FORBIDDEN — …`）。
   * 只留前者，「到底是哪个码拒的」就查不回来；只留后者，面板上是一串原文。
   * 口径同 `~/lib/error-message` 那两个函数的分工说明。 */
  console.warn(
    `[canvas-sync] ${action}：`,
    errorText(e, action),
    rawErrorDetail(e),
    projectId,
  );
}

/**
 * 「确定被拒」那几种码的人话。
 *
 * 为什么不能直接把 `errorText(e, …)` 甩到界面上：`BAD_REQUEST` 来自入参校验，
 * 它的服务端 message 是 zod 的 JSON 形状（`too_small` / `inclusive` / `path` 那一坨），
 * 一行都读不下去 —— 「有用户可见出口」的那一半是**读得懂**，不是「有个 toast」。
 * 原文不丢：它照旧走 {@link logSyncIssue} 落进应用日志面板（排查用），
 * 界面上只留这一句（动作 + 该做的事）。
 */
const REFUSAL_PHRASES: Partial<Record<TRPC_ERROR_CODE_KEY, string>> = {
  FORBIDDEN: "这个画布编号已经属于别的用户，改个名字另存一份就能保住",
  UNAUTHORIZED: "登录已经失效，重新登录后会自动补存",
  NOT_FOUND: "服务端没有找到这条画布的位置",
  BAD_REQUEST: "这份画布的内容形状服务端不接受（多半是名字为空）",
  PAYLOAD_TOO_LARGE: "这份画布太大，服务端不收",
};

/** 界面上那一句：能按码翻成人话的翻，翻不出的一律走已翻译的原文。 */
function refusalDetail(action: string, e: unknown): string {
  const code = errorCode(e);
  const phrase =
    code === null ? undefined : REFUSAL_PHRASES[code as TRPC_ERROR_CODE_KEY];
  return phrase ? `${action}：${phrase}` : errorText(e, action);
}

/**
 * 登记一条镜像失败。返回**状态是否发生了变化** —— 调用方据此决定要不要广播，
 * 于是「同一个拒收被自动保存重复触发 20 次」只对应一条记录、一次广播。
 *
 * 暂时性失败在这里被**主动忽略**（不登记、不广播），但仍由调用方留一行日志：
 * 「不弹提示」与「什么都不说」是两件事（硬规则 4）。
 *
 * `action` 由调用点给（「没能存进服务端」/「没能从服务端删掉」）：两种失败的
 * 后果不一样 —— 前者是「换设备看不到这份」，后者是「删掉的会在别处又冒出来」，
 * 把它们压成一句「同步失败」就等于把可行动的提示判没了（口径同 E8 里
 * `PRECONDITION_FAILED` 那一档）。
 */
export function recordSyncFailure(
  action: string,
  project: { id: string; name: string },
  e: unknown,
): boolean {
  if (!isPermanentRefusal(e)) return false;
  const detail = refusalDetail(action, e);
  const prev = notices.get(project.id);
  if (prev?.detail === detail) return false;
  notices.set(project.id, {
    projectId: project.id,
    projectName: project.name,
    detail,
  });
  emitAppEvent("comfyapp:canvas-sync-changed");
  return true;
}

/** 这一份终于写进去了 → 撤掉记录（并把名字改对之后残留的旧提示一起收掉）。 */
export function clearSyncFailure(projectId: string): boolean {
  if (!notices.delete(projectId)) return false;
  emitAppEvent("comfyapp:canvas-sync-changed");
  return true;
}

/**
 * 镜像失败的统一处置（调用点是 `canvas-store` 的两个 fire-and-forget）。
 *
 * 两个分支**都要有痕迹**，只是通道不同：
 *   · 确定被拒 → 登记表 + 广播（视图侧据此弹提示，见 `use-project-persistence`）；
 *   · 暂时拿不到 → 只留一行 `console.warn`，不打断用户。
 *
 * 为什么不在这里用 `logger`（pino）：本模块只在浏览器里跑，`~/lib/core/logger`
 * 是服务端落盘通道（§18.4 的「通道恰恰是这里最不该被通用的部分」）。
 */
export function reportMirrorFailure(
  action: string,
  project: { id: string; name: string },
  e: unknown,
): void {
  if (!isPermanentRefusal(e)) {
    logSyncIssue(`${action}（暂时性，下一次自动保存会再试）`, e, project.id);
    return;
  }
  /* 拒收也留一行：界面上是人话，日志里是**服务端原文与码** —— 只看 toast
   * 猜不出到底是 `FORBIDDEN` 还是 `BAD_REQUEST`（硬规则 4 的两半各走一条通道）。 */
  logSyncIssue(action, e, project.id);
  recordSyncFailure(action, project, e);
}

/** 当前所有「确定被拒」的画布（读侧挂载时先读一次，见文件头那条承诺）。 */
export function listSyncNotices(): SyncNotice[] {
  return [...notices.values()];
}
