/* ── 「应用服务断开 / 启动」这两件事的判据与文案（规范 17 §17.2 第①层）──
 *
 * 纯函数、无 React、无 IO。消费方是 `use-app-service-message-log`（把这两件事
 * 写进消息中心的那个 hook）。
 *
 * ## 为什么要有这一层，而不是在 hook 里 if 一下
 *
 * 「什么时候算一次断开 / 一次启动」是**判据**，与「记到哪里」无关；而判据最容易
 * 出错的地方恰恰是**边界**：把「整页刷新后第一次探到」当成重启（那是假边沿，用户
 * 只是按了 Ctrl+R）、把「探活失败的第一拍」当成断开（那是抖动，不是断）。这类
 * 差异写进 hook 就只能靠 renderHook 覆盖，而它本身是纯的、可以直接逐分支断言。
 *
 * ## 两条事实的来源
 *
 * · `state` —— `deriveDevServerStatus` 的三态（见 `~/lib/shell/dev-server-status`）：
 *   `starting`（还没探通）/ `online` / `offline`（曾经通、现在不通）。
 * · `processIsNew` —— 「这份进程对本次页面会话来说是新的」（冷启动或真重启，见
 *   `use-dev-server-liveness`）。**它是「进程换了一个」的唯一权威信号**：探活失败
 *   可能只是显示器关闭 / 后台节流 / 瞬时断网（那几条判据已明确排除「探测失败即
 *   重启」），而整页刷新**并没有**换进程。
 *
 * ## 两条边沿各自产出什么
 *
 * | 边沿                                | 产出        | 依据                                   |
 * | ----------------------------------- | ----------- | -------------------------------------- |
 * | `online → offline`                  | 断开        | 用户在状态栏真的会看到「应用服务已断开」 |
 * | `processIsNew` 由假转真             | 启动 / 恢复 | 这一份进程此前不在（或已被换掉）       |
 * | `offline → online`（进程没换）      | 恢复        | 断了又通，用户在界面上看着它变了        |
 *
 * **刷新不产生「启动」**：整页刷新后判据仍是「这份进程不是新的」（`processIsNew`
 * 在刷新前就是真），于是边沿不成立 —— 否则用户每按一次 Ctrl+R 消息中心就多一条
 * 「应用服务已启动」。
 *
 * ## 原因为什么只能在「启动」那条上给
 *
 * 探活走的是 `GET /api/dev/server-id`，那是应用服务自己的 HTTP：它一不在，这条通道
 * 必然不通，此刻去问「为什么没了」是问不到的。成因由旁证人在进程结束那一刻写进
 * `run/app-service-exit.json`（见 `~/lib/shell/app-service-exit`），只能在**新进程
 * 应答之后**经 `GET /api/dev/last-exit` 读回。所以断开那条只给时刻 + 去向，原因在
 * 紧随其后的启动/恢复那条上给全 —— 规范 §10.3.1「降级不得静默」在这条链路上的完整
 * 形态是「断开时讲清去向、恢复时讲清原因」，而不是在断开那条里编一个「未知原因」。
 */

import { formatClock } from "~/lib/time-format";

import type { AppServiceExitNotice } from "./app-service-exit";
import type { DevServerState } from "./dev-server-status";

/** 一条可直接 `push` 的消息文案。 */
export interface AppServiceMessageText {
  title: string;
  body: string;
}

/* ── 判据：从「上一次看到什么」到「这一次该记什么」 ───────────────────────── */

/** 边沿判据的游标：上一次看到的事实 + 尚未收尾的那一次断开。 */
export interface AppServiceEventCursor {
  /** 上一次看到的三态。 */
  state: DevServerState;
  /** 上一次看到的「这份进程是新的吗」。 */
  processIsNew: boolean;
  /** 本次页面会话里观测到的断开时刻；还没断开过为 null。 */
  offlineAt: number | null;
}

/** 一次待记录的事件。 */
export type AppServiceEvent =
  | { type: "disconnect"; at: number }
  | {
      type: "start";
      at: number;
      /** 这次启动之前的断开时刻；本次会话没观测到断开为 null（= 冷启动 / 刷新后才恢复）。 */
      offlineAt: number | null;
    };

export interface AppServiceFacts {
  /** 本次看到的三态。 */
  state: DevServerState;
  /** 本次看到的「这份进程对本次页面会话来说是新的吗」。 */
  processIsNew: boolean;
}

/** 初始游标：首帧还没有任何事实，因此不会产出边沿。 */
export function initialAppServiceCursor(): AppServiceEventCursor {
  return { state: "starting", processIsNew: false, offlineAt: null };
}

/**
 * 把「这一拍看到的事实」翻译成「至多一条待记录的事件」，并给出下一个游标。
 *
 * 纯函数：不读时钟、不写 store —— `now` 由调用处注入（这样用例能钉住时刻）。
 * 游标**不可变**：调用处整体替换 ref，便于在用例里逐步推进。
 */
export function deriveAppServiceEvent(
  prev: AppServiceEventCursor,
  facts: AppServiceFacts,
  now: number,
): { cursor: AppServiceEventCursor; event: AppServiceEvent | null } {
  const cursor: AppServiceEventCursor = { ...prev, state: facts.state };

  /* ① 断开：进 `offline` 的那一拍。注意必须判「上一拍不是 offline」——
   * `offline` 会一直持续到恢复，逐拍都发就成了每 2 秒一条消息。 */
  if (facts.state === "offline" && prev.state !== "offline") {
    return {
      cursor: { ...cursor, offlineAt: now },
      event: { type: "disconnect", at: now },
    };
  }

  /* ② 进程换了一个（冷启动或真重启）：这一条同时覆盖「应用重启了」与「本次会话
   * 第一次见到它」两种，用户读到的都是「它起来了」。判的是**由假转真**而不是
   * 「此刻为真」——后者每拍都成立，会把刷新也记成一次启动。 */
  if (facts.processIsNew && !prev.processIsNew) {
    return {
      cursor: { ...cursor, processIsNew: true, offlineAt: null },
      event: { type: "start", at: now, offlineAt: prev.offlineAt },
    };
  }

  /* ③ 同一个进程内又通了：探活失败可能是网络抖动（那次不会判定重启），但只要
   * 用户在界面上确实见过「已断开」，恢复就值得记一条——哪怕进程一直没换过。
   * 判 `offlineAt !== null` 而不是上一拍的状态，于是「断了很久才通」只记一条。 */
  if (facts.state === "online" && prev.offlineAt !== null) {
    return {
      cursor: { ...cursor, offlineAt: null },
      event: { type: "start", at: now, offlineAt: prev.offlineAt },
    };
  }

  return { cursor, event: null };
}

/* ── 文案：把事件与「读回来的原因」变成一条能照着做的消息 ──────────────────── */

/** 断开时长 → 「2 分 05 秒」这类人能读的写法；拿不到时间戳时返回 null。 */
export function formatOfflineSpan(
  offlineAt: number,
  at: number,
): string | null {
  const ms = at - offlineAt;
  /* 时钟漂移 / 跨机器写入的记录会算出负数：负时长说成「持续 -3 秒」比说没有更糟。 */
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} 小时 ${pad2(minutes)} 分 ${pad2(seconds)} 秒`;
  if (minutes > 0) return `${minutes} 分 ${pad2(seconds)} 秒`;
  return `${seconds} 秒`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 断开那条：给时刻 + 去向，**不给原因**。
 *
 * 原因此刻不可知（见文件头），而写一句「原因未知」等于把规范 §10.3.1 要消灭的那种
 * 静默又请回来；所以这里明确说「原因会在恢复那条里给」，让用户知道去哪儿找。
 */
export function describeAppServiceDisconnect(
  at: number,
): AppServiceMessageText {
  return {
    title: "应用服务已断开",
    body:
      `断开时间 ${formatClock(at)}。` +
      "断开期间页面里的查询、保存与任务提交都会失败。\n" +
      "原因由启动编排在进程结束那一刻写入 run/app-service-exit.json，" +
      "只能在服务恢复后读回——恢复时会作为「应用服务已恢复」记进本中心，原因与建议都在那条里。",
  };
}

/** 启动/恢复那条的输入：时刻 +（若有）断开时刻 +（若有）上一次结束的原因。 */
export interface AppServiceStartInput {
  /** 本次应答的时刻（新进程已经起来了）。 */
  at: number;
  /** 本次会话观测到的断开时刻；冷启动为 null。 */
  offlineAt: number | null;
  /** 上一份进程结束记录的落盘时刻（ISO 串或毫秒）；没有为 null。 */
  exitAt: number | null;
  /** 上一份进程为什么结束；没有为 null。 */
  notice: AppServiceExitNotice | null;
}

/**
 * 启动/恢复那条：**时间 + 原因 + 该做什么** 一次给全。
 *
 * 三段缺一不可（规范 §10.3.1）：时刻回答「什么时候」，`why` 回答「为什么」，
 * `action` 回答「现在怎么办」。缺原因时**不编一个**「未知原因」，而是说明这一份
 * 记录没读到、并给出通用出路——理由同 `dev-server-status.ts` 的 offline 分支。
 *
 * 标题分三档而不是两档：「恢复」看的是本次会话有没有见过断开，「重启」看的是有
 * 没有上一份进程结束的记录（读得到记录 = 确实有一份进程结束了），都没有才是
 * 「启动」。三档对三件事，不把「重启」说成「首次启动」。
 */
export function describeAppServiceStart(
  input: AppServiceStartInput,
): AppServiceMessageText {
  const { at, offlineAt, exitAt, notice } = input;
  const recovered = offlineAt !== null;
  const span = recovered ? formatOfflineSpan(offlineAt, at) : null;

  const lines: string[] = [];
  if (recovered) {
    lines.push(
      `${formatClock(offlineAt)} 断开，${formatClock(at)} 恢复` +
        (span === null ? "" : `，持续 ${span}`) +
        "。",
    );
  } else {
    lines.push(
      notice === null
        ? `应用服务于 ${formatClock(at)} 应答。`
        : `应用服务于 ${formatClock(at)} 应答（上一份进程此前结束）。`,
    );
  }

  if (notice) {
    const exitedAt = exitAt === null ? null : formatClock(exitAt);
    lines.push(
      (exitedAt === null
        ? "上一次它是怎么结束的："
        : `上一次它在 ${exitedAt} 结束：`) +
        `${notice.why}。${notice.detail}。`,
    );
    lines.push(`建议：${notice.action}。`);
  } else {
    lines.push(
      "没读到上一次结束的原因（run/app-service-exit.json 里没有属于上一次运行的记录" +
        "——纯手工 `pnpm dev` 起的服务、或没有经过启动编排的链路都属这类）。",
    );
    lines.push(
      "应用服务已可正常应答；若反复断开，请把 log/ 下的诊断包带上排查。",
    );
  }

  const title = recovered
    ? "应用服务已恢复"
    : notice !== null
      ? "应用服务已重启"
      : "应用服务已启动";
  return { title, body: lines.join("\n") };
}
