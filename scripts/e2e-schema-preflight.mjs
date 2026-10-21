/**
 * e2e 开跑前的 **schema 预检**：判词（纯函数，不起 drizzle、不碰库）→ 取证（读指纹，
 * 不一致时 dry-run 一次）→ 空库那一档真的把表建齐。
 *
 * 从 `scripts/e2e-run.mjs` 拆出来（§12.6 R5 的同一取向：那一份涨过了 900 行的硬闸，
 * 而这一层是**判据与机制**、留着的那一份是**编排与打印**；同向的先例是
 * `db-push-core.mjs` / `ci-toolchain-python.mjs`）。拆的边界按职责：本文件只回答
 * 「这一趟该不该放行、库要不要先建齐」，「Playwright 怎么起、账怎么记」仍在
 * `e2e-run.mjs`。调用方是 `makePreflightCollectors` 里 schema 那一跳与 `main`。
 */
import {
  canAutoApply,
  pendingStatements,
  pushConverged,
  pushSchema,
  riskyStatements,
} from "./db-push-core.mjs";
import {
  ensureSchemaCurrent,
  probeSchemaFresh,
  probeSchemaSync,
} from "./db-schema-state.mjs";
import { resolveRepoRoot } from "./app-port.mjs";

const ROOT = resolveRepoRoot();

/**
 * 开跑前的 **schema 预检判词**（纯函数，不起 drizzle、不碰库）。
 *
 * ## 为什么 e2e 需要这一卡（ISSUE #1834 收尾翻出来的现场）
 *
 * 本机 dev 库落后当前 schema 好几个版本，而待执行批次里含
 * `DROP TABLE loraTrainingJob`（丢数据）—— 启动链路**按设计**不自动执行这批
 * （`db-schema-state.mjs`：那种变更必须由人决定）。于是 `pnpm dev` 起来时
 * `task` 表一直缺 6 列，`queue-status.server.ts` 的查询 500，
 * **queue-monitor 四条 + main-journey 两条稳定红**，报错话术全在说
 * 「元素没出现」——看着像产品 bug，真因是这一台机器的库没同步。
 *
 * 这一卡不修库（那是人的决定），它只把「跑 8 分钟产出一片看不懂的红」
 * 换成「开跑前 30 秒告诉你要跑什么」：
 *   · 库还是空的（没表 / 读不到）⇒ **建齐它**（`ensure`，见下）；
 *   · 指纹一致 ⇒ 放行（正常机器，零成本，毫秒级）；
 *   · 不一致、dry-run 走到了终态（`No changes detected`）却没有待执行语句 ⇒ 放行
 *     （指纹只是没登记，库本来就对）；
 *   · 不一致、**清单压根没拿到**（它在列出语句之前就要人回答 / 命令没起来 /
 *     输出形态认不出）⇒ **阻断**（ISSUE #1956：这一档过去落在放行侧，
 *     把「没读到」读成「没问题」，而它存在的理由恰恰是防住这一形态）；
 *   · 不一致且全是安全语句（建表 / 建索引 / 加列）⇒ 放行（启动链路会后台应用，
 *     与不带这一卡时的行为一致）；
 *   · 不一致且**含丢数据语句** ⇒ **阻断**：给出逐条语句与 `pnpm db:push` 出口。
 *
 * ## 空库为什么必须在这里**建齐**，而不是「交给启动链路」（ISSUE #1948）
 *
 * 这一档此前对空库说的是「建表那一批启动链路会自动应用」，然后**放行**。那句话
 * 本身没错，错在**时机**：webServer 是 `pnpm dev` / `pnpm start`，两者起
 * schema 同步的方式都是 `spawnSchemaSync` —— **detached、不等待**（那正是它的
 * 设计：把 15~30 秒还给人）。而 Playwright 等的是 `webServer.url` **可访问**，
 * Next 一 up 就满足，于是冒烟档的健康检查断言在**建表还没跑完**时就打过去：
 * 全新检出的现场是 `db: "empty"` ⇒ 503 ⇒ 冒烟那条 `@critical` 必红；用户以为
 * 「跑 `pnpm db:push` 才好」，实际是**这一档的启动顺序**把同步甩在了后面。
 *
 * 所以空库不进「放行」那一档，它是一个**要等**的动作：本档自己在 spawn Playwright
 * 之前把它建齐（`ensureSchemaCurrent`，与 `pnpm db:push` / 启动链路同一个出口，
 * 不另造一份实现）。只有它真建好了才放行 —— 那时冒烟探到的就是一张齐的库。
 *
 * 判据只对**空库**加这一步：`probe === "ready"` 的机器（绝大多数）零成本，
 * 不会因为这条改动多付一次 drizzle。
 *
 * @param {{
 *   probe: "ready" | "missing" | "unknown",
 *   fingerprintMatch: boolean,
 *   pending: string[],
 *   autoApplyable: boolean,
 *   measured?: boolean,
 * }} input
 *   `measured` 回答的是「那趟 dry-run 到底交出了结论没有」：要么列出了一批语句，
 *   要么它自己说了 `No changes detected`。**只有走到「空清单」那一档才会读它**
 *   （`ensure` 与 `proceed` 两条早退都不看它），所以那里不写就等于**没拿到**——
 *   缺省方向落在阻断侧，忘了传也不会把没读到的东西念成「库本来就对」。
 * @returns {{verdict: "proceed" | "ensure" | "abort", reason: string, risky?: string[]}}
 */
export function schemaPreflightDecision({
  probe,
  fingerprintMatch,
  pending,
  autoApplyable,
  measured,
}) {
  if (probe !== "ready") {
    return {
      verdict: "ensure",
      reason:
        "库里还没有表或读不到（全新检出 / 空库）—— 起 Playwright 之前先按 schema 建齐" +
        "（启动链路的同步是后台的、不等它，冒烟档会在建表完成前打健康检查）",
    };
  }
  if (fingerprintMatch) {
    return { verdict: "proceed", reason: "库结构与当前 schema 一致" };
  }
  if (pending.length === 0) {
    /* 「清单是空的」有两种成因，此前在这里被压成了同一种（ISSUE #1956）：
     *   ① drizzle 走到了终态、说没有差异 —— 库本来就对，只是指纹没登记；
     *   ② 它在**列出语句之前**就要人回答（实测复现的那一形：库里有张 `workflowTemplate`
     *      被改名，diff 撞上 `promptNamedWithSchemasConflict`「这是改名还是新建+删除」，
     *      无 TTY 时当场抛，那句 `about to execute` 根本不出现），或命令压根没起来、
     *      或输出形态认不出 —— 那是**没拿到测量**。
     * ② 落阻断侧：这一卡存在的理由正是 #1834 那批「库落后 → 接口 500 → 用例报
     * 「元素没出现」的红，把它放行进来等于删掉它。口径同 §13.6.2
     * 「拿不到测量 ≠ 测量结果是红的」——反过来也不成立：拿不到测量 ≠ 库是好的。 */
    if (!measured) {
      return {
        verdict: "abort",
        reason:
          "那趟 dry-run 没交出语句清单，也没说「没有差异」——它要先问人一个问题（典型是" +
          "「这张表是改名了，还是删旧的建新的」），而无 TTY 时问不出来。" +
          "所以这一读数**回答不了**库里到底有没有待应用变更，不能读成「库本来就对」。",
      };
    }
    return {
      verdict: "proceed",
      reason:
        "指纹不一致，但 dry-run 说没有待执行语句（指纹只是没登记，库本来就对）",
    };
  }
  if (autoApplyable) {
    return {
      verdict: "proceed",
      reason: `待执行 ${pending.length} 条全是安全语句（建表 / 建索引 / 加列）—— 启动链路会后台应用`,
    };
  }
  return {
    verdict: "abort",
    reason:
      "库结构与当前 schema 不一致，且待执行语句里含「会丢数据」的变更 —— " +
      "启动链路（含本轮 webServer 的 pnpm dev）按设计不自动执行这批",
    risky: riskyStatements(pending),
  };
}

/**
 * 那趟 dry-run 到底**交出了结论**没有 —— 空清单的两种成因在这一处分岔。
 *
 * 认得的两种「答了」：
 *   · 列出了一批待执行语句（`pendingStatements` 非空）；
 *   · 它自己走到了终态 `[i] No changes detected`（`pushConverged`）—— 库本来就对，
 *     只是指纹没登记。这一形必须继续放行，否则把 #1834 的解药变成了新 blocker。
 *
 * 其余一律**没答**（判 false）：在列出语句之前就要人回答（实测那一形是库里一张表
 * 被改名，diff 撞上 `promptNamedWithSchemasConflict`，无 TTY 当场抛，
 * `about to execute` 不出现）、命令压根没起来、说了 `Changes applied` 却读不出清单、
 * 输出形态认不出。把它们读成「没问题」就是 ISSUE #1956 的 fail-open。
 *
 * 两份原话都取自临时副本上的真跑（仓库与活库未碰），并钉在
 * `tests/e2e-run.test.ts` —— 判「答没答」的是这句，而不是某次机器的红绿。
 *
 * @param {string} output 那趟 dry-run 的 stdout + stderr（`pushSchema` 的 `firstOutput`）
 * @param {string[]} pending `pendingStatements(output)` 的结果，传进来免得再解析一遍
 * @returns {boolean}
 */
export function dryRunConcluded(output, pending) {
  return pending.length > 0 || pushConverged(output);
}

/**
 * 开跑前的 schema 预检（取证那一层：读指纹，不一致时 dry-run 一次 drizzle）。
 *
 * 与 `db-schema-state.mjs` 的 `ensureSchemaCurrent` **同源不同职**：那个是
 * 启动链路的唯一出口（会真的去同步），这个只回答「该不该放行 e2e 这一趟」，
 * 本函数**自己也不写库** —— 它只在空库那一档回 `ensure`，由 `main` 调那份唯一
 * 实现去建（见下）。指纹一致时零成本（不启动 drizzle）；只有不一致才付一次
 * dry-run（本机约 17 秒）—— 而那一刻本来就该被拦下。
 *
 * @param {string} [root]
 * @param {{
 *   sync?: typeof probeSchemaSync,
 *   fresh?: typeof probeSchemaFresh,
 *   dryRun?: (r: string) => { firstOutput: string },
 * }} [reads]
 *   三处外部读数都可注入，为的是让**接线**本身能被钉住：#1956 那个 fail-open 修在
 *   「怎么分空清单的两种成因」上，而那一句长在调用点 —— 只判 `dryRunConcluded`
 *   这个纯函数，改天有人把 `measured` 写成常量 `true`，一条用例都不会红。
 *   缺省就是真读数（本档正常跑时付一次 drizzle）。
 * @returns {{verdict: "proceed" | "ensure" | "abort", reason: string, risky?: string[]}}
 */
export function checkSchemaBeforeRun(root = ROOT, reads = {}) {
  const {
    sync = probeSchemaSync,
    fresh: readFresh = probeSchemaFresh,
    dryRun = (r) => pushSchema(r, { force: false, forward: () => {} }),
  } = reads;
  /* 「表在 && 指纹相符」这两跳**不在这里重写**：它与空库那一档、与
   * `pnpm db:push` 的空转档问的是同一个问题，判据收在
   * `db-schema-state.mjs` 的 `probeSchemaFresh()`（§12.18 —— 两处各写一份
   * 必然分叉）。三种结论的分工在这里只有一句：`synced` 放行、`outdated` 付一次
   * dry-run、`unknown` 不阻断。 */
  const probe = sync(root);
  if (probe !== "ready") {
    return schemaPreflightDecision({
      probe,
      fingerprintMatch: false,
      pending: [],
      autoApplyable: false,
    });
  }
  const fresh = readFresh(root);
  /* 判据失效（读不到 schema 源 / 读不到库里的指纹）时**不阻断**：那一档
   * 没有结论可用，而「拿不到结论」不等于「库是旧的」—— 与 `ensureSchemaCurrent`
   * 报 `unknown` 的同一条口径。 */
  if (fresh.state === "unknown") {
    return {
      verdict: "proceed",
      reason: `${fresh.detail}（判据失效，不阻断）`,
    };
  }
  if (fresh.state === "synced") {
    return schemaPreflightDecision({
      probe,
      fingerprintMatch: true,
      pending: [],
      autoApplyable: false,
    });
  }
  /* `force: false` 在无 TTY 下**多半**是一次 dry-run：它列出语句、再要求确认，
   * 确认弹不出来时原地退出、库不动。但「多半」不是「总是」—— 实测另一形是它在
   * 列出语句**之前**就要人回答（改名撞上重命名询问），那句 `about to execute`
   * 根本不出现。所以「这批变更危不危险」的依据只能从**它真答出来的那部分**取，
   * 读不出来的那一档按「没拿到」判（`dryRunConcluded`，ISSUE #1956）。 */
  const probeRun = dryRun(root);
  const pending = pendingStatements(probeRun.firstOutput);
  return schemaPreflightDecision({
    probe,
    fingerprintMatch: false,
    pending,
    autoApplyable: canAutoApply(pending),
    /* 「拿到了」与「没拿到」的判词只有一份（`dryRunConcluded`）：空清单在这条链上
     * 有两种成因，读错方向就是 #1956 —— 放行侧那句「库本来就对」从此只能由
     * drizzle 自己说出来的 `No changes detected` 支撑，不再由「什么都没读到」支撑。 */
    measured: dryRunConcluded(probeRun.firstOutput, pending),
  });
}

/**
 * 空库那一档：**起 Playwright 之前**把表建齐，并复核它真的落地了。
 *
 * 与 `checkSchemaBeforeRun` 是同一趟的两步：那个只**判**（永远不写库），这个在
 * 判成 `ensure` 时才**做**。做的那一步调的是 `ensureSchemaCurrent` —— 与
 * `pnpm db:push` / 启动链路 / 状态栏「立即同步」**同一份实现**（§12.18：缺能力
 * 补地基，不在调用点重抄一份建表逻辑）。
 *
 * ## 为什么必须等它，而不是「启动链路会后台应用」（ISSUE #1948 的根因）
 *
 * `spawnSchemaSync` 是 detached 且不等待的（那是它的设计：把 15~30 秒还给人），
 * 而 Playwright 要等的只是 webServer 的 URL **可访问**。于是全新检出时冒烟档的
 * 健康检查一定在建表完成之前打过去 —— 现场是 `db: "empty"` ⇒ 503 ⇒ 那条
 * `@critical` 必红，而话术说的是「数据库表还没建好」，看起来像环境没准备好，
 * 实际是这一档的启动顺序把同步甩在了后面。这里把它等回来。
 *
 * ## 判据只认「这一趟做完之后库是不是齐的」
 *
 * `ensureSchemaCurrent` 会按自己的白名单决定做不做（含丢数据语句时它不自动应用、
 * 报 `stale`）—— 本函数不越权，只把它的结论翻成本档的放行/阻断：
 *   · `ready` / `synced` ⇒ 放行（齐了）；
 *   · `missing` / `stale` ⇒ 阻断，出口是 `pnpm db:push`（那是人的决定）；
 *   · `unknown` ⇒ **不阻断**（拿不到结论不等于库是坏的，与另两处 `unknown`
 *     同一条口径），交给随后的用例如实报。
 *
 * 每次调用最多起一轮 drizzle（建表那一档本机实测 2~4 秒，空库一次建齐 23 张表）；
 * 非空库根本到不了这里（`checkSchemaBeforeRun` 已经放行）。
 *
 * @param {{root?: string, forward?: (chunk: string) => void,
 *          ensure?: typeof ensureSchemaCurrent}} [options]
 *   `ensure` 可注入，让两个方向都能被真跑一次。
 * @returns {{verdict: "proceed" | "abort", state: string, reason: string}}
 */
export function ensureSchemaBeforeRun(options = {}) {
  const { root = ROOT, forward, ensure = ensureSchemaCurrent } = options;
  const result = ensure(root, forward ? { forward } : {});
  switch (result.state) {
    case "ready":
      return {
        verdict: "proceed",
        state: result.state,
        reason: "库结构与当前 schema 一致",
      };
    case "synced":
      return {
        verdict: "proceed",
        state: result.state,
        reason: "空库已按 schema 建齐（起 Playwright 之前完成）",
      };
    case "unknown":
      /* 判据失效不阻断：拿不到结论 ≠ 库坏了（同 `checkSchemaBeforeRun` 那两处）。 */
      return {
        verdict: "proceed",
        state: result.state,
        reason: `库结构核对拿不到结论（${result.detail ?? "原因未知"}）—— 不阻断`,
      };
    default:
      /* `missing`（没建成）/ `stale`（含丢数据语句、启动链路不替你做那个决定）。 */
      return {
        verdict: "abort",
        state: result.state,
        reason:
          `数据库没建齐（${result.state}）：${result.detail ?? "原因未知"}。` +
          "这是需要人决定的一步，先执行：pnpm db:push   然后重跑本档。",
      };
  }
}
