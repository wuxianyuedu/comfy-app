/**
 * ci-install-deadline.mjs —— `Install dependencies` 那一跳的**墙钟出口**。
 *
 * ## 它治的是哪一档（ISSUE #2360）
 *
 * 平台那一跑上实测到过一次 `Install dependencies` 挂到**平台 8640s 硬上限**才被掐断
 * （`cnb-c6r-1k5osfdl8`）：整格日志 19 行、**pnpm 自己的输出一行都没有**（前一步的
 * `check-pnpm-available` 刚在同一秒打印过 pnpm 12.4.1），上一跑同机同一条链
 * `Done in 2m 42.7s`。同机对照四跑 169s~275s ⇒ 这不可能是「装得慢」，是**挂住了**。
 *
 * 而挂住的代价不止这一格：它一挂就是一整条流水线被判红、后面三十格全部 `skipped`
 * （`分支守卫` / `类型检查` / `受影响用例` 一个都没跑），而读出来的一句话是
 * `timeout of 8640000ms exceeded` —— 那句话既不说是谁挂的，也不给下一动作。
 *
 * ## 出口 = 自己给一个预算，而不是让平台来掐
 *
 * 挂住的形态里 pnpm 的 stdout 是**空的**（它的进度条是 TTY 才输出的，非交互宿主上
 * 只有末尾那一段 `Done in …`）。所以「卡住」在读数上与「还在跑」逐字同形，等到平台
 * 掐断那一刻，日志里仍然什么都没有。两件事同批做掉：
 *
 *   ① **预算**：装不完就退 **2（未判定）**，并打印「卡在哪一步、已经跑了多久、下一动作」。
 *      `2` 不是绿也不是红 —— 与全仓三态口径一致（§13.6.2）：这一格没给出结论。
 *   ② **心跳**：每 `HEARTBEAT_MS` 打一行「已跑 Ns」。有了它，同一个死法下一次**读得出
 *      「它在第几秒停住的」**，那是定位卡点的唯一线索。
 *
 * ## 预算取多少
 *
 * 硬依据只有一条：平台单 stage 的硬上限（实测强杀形态与它同一句话，
 * `timeout of 8640000ms exceeded`）。在那之下取一个**真跑得完的形态的若干倍**——
 * 本机与节点上的读数跨天不可引用（§13.5.3.4.3：同一条命令 25 分钟内跨 4.4×），
 * 所以这里不写「实测 xx 秒所以给 2×」，而是按平台上限切一个数量级：
 * 上限的 **1/12 ≈ 12 分钟**（读数 169s~275s 的 2.6~4.3 倍，冷装 8 分钟也罩得住）。
 * 卡死形态 12 分钟报出来，而不是 2 小时 24 分钟。
 *
 * 它**不是**「抬 timeout 换绿」的反面操作（§11.13 / §13.6.4 明令禁止抬预算掩盖负载）：
 * 这里不放松任何判据 —— 判据一字未改，改的是「拿不到结论」时的收场方式（早报、说清）。
 *
 * ## 为什么是独立文件
 *
 * `scripts/ci-install-deps.mjs` 已 735 行，逼近 `check-infra-file-size.cjs` 的 900 行硬闸；
 * 而这一块（子进程生命周期 + 心跳 + 定时器）与那份文件的职责（判定「装不装」、
 * 把 pnpm 放回 PATH）不是同一件事。拆在原文件里塞几百行只会把闸撞坏。
 */
import { spawn } from "node:child_process";
import process from "node:process";

/** 默认预算：平台硬上限的 1/12（见文件头「预算取多少」）。 */
export const DEFAULT_INSTALL_BUDGET_MS = 12 * 60 * 1000;

/** 心跳间隔：够密（卡住时读得出第几秒），又不至于把日志撑爆（12 分钟 24 行）。 */
export const HEARTBEAT_MS = 30 * 1000;

/** `unknown` 的 `catch` 参数取一句可读原文（`err?.message` 在 `{}` 上过不了类型面）。 */
function messageOf(/** @type {unknown} */ err) {
  return typeof err === "object" && err !== null && "message" in err
    ? String(/** @type {{message?: unknown}} */ (err).message)
    : String(err);
}

/** 这条退出码是**未判定**，不是红也不是绿（§13.6.2 的三态口径）。 */
export const UNDECIDED_EXIT = 2;

/**
 * 预算值：`COMFY_INSTALL_BUDGET_MS` 可覆盖（单测与真跑都要能造出「跑完预算」这一档）。
 *
 * 读不到 / 非正数 ⇒ 用默认值。**不因为「配错了」就判红**：这一格的存在是为了
 * 早报，而不是为了再加一条能被手滑弄红的输入面。
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {number} 毫秒
 */
export function installBudgetMs(env = process.env) {
  const raw = Number.parseInt(String(env.COMFY_INSTALL_BUDGET_MS ?? ""), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INSTALL_BUDGET_MS;
}

/**
 * 秒级读数（日志里只读整秒，毫秒没有意义）。
 *
 * @param {number} ms @returns {string}
 */
function secs(ms) {
  return `${Math.round(ms / 1000)}s`;
}

/**
 * 起一次 `pnpm install`，**自带墙钟与心跳**。
 *
 * 与 `spawnSync` 那一版的差别只有生命周期：输出仍然直接透给宿主（`stdio: "inherit"`），
 * 所以「pnpm 自己说了什么」这件事一个字没变 —— 变的是**它不说话的时候我们也不再沉默**。
 *
 * @param {{
 *   command: string,
 *   args: string[],
 *   cwd?: string,
 *   budgetMs?: number,
 *   heartbeatMs?: number,
 *   spawnImpl?: typeof spawn,
 *   write?: (s: string) => void,
 *   now?: () => number,
 * }} io
 * @returns {Promise<{code: number, error: string | null, timedOut: boolean, elapsedMs: number}>}
 *   `code` 是**已经归一过**的退出码：超时 / 起不来都折成 2（未判定），跑完则原样透出。
 */
export function runInstallWithBudget(io) {
  const {
    command,
    args,
    cwd,
    budgetMs = DEFAULT_INSTALL_BUDGET_MS,
    heartbeatMs = HEARTBEAT_MS,
    spawnImpl = spawn,
    write = (s) => process.stdout.write(s),
    now = Date.now,
  } = io;
  const started = now();
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    let heartbeat = null;

    const finish = (/** @type {{code: number, error: string | null}} */ out) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      resolve({ ...out, timedOut, elapsedMs: now() - started });
    };

    let child;
    try {
      child = spawnImpl(command, args, { cwd, stdio: "inherit" });
    } catch (error) {
      /* 「起不来」与「跑完但非零」是两档（同 `spawnSettled` 的契约）：前者 stderr 常常是空的。 */
      finish({ code: UNDECIDED_EXIT, error: messageOf(error) });
      return;
    }
    child.on("error", (err) => {
      finish({ code: UNDECIDED_EXIT, error: messageOf(err) });
    });
    child.on("close", (code, signal) => {
      /* 自己的定时器杀掉的：`code` 是 null ⇒ 那一档已经在超时分支里定过性了，
       * 这里只负责不让它被读成「跑完但非零」。 */
      if (timedOut) {
        return;
      }
      finish({
        code: typeof code === "number" ? code : UNDECIDED_EXIT,
        error: signal ? `被信号 ${signal} 结束` : null,
      });
    });

    timer = setTimeout(() => {
      timedOut = true;
      write(
        `\n[ci-install-deps] ⏱ 预算用尽（${secs(budgetMs)}）：这一跳没有跑完 ⇒ 收回子进程，` +
          "记**未判定**（退 2，不是红也不是绿）\n" +
          "[ci-install-deps] 下一动作：看上面最后一行心跳 —— 那一行之后没有任何新输出就是卡点；" +
          "同一条命令在节点上跑得完（读数见 docs/standards/13-提交与-code-review.md §13.5.3.4.3），" +
          "所以卡住多半是「store 在另一块盘 / 被别的作业占着」或「registry 不可达」，" +
          "不要抬 timeout 换绿（§11.13）。\n",
      );
      try {
        child.kill();
      } catch {
        /* 子进程可能已经没了：杀不掉不影响结论，结论来自「预算用尽」这件事本身。 */
      }
      /* 杀不掉也要收场：`unref` 之后父进程不必等它（它的 stdout 已经不进我们的判断）。 */
      setTimeout(() => finish({ code: UNDECIDED_EXIT, error: null }), 1000);
    }, budgetMs);
    /* 定时器不该独自把宿主吊在这里：真正的收场由 close / 预算那支决定。 */
    if (typeof timer.unref === "function") {
      timer.unref();
    }

    heartbeat = setInterval(() => {
      write(`[ci-install-deps] …已跑 ${secs(now() - started)}（pnpm 尚未收场）\n`);
    }, heartbeatMs);
    if (typeof heartbeat.unref === "function") {
      heartbeat.unref();
    }
  });
}
