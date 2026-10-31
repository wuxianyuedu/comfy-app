#!/usr/bin/env node
/**
 * ship-reap.mjs —— 「本检出此刻还跑着什么」的读数，与 `--reap` 那一格的收尾回收。
 *
 * ── 为什么单独一件 ─────────────────────────────────────────────
 *
 * 这一格的两半都**不自己判**：
 *   · 归属只问 `scripts/launcher-core/port-reap.mjs` 的 `runningAppInstances(root)`
 *     —— AGENTS 硬规则 9 的唯一实现（会话锚点心跳 + 端口上进程的命令行命中本检出）。
 *     刻意不按「端口有没有人监听」判：隔壁检出占着同一个端口并不会锁本检出的东西，
 *     按端口判就会去收**别人的**进程。
 *   · 回收只发 `node scripts/reap-process.mjs <pid>` —— 硬规则 3 的唯一入口（整棵树，
 *     平台判据收在 `src/lib/process/kill-process-tree.ts`）。这里不许出现 `taskkill` /
 *     `process.kill` / 按进程名 `node.exe` 泛匹配 —— 「各写一遍」正是历史上
 *     单杀留孤儿与误杀兄弟检出的根因。
 *
 * ── 两档归属，只有一档归 `--reap` 收（这条边界是本格的全部要点）──────
 *
 *   · `via:"port"` —— 有人绕过编排器自己 `pnpm dev` / `node scripts/dev.mjs`，没有会话锚点，
 *     端口上那批进程是本检出的、却没被任何编排器登记过 ⇒ 这才是「任务结束后还在跑的残留」，
 *     归 `--reap` 收。
 *   · `via:"session"` —— **编排器还活着**：那是一条正在被人使用的会话，不是残留。
 *     停它要走编排器自己的收尾路径（`tools/start/*` 或 `node scripts/dev-launcher.mjs` 的
 *     退出回收 —— 那里有 `reapStaleSession` 的归属判据与整组信号），**不由 ship 代劳**；
 *     它也不许被念成「没有需要收的」—— 那是把一个还在跑的应用服务报成无事可做。
 *     所以这一档落 `CODE.NOT_RUN` 并给出口：这一格**没有执行者**，不是通过，也不是红。
 *
 * @typedef {import("./ship-exec.mjs").ExecResult} ExecResult
 */
import { CODE, combineShipCodes } from "./ship-core.mjs";

/**
 * 归属判据的默认取数 —— 动态 import 那唯一一份（`port-reap.mjs` 是 async 的，
 * 这里跟着 async，不在编排里同步起 netstat）。
 *
 * @param {string} root 检出根
 * @returns {Promise<{running: boolean, pids: number[], via: string | null}>}
 */
export async function readAppInstances(root) {
  const { runningAppInstances } = await import("./launcher-core/port-reap.mjs");
  return runningAppInstances(root);
}

/**
 * 把归属读数写成一句人话 —— 纯函数，喂什么形状都只念那一格读到的东西。
 *
 * @param {{running?: boolean, pids?: number[], via?: string | null} | null | undefined} live 读数
 * @returns {string} 「无」/「N 个（via …）」/「没读到（不构成结论）」
 */
export function instanceReading(live) {
  if (!live || typeof live !== "object") {
    return "没读到（**不构成结论**：既不是「无残留」，也不是「有残留」）";
  }
  const pids = Array.isArray(live.pids) ? live.pids : [];
  if (!live.running && pids.length === 0) {
    return "无";
  }
  const via = `via ${live.via ?? "?"} · pids ${pids.join(", ") || "(判据没交出 pid)"}`;
  // `running:false` 却带着 pid 是畸形形状：如实念出来，不替它圆成「无」。
  return live.running
    ? `${pids.length} 个（${via}）`
    : `${pids.length} 个（${via}）—— 判据同时答 running:false，形状矛盾，按在场念`;
}

/**
 * 阶段 0 那一行读数（不给旗标也念）。
 *
 * @param {(s: string) => void} log 输出通道
 * @param {{running?: boolean, pids?: number[], via?: string | null} | null | undefined} live 读数
 */
export function logInstanceReading(log, live) {
  log(
    `[ship] 本检出应用实例：${instanceReading(live)} —— 取自 ` +
      "`runningAppInstances()` 的归属判据（硬规则 9），**这一格是读数，不改退码**",
  );
}

/**
 * `--reap` 对这条读数要怎么处置 —— **判断与效应分家**（与 `decideCloseIssue` 同一形状），
 * 因为「session 那一档不收」这一条最容易在效应代码里被写漏，而写漏的表现是
 * 屏幕上留下一句「没有需要收的」——一句把还在跑的应用服务报成无事可做的谎。
 *
 * @param {{running?: boolean, pids?: number[], via?: string | null} | null | undefined} live 归属读数
 * @returns {{act: "none" | "port" | "session", code: number | null, pids: number[], reason: string}}
 *   `act:"none"` 无事可做（绿）；`"port"` 可收；`"session"` 不归这里收（2）。
 */
export function decideReap(live) {
  const pids = Array.isArray(live?.pids) ? live.pids : [];
  if (!live?.running && pids.length === 0) {
    return { act: "none", code: CODE.GREEN, pids: [], reason: "" };
  }
  if (live?.via === "session") {
    return {
      act: "session",
      code: CODE.NOT_RUN,
      pids,
      reason:
        `本检出有一条**还活着的编排会话**（via session · pids ${pids.join(", ") || "(未给)"}）` +
        " ⇒ 那不是残留，是正在被使用的东西；`--reap` 不杀会话。要停它请走编排器自己的收尾" +
        "（`tools/start/*`，或 `node scripts/dev-launcher.mjs` 的退出回收 —— 那里有整组信号与" +
        " `reapStaleSession` 的归属判据）。这一格记「没有执行者」（不是「没有需要收的」，也不是通过）。",
    };
  }
  if (!pids.length) {
    /* 判据答「在跑」却没给 pid：这时候不能去猜要收谁（按端口反查就是第二套归属判据，
     * 而这一族的全部意义就是不另立第二套）。 */
    return {
      act: "none",
      code: CODE.NOT_RUN,
      pids: [],
      reason:
        `判据答 running:true（via ${live?.via ?? "?"}）却没交出 pid` +
        " ⇒ 不猜要收谁、不按端口反查，这一格记「没有执行者」（不是「已回收」）",
    };
  }
  return { act: "port", code: null, pids, reason: "" };
}

/**
 * 收尾回收：把 `via:"port"` 那批 pid 逐个交回收入口，然后**独立回读**同一条判据再下结论。
 *
 * 三条口径：
 *   · 只发 `scripts/reap-process.mjs <pid>`，只碰判据点名的 pid（不泛匹配、不碰兄弟检出）；
 *   · 每收一个都把它的 `via` 那行原样转述出来 —— 这个工具的职责是如实转述执行者；
 *   · 最后那一次回读才是结论。`reap-process` 全部退 0 而回读说还在 ⇒ 红
 *     （历史形态：打印了命令、退码 0、目标进程还在 —— 见 `reap-process.mjs` 的 `--detach` 说明）。
 *
 * @param {{
 *   root: string,
 *   log: (s: string) => void,
 *   run: (cmd: string, args: string[]) => Pick<ExecResult, "status" | "stdout" | "stderr">,
 *   read?: (root: string) => Promise<{running?: boolean, pids?: number[], via?: string | null}>,
 * }} ctx
 * @returns {Promise<number>} `CODE` 之一
 */
export async function reapCheckoutInstances({ root, log, run, read = readAppInstances }) {
  /** @type {{running?: boolean, pids?: number[], via?: string | null} | null} */
  let live;
  try {
    live = await read(root);
  } catch (e) {
    log(
      `[ship] 归属判据没跑起来（${e instanceof Error ? e.message : String(e)}）` +
        " ⇒ 这一格落「没跑起来」，既不判已回收、也不判有残留",
    );
    return CODE.NOT_RUN;
  }
  const plan = decideReap(live);
  if (plan.act !== "port") {
    if (plan.code === CODE.NOT_RUN) {
      log(`[ship] 收尾回收：${plan.reason}`);
      return CODE.NOT_RUN;
    }
    log(
      "[ship] 收尾回收：本检出没有在跑的应用实例 ⇒ 没有需要收的" +
        "（判据答「无」，不是跳过这一格）",
    );
    return CODE.GREEN;
  }

  /** @type {number[]} */
  const codes = [];
  for (const pid of plan.pids) {
    const r = run("node", ["scripts/reap-process.mjs", String(pid)]);
    const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
    for (const line of out.split("\n").filter(Boolean)) {
      log(`[ship]   ${pid}：${line}`);
    }
    if (r.status === 0) {
      codes.push(CODE.GREEN);
    } else {
      log(`[ship]   ${pid}：回收入口退 ${r.status} ⇒ 这一格是红的（不假定它收掉了）`);
      codes.push(CODE.RED);
    }
  }

  /** @type {{running?: boolean, pids?: number[]} | null} */
  let after;
  try {
    after = await read(root);
  } catch (e) {
    log(
      `[ship] 回读归属判据没跑起来（${e instanceof Error ? e.message : String(e)}）` +
        " ⇒ 不记「已回收」，这一格落「没跑起来」（收令发出去了，落没落不知道）",
    );
    return CODE.NOT_RUN;
  }
  if (!after) {
    log("[ship] 回读没交出形状 ⇒ 同上，记「没跑起来」");
    return CODE.NOT_RUN;
  }
  const left = Array.isArray(after.pids) ? after.pids : [];
  if (after.running || left.length) {
    log(
      `[ship] 回读：本检出**仍有**在跑的应用实例（pids ${left.join(", ") || "(未给)"}）` +
        " ⇒ 这一格是红的，不写「已回收」",
    );
    codes.push(CODE.RED);
  } else {
    log(`[ship] ✓ 回读：本检出已无在跑的应用实例（收掉的是 ${plan.pids.join(", ")}）`);
    codes.push(CODE.GREEN);
  }
  return combineShipCodes(codes);
}
