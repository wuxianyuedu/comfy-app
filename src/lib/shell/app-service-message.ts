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
 * ## 三条事实的来源
 *
 * · `state` —— `deriveDevServerStatus` 的三态（见 `~/lib/shell/dev-server-status`）：
 *   `starting`（还没探通）/ `online` / `offline`（曾经通、现在不通）。
 * · `processIsNew` —— 「这份进程对本次页面会话来说是新的」（冷启动或真重启，见
 *   `use-dev-server-liveness`）。**它是「进程换了一个」的唯一权威信号**：探活失败
 *   可能只是显示器关闭 / 后台节流 / 瞬时断网（那几条判据已明确排除「探测失败即
 *   重启」），而整页刷新**并没有**换进程。
 * · `unprobedMs` —— 这一拍之前**没人在探测**的那一段（见
 *   {@link AppServiceFacts.unprobedMs}）。它是「断开持续了多久」这个数字的**可信度
 *   注脚**：探活停表期间墙钟照走，那一段里服务是否可达没人问过，恢复点也就不在
 *   这两个时刻之间任何**可被观测**的位置上。
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
  /** 上一次看到的四态。 */
  state: DevServerState;
  /** 上一次看到的「这份进程是新的吗」。 */
  processIsNew: boolean;
  /** 本次页面会话里观测到的断开时刻；还没断开过为 null。 */
  offlineAt: number | null;
}

/** 一次待记录的事件。 */
export type AppServiceEvent =
  | { type: "disconnect"; at: number }
  /** 路由表不完整：服务在应答、但探活端点 404。用户此刻能做的是重启应用，
   *  而这条消息就是那个出口（状态栏那格只有 24px，说不完整）。 */
  | { type: "route-stale"; at: number }
  | {
      type: "start";
      at: number;
      /** 这次启动之前的断开时刻；本次会话没观测到断开为 null（= 冷启动 / 刷新后才恢复）。 */
      offlineAt: number | null;
      /** 上面那一段断开里**没人在探测**的毫秒数（0 = 每一拍都在探）。 */
      unprobedMs: number;
    };

export interface AppServiceFacts {
  /** 本次看到的四态。 */
  state: DevServerState;
  /** 本次看到的「这份进程对本次页面会话来说是新的吗」。 */
  processIsNew: boolean;
  /**
   * 这一拍之前有多少毫秒**没人在探测**（0 = 紧接上一拍）。
   *
   * 探活会因窗口失焦 / 页面进后台而暂停（`useInterval` 的 `pauseWhenHidden`，
   * 桌面壳里还有 `pauseWhenUnfocused`），后台被节流时定时器也可能拖到一分钟
   * 以上——而暂停/拖拍期间**墙钟照走**。于是「断开 → 恢复」两个时刻相减得到的
   * 那个时长里混着一段根本没人问过服务的时间：它可能早就恢复了，恢复点落在
   * 这中间的哪一刻**无从知道**。这个数就是那段，由事实层带进来（判据
   * `probeGapMs` 在探活那一侧，这里只消费）。
   */
  unprobedMs: number;
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

  /* ①′ 路由表不完整：同样是「此刻这件事就是坏的」，同样只在**进入**那一拍发
   * 一条。不并入上面那一支，是因为用户能做的动作不同 —— 那边等它起来/恢复，
   * 这边只能重启应用；混成同一条消息等于把出口写错。 */
  if (facts.state === "stale" && prev.state !== "stale") {
    return { cursor, event: { type: "route-stale", at: now } };
  }

  /* ② 进程换了一个（冷启动或真重启）：这一条同时覆盖「应用重启了」与「本次会话
   * 第一次见到它」两种，用户读到的都是「它起来了」。判的是**由假转真**而不是
   * 「此刻为真」——后者每拍都成立，会把刷新也记成一次启动。 */
  if (facts.processIsNew && !prev.processIsNew) {
    return {
      cursor: { ...cursor, processIsNew: true, offlineAt: null },
      event: {
        type: "start",
        at: now,
        offlineAt: prev.offlineAt,
        unprobedMs: facts.unprobedMs,
      },
    };
  }

  /* ③ 同一个进程内又通了：探活失败可能是网络抖动（那次不会判定重启），但只要
   * 用户在界面上确实见过「已断开」，恢复就值得记一条——哪怕进程一直没换过。
   * 判 `offlineAt !== null` 而不是上一拍的状态，于是「断了很久才通」只记一条。 */
  if (facts.state === "online" && prev.offlineAt !== null) {
    return {
      cursor: { ...cursor, offlineAt: null },
      event: {
        type: "start",
        at: now,
        offlineAt: prev.offlineAt,
        unprobedMs: facts.unprobedMs,
      },
    };
  }

  return { cursor, event: null };
}

/* ── 文案：把事件与「读回来的原因」变成一条能照着做的消息 ──────────────────── */

/**
 * 未探测的那一段到多长才值得单独标一行。
 *
 * 取 10 秒 = 正常连拍（2 秒一拍）的**五拍**：定时器迟到、单拍超时重来都在这以内，
 * 只有真正停表（窗口失焦 / 页面进后台被节流到分钟级）才会超过这个量级。低于它
 * 的那些间隔写成一句「其中 N 秒没有探测」只会给每条恢复消息都加一行噪声，而
 * 它想说的那件事（这段时间的时长不可信）在那点量级上本来就不成立。
 */
export const UNPROBED_ANNOTATE_MS = 10_000;

/**
 * 断开时长 → 「2 分 05 秒」这类人能读的写法；拿不到时间戳时返回 null。 */
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
 * 断开那条：给时刻 + 去向，**能拿到原因就当场给**。
 *
 * ## 原因为什么不再是「等恢复那条」
 *
 * 探活走的是应用服务自己的 HTTP，服务一不在那条通道必然不通——所以经 HTTP 读
 * `run/app-service-exit.json` 的那条路（`GET /api/dev/last-exit`）在读的这一刻
 * 确实不通。但记录**本身**已经在进程结束那一刻落在盘上了，读不到它纯粹是因为
 * 选错了通道：壳进程活得好好的，它读这个文件不经过任何应用服务
 * （`get_app_service_exit`，见 `~/lib/shell/app-service-exit` 的
 * `fetchCurrentDisconnectExit`）。
 *
 * 所以现在的形态是：
 *   · **拿得到**（壳内，且记录确实是这一次写的）→ 当场把原因与动作写进来；
 *   · **拿不到**（非壳环境 / 旧壳 / 这次断开没留下记录）→ 说清「这一刻拿不到」，
 *     并指向恢复那条。**不编一个「未知原因」**——那等于把规范 §10.3.1 要消灭的
 *     静默又请回来。
 *
 * 旧行为（无论拿不拿得到都只说「原因写在 run/app-service-exit.json，恢复时给」）
 * 是 ISSUE #1915 的现场：用户手里明明有原因（文件就在那儿），界面上却一个字都没有。
 */
export function describeAppServiceDisconnect(
  at: number,
  notice: AppServiceExitNotice | null = null,
): AppServiceMessageText {
  const head =
    `断开时间 ${formatClock(at)}。` +
    "断开期间页面里的查询、保存与任务提交都会失败。\n";
  if (notice) {
    return {
      title: "应用服务已断开",
      body:
        head +
        `原因：${notice.why}。${notice.detail}。\n` +
        `建议：${notice.action}。`,
    };
  }
  return {
    title: "应用服务已断开",
    body:
      head +
      "这一刻读不到结束原因（记录由进程结束那一刻的旁证人写入 run/app-service-exit.json，" +
      "浏览器环境没有壳这条存活通道时读不到它，也可能是这一次断开根本没留下记录）。" +
      "服务恢复后会作为「应用服务已恢复」再记一条，能拿到的原因与建议都在那条里。",
  };
}

/**
 * 路由表不完整那条：说清「服务在、坏的是路由表」与**怎么做**。
 *
 * 为什么不复述状态栏那句 tooltip：状态栏那格只有 24px、右下角位置窄，而这条消息
 * 是「用户事后唯一能翻回来的一次完整说明」——它要把「为什么是我该重启、而不是继续
 * 等」讲明白（页面还能打开，恰恰是最容易让人以为「再等等就好了」的地方）。
 */
export function describeAppServiceRouteStale(
  at: number,
): AppServiceMessageText {
  return {
    title: "应用服务路由异常",
    body:
      `发现时间 ${formatClock(at)}。` +
      "应用服务在应答（页面还能打开），但它的探活端点返回 404 —— 说明这一次启动的路由表不完整，" +
      "部分页面与接口会直接 404，状态栏会一直停在「应用服务路由异常」。\n" +
      "这一步与你的代码无关，也不是数据丢了：它是 Turbopack 开发服务的会话级路由失效。" +
      "关闭应用窗口、重新启动一次即可重建路由表。\n" +
      "重启后仍如此，则删掉项目根目录下的 .next 目录再启动一次。",
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
  /**
   * 上面那一段断开里**没人在探测**的毫秒数（0 = 每一拍都在探）。
   *
   * 来源与语义见 {@link AppServiceFacts.unprobedMs}：探活停表期间墙钟照走，于是
   * 「持续多久」里混着一段没人问过服务的时间。这一段到
   * {@link UNPROBED_ANNOTATE_MS} 以上就单独标一行，而不是把它从时长里减掉——
   * 减掉等于宣称「服务在那一刻已经回来了」，而恢复点无从知道。
   */
  unprobedMs: number;
}

/**
 * 启动/恢复那条：**时间 + 原因 + 该做什么** 一次给全。
 *
 * 三段缺一不可（规范 §10.3.1）：时刻回答「什么时候」，`why` 回答「为什么」，
 * `action` 回答「现在怎么办」。缺原因时**不编一个**「未知原因」，也不把某一种
 * 可能的成因说成事实——只说这一次的形态（冷启动 / 恢复）并给出通用出路，理由
 * 同 `dev-server-status.ts` 的 offline 分支。
 *
 * 标题分三档而不是两档：「恢复」看的是本次会话有没有见过断开，「重启」看的是有
 * 没有上一份进程结束的记录（读得到记录 = 确实有一份进程结束了），都没有才是
 * 「启动」。三档对三件事，不把「重启」说成「首次启动」。
 */
export function describeAppServiceStart(
  input: AppServiceStartInput,
): AppServiceMessageText {
  const { at, offlineAt, exitAt, notice, unprobedMs } = input;
  const recovered = offlineAt !== null;
  const span = recovered ? formatOfflineSpan(offlineAt, at) : null;

  const lines: string[] = [];
  if (recovered) {
    lines.push(
      `${formatClock(offlineAt)} 断开，${formatClock(at)} 恢复` +
        (span === null ? "" : `，持续 ${span}`) +
        "。",
    );
    /* 探活停表那一段**如实标注**而不是从时长里减掉（手验现场：窗口失焦两分多钟，
     * 恢复消息把「没人在问」的那整段算成了断开时长，看起来像服务真的死了两分多
     * 钟，而窗口内的服务日志每一分钟都照常有输出）。为什么不减：那段时间里服务
     * 可能早就恢复了，恢复点无从知道——减掉等于编一个「其实只断了 X 秒」出来。 */
    const unprobedSpan = formatOfflineSpan(0, unprobedMs);
    if (unprobedSpan !== null && unprobedMs >= UNPROBED_ANNOTATE_MS) {
      lines.push(
        `其中 ${unprobedSpan} 没有探测（页面不在前台 / 被后台节流时探活会暂停），` +
          "这段时间服务是否可达无从得知。",
      );
    }
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
    /* 读不到记录有三条互斥的成因（文件从未写过 / 写侧只覆盖启动期那一档 /
     * 记录与当前 runId 相同而被判掉），而「读不到」这一个事实**无法**从中
     * 分辨出是哪一条。因此这里既不编一个成因、也不把其中一条写成事实：
     * 上一版把「纯手工 `pnpm dev` 起的服务」写死在这里，于是走启动编排的
     * 正式入口（双击 exe）的人读到一句与自己完全不符的归因，而那次现场里
     * 服务根本没有退出过 —— 归因猜错比不归因更坏，它会把排查引向另一条路。
     *
     * 能确定、且确实对用户有用的只有**这一次是什么**：冷启动（本次运行还没
     * 结束过，因此「上一次结束」不存在）还是恢复（断开期间没有旁证人写下
     * 结束事实 —— 短暂无响应属这一档）。 */
    lines.push(
      recovered
        ? "这次断开没有留下结束记录：多半是服务在同一次运行内短暂无响应后自己恢复了" +
            "（这种抖动不写下结束记录），或它结束的那一刻没有旁证人记下。"
        : "这是一次冷启动：本次运行里应用服务还没有结束过，因此没有「上一次结束」可读。",
    );
    lines.push(
      /* 指**整包**而不是某个子目录（这一条此前指向 `log/current/nextjs/`）：
       * 一次运行结束时它的输出会被归档进 `log/runs/<时间戳>-<runId>/`，所以
       * 出故障的那一次往往已经不在 `log/current/` 里了 —— 按固定子路径找会
       * 「按提示查了、还是没有」（同 `launch-diagnostics.ts` 的教训）。
       * 打包入口是既有的那一个（面板工具条上的「打包诊断」→
       * `POST /api/logs/diagnostics`），落点 `log/exports/`、含本次运行
       * （`log/current/`）与最近几次归档。 */
      "应用服务已可正常应答；若反复断开，把日志整包带上排查最省事：在「应用日志」" +
        "面板点「打包诊断」，它会把 log/current/ 与最近几次 log/runs/ 打在 " +
        "log/exports/ 下（diagnostics-<时刻>-<runId>.zip）。",
    );
  }

  const title = recovered
    ? "应用服务已恢复"
    : notice !== null
      ? "应用服务已重启"
      : "应用服务已启动";
  return { title, body: lines.join("\n") };
}
