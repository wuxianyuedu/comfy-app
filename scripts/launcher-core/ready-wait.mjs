/**
 * 就绪等待：轮询探测 → 陈旧路由表自愈 → 超时定性（ISSUE #1811 拆 R5 超限文件）。
 *
 * 从 `dev-launcher.mjs` 的 `run()` 搬出来的这一层，是规范 §3.3 主流程的第 9 步：
 * 「dev server 先退出则立刻定性；连上但 `/api/health` 持续 404 则清缓存重启一次」。
 *
 * **依赖靠注入**：这个模块不 import 主文件（回引会成环），也不用模块级状态 ——
 * 循环里两样会变的东西（探测用的 `dev`、重启 itself）都走 `ctx` 回调，于是这里
 * 判的是「就绪这一件事」，重启实现留在编排器那一层（它要碰 `spawned` 账本、
 * `writeSession` 锚点与端口参数）。
 */

import { classifyProbe, describeProbeState, readDiagnosticsTail } from "./orchestrator.mjs";

/** 等服务就绪的上限（与 .ps1 的 180 次 × 1s 同口径）。 */
export const READY_TIMEOUT_MS = 180_000;

/** 「连上但 /api/health 持续 404」的确切签名 → 判定陈旧路由表，自愈一次。
 *  阈值给 3 次（约 3s）：单次 404 可能只是路由还在按需编译，不足以定性。 */
export const READY_ROUTE_404_THRESHOLD = 3;

/** 「服务已应答但库还没建」连中几次才提示（约 8s）：后台 db-sync 建表要 30 秒
 *  上下，单次 503 完全正常，过早开口等于制造噪声。 */
export const READY_SCHEMA_NOTICE_THRESHOLD = 8;

/**
 * 等症状消失或超时。返回 `{ ready, lastProbeState, recovered }`；**不做**收尾 ——
 * 「dev 先退出」与「超时」两个出口分别交回编排器（它才持有进程账本与收尾入口）。
 *
 * @param {object} ctx
 * @param {(m: string, l?: import("./log.mjs").LogLevel) => void} ctx.log 日志出口
 * @param {(phase: string, progress: number, message: string, extra?: object) => void} ctx.status 进度快照
 * @param {(reason: string) => Promise<void>} ctx.respawnDev 只重启 dev（保住壳）
 * @param {() => boolean} ctx.devExited dev 是否已退出
 * @param {object} target
 * @param {number} target.port
 * @param {string} target.host
 * @param {string | null} target.staleShell
 * @param {string} target.nextOut dev server stdout 落盘文件
 * @param {string} target.nextErr dev server stderr 落盘文件
 * @param {string} target.panelDir Next 面板转录目录
 * @param {number} target.startedAt
 * @returns {Promise<{ ready: boolean, lastProbeState: string, recovered: boolean, tail?: string }>}
 */
export async function waitForDevReady(ctx, target) {
  const { log, status, respawnDev, devExited } = ctx;
  const { port, host, staleShell, nextOut, nextErr, panelDir, startedAt } = target;

  let consecutive404 = 0;
  let consecutiveSchemaNotReady = 0;
  let schemaNoticeSent = false;
  let recovered = false;
  let ready = false;
  /** 最后一次探测的结论：超时出口要靠它讲清「卡在哪一档」（见 §5）。 */
  let lastProbeState = "not-up";
  let pollCount = 0;
  const readyDeadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < readyDeadline) {
    if (devExited()) {
      break;
    }
    const state = await classifyProbe({ port, host });
    lastProbeState = state;
    if (state === "ready") {
      ready = true;
      break;
    }
    if (state === "route-404") {
      consecutive404 += 1;
      if (consecutive404 >= READY_ROUTE_404_THRESHOLD && !recovered) {
        recovered = true;
        consecutive404 = 0;
        log(
          "检测到路由表 404（服务已应答但 /api/health 未进编译图），判定为陈旧 .next 路由表：清缓存重启 dev server 一次。",
          "WARN",
        );
        status("dev-server-starting", 0.35, "检测到路由表不一致，清缓存重启中…", { staleShell });
        await respawnDev("stale-route-table");
        log("dev server 已重启（清缓存后由编排器重新拉起）", "OK");
      }
      consecutiveSchemaNotReady = 0;
    } else if (state === "schema-not-ready") {
      /* 服务活着、路由也在，只是库还没建。**不能就这么空等**：用户看到的将是
       * 「卡了三分钟、应用自己消失」，而真正该做的是「等一下（后台正在建）」
       * 或「跑一次 pnpm db:push」——这句话必须在他还盯着屏幕的时候说出来。 */
      consecutive404 = 0;
      consecutiveSchemaNotReady += 1;
      if (consecutiveSchemaNotReady >= READY_SCHEMA_NOTICE_THRESHOLD && !schemaNoticeSent) {
        schemaNoticeSent = true;
        log(
          "本地服务已应答，但数据库表还没建（/api/health 503，db=empty）。后台同步正在按 schema 建表（约 30 秒）；" +
            "若长时间不就绪，手动跑一次 pnpm db:push（见 docs/standards/launch-and-build.md §9.1）。",
          "WARN",
        );
      }
    } else {
      // not-up（连不上）：正常的「还没起来」，重置两个计数。
      consecutive404 = 0;
      consecutiveSchemaNotReady = 0;
    }
    const left = Math.round((readyDeadline - Date.now()) / 1000);
    const progress =
      0.3 + Math.min(0.6, ((READY_TIMEOUT_MS - left * 1000) / READY_TIMEOUT_MS) * 0.6);
    /* 状态文件降频：就绪等待期每轮都写 launch-status.json（最多 180 次），
     * 而进度条以秒为粒度 —— 每 5 轮写一次足够顺滑；就绪 / 出错等关键状态
     * 变化仍在别处即时写。 */
    if (pollCount % 5 === 0) {
      status(
        "dev-server-starting",
        progress,
        schemaNoticeSent
          ? `数据库表还没建，正在等待自动建表（还剩 ${left}s）…`
          : `正在等待本地服务就绪（还剩 ${left}s）…`,
        { staleShell },
      );
    }
    /* 轮询退避：前 10 次每 1s（快速冷启动大多几秒内就绪），之后 2s、30 次
     * 后 3s —— 冷编译普遍 1~3 分钟，固定 1s 是 180 次探测 + 180 次状态文件
     * 写的纯浪费；就绪感知延迟只出现在冷启动后段（用户本来就在等编译）。
     * 总超时是墙钟 deadline（Date.now()），退避不会缩短它。 */
    pollCount += 1;
    await new Promise((r) => setTimeout(r, pollCount < 10 ? 1000 : pollCount < 30 ? 2000 : 3000));
  }
  if (ready) {
    return { ready: true, lastProbeState, recovered };
  }

  /* 诊断的取词顺序与理由见 orchestrator.readDiagnosticsTail：Next 的输出走
   * stdout，而这里过去只读 stderr（那里通常只有 pnpm 的一行脚本横幅），
   * 于是「最近输出」什么都没说；应用服务自己的转录是随写随见的那一份。 */
  const tail =
    readDiagnosticsTail({
      stderrFile: nextErr,
      stdoutFile: nextOut,
      panelDir,
      panelSince: startedAt,
    }) || "(无输出)";
  return { ready: false, lastProbeState, recovered, tail };
}

/**
 * 超时出口的两句定性（措辞与出口码见规范 §5；调用方拿到后 `shutdown(1)`）。
 *
 * 单独成函数是因为「自愈过一次仍 404」与「干脆没起来」的文案完全不同 —— 前者要
 * 明说「已停止自动重启，避免循环」，后者要按最后一次探测档位给下一步动作。
 *
 * @param {{ lastProbeState: string, recovered: boolean, tail: string, timeoutMs: number }} r
 * @returns {{ log: string, statusMessage: string, level: "ERROR" }} — log 段与启动页标题
 */
export function describeReadyTimeout(r) {
  const stateLine = describeProbeState(r.lastProbeState);
  if (r.recovered) {
    return {
      level: "ERROR",
      log: `清缓存重启一次后 /api/health 仍持续 404，路由表异常未恢复（已停止自动重启，避免循环）。最后一次探测：${stateLine}。最近输出：\n${r.tail}`,
      statusMessage: "路由表持续异常（已自动清缓存重启一次仍未恢复），见 log/nextjs/",
    };
  }
  return {
    level: "ERROR",
    log: `服务未在 ${r.timeoutMs / 1000}s 内就绪。最后一次探测：${stateLine}。最近输出：\n${r.tail}`,
    statusMessage:
      r.lastProbeState === "schema-not-ready"
        ? "数据库表一直没建起来：跑一次 pnpm db:push（见 log/nextjs/）"
        : "服务未在超时内就绪，见 log/nextjs/",
  };
}
