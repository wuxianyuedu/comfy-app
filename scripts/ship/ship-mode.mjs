/**
 * ship-mode.mjs —— `pnpm ship` 的**工作模式**那一格（ISSUE #3512）。
 *
 * 三种模式（规范 §13.6）：
 *   · **默认**（不给 `--mode`）—— 现状：每个显式动作由旗标逐个点名
 *     （`--merge` / `--close-issue` / `--clean-branch`）。
 *   · **`--mode auto`（全托管）** —— 一次点名 = 授权一组显式动作：
 *     `--merge` + `--close-issue` + `--clean-branch`。CI 出终态且为绿 ⇒ 合并；
 *     合并验真 ⇒ 关单（本轮落地行点名的号 ∪ 人点名的号）；然后删这次那条分支。
 *     它是**打包旗标的显式别名**：模式本身是人点名的显式动作，一次也不推断 ——
 *     结论仍只认 build 的 `data.status` 与 PR 的 `is_merged` 两个原值（红线 ② 不变），
 *     与逐枚旗标相比没有新增任何判定、也没有新增任何绕过口。
 *   · **`--mode confirm`（关键步骤确认）** —— 与 auto 同一组动作，但合并 / 关单 /
 *     删分支每一步先问一次；回答不是 `y` / `yes`（含 EOF / 非交互 / 空行）按
 *     **未授权**处理：跳过该动作、念出手动出口。跳过不是失败 —— 与「默认不给
 *     `--merge`」的那一跳同状态（CI 出终态 + 打印下一动作）；但**跳过必须被读出来**：
 *     每个被跳过的动作当场念一行手动出口，收尾结论行再汇总一次（降档不许冒充执行过）。
 *     CI 已经是红的那一跳**不问合并**——问了也只会被 `mergeAndVerify` 的守卫拒掉，
 *     那一跳照旧走「给了 `--merge` 而 CI 红 ⇒ 退 1」的既有语义。
 *
 * 拆这一格的理由与 `ship-args.mjs` 同源：模式跟着「命令行长什么样」动（词表、
 * 展开、确认应答），而 `ship-core` 跟着「外部执行者的读数形状」动。确认应答的
 * **内容**（执行哪些动作）仍全部来自既有阶段表，本模块一次也不判「绿不绿」。
 * `runFinalStages`（终局三跳在模式下的装配）也住在这一档：它是「模式怎么改变
 * 阶段 6–8 的走法」的全部逻辑，留在 `ship.mjs` 会把装配层顶过 900 行硬闸
 * （#3512 首跑现场：975 行）；判定本身（合并验真 / 落地证明 / 删 ref 回读）
 * 仍在 `ship-platform` / `ship-close`，这里只管「问不问、跳不跳、念什么出口」。
 *
 * @module scripts/ship-mode — `pnpm ship` 的工作模式（词表 / 展开 / 确认应答 / 终局三跳装配）
 */
import readline from "node:readline";

import { cleanBranch, mergeAndVerify } from "./ship-platform.mjs";
import { closeIssues } from "./ship-close.mjs";

/** 模式词表（唯一出处；`ship-args.mjs` 与文档都从这里取）。 */
export const SHIP_MODES = ["auto", "confirm"];

/** 一次模式点名授权的显式动作组（与三枚旗标一一对应，展开语义 = 人给了它们）。 */
export const MODE_BUNDLED_FLAGS = ["--merge", "--close-issue", "--clean-branch"];

/**
 * 把模式展开进解析结果（**就地**补旗标，语义与「人亲手给了那三枚旗标」完全一致）。
 *
 * 展开必须发生在 standalone 分派**之前**：`--close-issue <号>` 不带 `--merge` 走的是
 * 「只补关」那一路（`ship-standalone.mjs`），而两种模式都隐含 `--merge`，展开后
 * `closeIssue && !merge` 恒假 ⇒ 模式下永远走主流程（预检 → 提交 → … → 合并后关单），
 * 这正是全托管要的形状。人显式给的旗标（如 `--close-issue 2179`）与模式展开的是
 * 同一批键，并集语义由既有阶段表自然处理，不需要第二套逻辑。
 *
 * @param {{mode?: string | null, merge: boolean, closeIssue: boolean, cleanBranch: boolean}} opt
 *   `parseArgs` 的解析结果（就地修改并返回）
 * @returns {{mode?: string | null, merge: boolean, closeIssue: boolean, cleanBranch: boolean}}
 *   同一个对象（展开后的旗标面；不复制 —— 调用方读的就是它）
 */
export function expandMode(opt) {
  if (opt.mode !== "auto" && opt.mode !== "confirm") {
    return opt;
  }
  opt.merge = true;
  opt.closeIssue = true;
  opt.cleanBranch = true;
  return opt;
}

/**
 * 造一个「向当前终端问一句」的确认应答器（`--mode confirm` 的默认实现）。
 *
 * fail-closed：回答不是 `y` / `yes`（大小写不敏感）一律按**未授权**——空行、
 * EOF、stdin 断流、读到任何别的字都算。确认是**人**的闸，不是第二套判定：
 * 它只决定「这一跳做不做」，做与不做的结论仍由既有执行者给出。
 *
 * @param {{input?: import("node:stream").Readable, output?: import("node:stream").Writable, write?: (s: string) => void}} [io]
 *   输入 / 输出可注入（测试喂 PassThrough）；缺省 = 真实 stdin / stdout。
 *   `write` 是「读不到应答」那一行用的出口，与 readline 的回显分开。
 * @returns {(label: string, detail?: string) => Promise<boolean>} 同意 ⇒ true
 */
export function makeStdinConfirm(io = {}) {
  const write = io.write ?? ((s) => process.stdout.write(s));
  return async function confirmStep(label, detail) {
    const rl = readline.createInterface({
      input: io.input ?? process.stdin,
      output: io.output ?? process.stdout,
    });
    try {
      const head = `[ship] 确认模式 · ${label}${detail ? `（${detail}）` : ""}`;
      /* 回答与「流断了」赛跑：EOF / 断流时 question 的回调可能永远不来（readline 的
       * close 不必然兑现挂着的 question —— 实测 PassThrough 空 end 后 promise 挂死），
       * 干等就是整条 ship 挂死。close / error 先到就按未授权收口（fail-closed）。 */
      const answer = await new Promise((settle) => {
        let settled = false;
        const once = (/** @type {string | null} */ v) => {
          if (settled) {
            return;
          }
          settled = true;
          settle(v);
        };
        rl.question(`${head} —— 执行吗？[y/N] `, (a) => {
          once(a ?? null);
        });
        rl.once("close", () => {
          once(null);
        });
        rl.once("error", () => {
          once(null);
        });
      });
      if (answer === null) {
        write(
          `[ship] 确认模式 · ${label}：读不到应答（stdin 断流 / 非交互）⇒ 按**未授权**处理。\n`,
        );
        return false;
      }
      const a = answer.trim().toLowerCase();
      return a === "y" || a === "yes";
    } finally {
      rl.close();
    }
  };
}

/**
 * 终局三跳（阶段 6 合并 / 阶段 7 关单 / 阶段 8 删分支）在模式下的装配（#3512）。
 *
 * 判定**全部**来自既有执行者：合并验真与删 ref 回读在 `ship-platform.mjs`、
 * 落地证明与关单回读在 `ship-close.mjs` —— 本函数只回答三件事：
 *   ① 这一路要不要问人（`--mode confirm` 且前提成立时问一句 `[y/N]`）；
 *   ② 人拒绝了怎么办（跳过 + 当场念手动出口 + 记入 `confirmSkipped`，收尾结论行
 *      **之前**由调用方的 `finish()` 汇总 —— 跳过不是失败，但不许长得像执行过）；
 *   ③ 被拒合并之后 ⑦⑧ 怎么办（整体跳过：它们的守卫是「合并验真过没有」，硬跑只会
 *      落一串「没跑起来」，而人说的是「不要继续」，那不是失败 —— `mergeDeclined`）。
 *
 * CI 已经红的那一跳**不问合并**（问了也会被 `mergeAndVerify` 的守卫拒掉，那一跳照旧
 * 走「给了 --merge 而 CI 红 ⇒ 退 1」的既有语义）。`buildState` 的词表是
 * `green / red / cancelled / running / unknown`（`ship-poll.mjs`），绿 = "green"，
 * 不是平台原词 "success"。非 confirm 模式下三个门恒开，行为与逐枚旗标逐字相同。
 *
 * @param {{
 *   run: (cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult,
 *   log: (s: string) => void,
 *   want: (phase: string) => boolean,
 *   opt: { merge: boolean, closeIssue: boolean, closeIssueNumbers: number[], cleanBranch: boolean, asMerged: number | null, title: string | null },
 *   modeConfirm: boolean,
 *   confirmStep: (label: string, detail?: string) => Promise<boolean>,
 *   confirmSkipped: string[],
 *   slug: string,
 *   number: number,
 *   frags: string[],
 *   baseRef: string | null,
 *   up: { remote: string | null, base: string | null, source: string },
 *   buildState: "green" | "red" | "cancelled" | "running" | "unknown",
 *   branch: string,
 *   landed: { title: string, sha: string, verified: boolean },
 *   handle: string,
 *   handleExplicit: boolean,
 *   mkTmp: (name: string, text: string) => string | null,
 * }} ctx 装配层既有读数（全部来自 `ship.mjs` 已解析的事实，这里不发第二遍问世界）
 * @returns {Promise<{codes: number[]}>} 三跳各自落下的结论（顺序与阶段表一致）
 */
export async function runFinalStages(ctx) {
  const {
    run,
    log,
    want,
    opt,
    modeConfirm,
    confirmStep,
    confirmSkipped,
    slug,
    number,
    frags,
    baseRef,
    up,
    buildState,
    branch,
    landed,
    handle,
    handleExplicit,
    mkTmp,
  } = ctx;
  const codes = /** @type {number[]} */ ([]);

  // ── 阶段 6：merge（显式；confirm 模式先问一次）────────────
  /** confirm 模式下人拒了没有（拒 ⇒ 阶段 7 / 8 整体跳过，见上方 ③）。 */
  let mergeAuthorized = true;
  if (want("merge")) {
    if (modeConfirm && buildState === "green") {
      mergeAuthorized = await confirmStep("合并 PR", `pr=${number} · CI=${buildState}`);
      if (!mergeAuthorized) {
        confirmSkipped.push(`合并 PR #${number}`);
        log(
          `[ship] 确认模式：合并未授权 ⇒ 跳过（不冒充执行过）。手动出口：` +
            `pnpm ship --merge（PR #${number} 复用不重建）。`,
        );
      }
    }
    if (mergeAuthorized) {
      codes.push(
        mergeAndVerify({
          run,
          log,
          slug,
          number,
          frags,
          baseRef,
          up,
          merge: opt.merge,
          buildState,
          explicitTitle: opt.title,
          /* preflight 钉住的分支名：合并前第二道漂移复核要用。 */
          branch,
          landed,
          /* 只把「人这一跳给了哪个旗标」递过去：合并那一段收尾那句边界声明要按
           * 这一轮实际做了什么来说，不留一句被下一行推翻的话。 */
          cleanBranch: opt.cleanBranch,
        }),
      );
    }
  }
  const mergeDeclined = modeConfirm && !mergeAuthorized;

  // ── 阶段 7：关单（显式，且只跟在验真的合并之后）────────────
  /* 关一张单子是把状态写到别人也看得见、且不会自动回退的地方，与合并本身同一档，
   * 所以同一个口径 —— 默认不开。没合并成而带着它跑，落的是 2 并说明（不是静默跳过、
   * 更不是绿）。confirm 模式下人拒了合并 ⇒ 这一格整体跳过（`mergeDeclined`）。 */
  if (opt.closeIssue && !mergeDeclined) {
    let closeAuthorized = true;
    if (modeConfirm && landed?.verified === true) {
      closeAuthorized = await confirmStep("关单", landed.title || `落地行点名的号（pr=${number}）`);
      if (!closeAuthorized) {
        confirmSkipped.push("关单（--close-issue）");
        log(
          "[ship] 确认模式：关单未授权 ⇒ 跳过。手动出口：" +
            "pnpm ship --close-issue（前提是平台查得到它随某条已合并 PR 落地）。",
        );
      }
    }
    if (closeAuthorized) {
      /* 本轮合并已验真时，`--as-merged` 不参与判决（那一条比"人点名的某条 PR"更强）。
       * 这一句是**读数**、不改退码，但它必须出现：缺了它，下一行念的「依据：本轮落地
       * 那一行点名的」会让人以为旗标被吃掉了。 */
      if (opt.asMerged !== null && landed?.verified === true) {
        log(
          `[ship] --as-merged ${opt.asMerged} 这一跳**不参与判决**：本轮合并已验真` +
            "（比一条点名的 PR 更强的证明）⇒ 号仍从落地那一行的标题本体取。",
        );
      }
      codes.push(
        closeIssues({
          run,
          log,
          slug,
          closeIssue: true,
          landed,
          explicit: opt.closeIssueNumbers,
          handle,
          handleExplicit,
          mkTmp,
          asMerged: opt.asMerged,
        }),
      );
    }
  }

  // ── 阶段 8：清理分支（显式，且只跟在验真的合并之后）──────────
  /* 这一格动的是 ref —— 远端那条删掉后 PR 的评审线索一起没，本地那条是这些提交
   * 唯一的对象（squash 落进主干的是另一笔）。守卫是「合并验真过没有」。 */
  if (opt.cleanBranch && !mergeDeclined) {
    let cleanAuthorized = true;
    if (modeConfirm) {
      cleanAuthorized = await confirmStep("删分支", `branch=${branch}（远端 + 本地）`);
      if (!cleanAuthorized) {
        confirmSkipped.push(`删分支 ${branch}`);
        log(
          "[ship] 确认模式：删分支未授权 ⇒ 跳过。手动出口：" +
            `git push ${up.remote} --delete ${branch} 与 git branch -D ${branch}` +
            "（也可以什么都不做 —— 留着不碍事，pnpm ship --branches 随时给落地读数）。",
        );
      }
    }
    if (cleanAuthorized) {
      codes.push(
        cleanBranch({
          run,
          log,
          remote: up.remote,
          branch,
          landedVerified: landed.verified,
          cleanBranch: true,
        }),
      );
    }
  }
  return { codes };
}
