/**
 * ci-autofix-duties.mjs — 平台侧「这一档的验签红了，能不能就地补上再验一次」的
 * **唯一登记表**（ISSUE #1981）。
 *
 * ## 立案现场
 *
 * 用户的原话是：「`pnpm doc:render` 尽量不要本地跑，浪费时间。CI 能不能先检测是否有
 * 文档修改，有的话就先跑 `pnpm doc:render` 后一并提交，提交后再重新 CI」。
 *
 * 这句话拆开是两件相邻但**不同**的事：
 *
 *   · **是否触发** —— 「先检测有没有文档修改」，这件事 `.cnb.yml` 的 stage 级
 *     `ifModify` 已经做完了（`scripts/ci-incremental-gates.mjs` 的登记表，见 §13.5.18）。
 *     没有改动时那一步根本不执行，而这是这条成本的大头（一次全量扫描 vs 一次文件清单比对）。
 *   · **红了怎么办** —— 「先跑一遍再验，别让人本地跑」。这才是本条要补的那一格：
 *     在 `ifModify` 命中之后，判据仍然会红（编辑态文档改了、生成物没跟着重渲染），
 *     而原来的出口只有一句「修法：`pnpm doc:render` 后把结果一并提交」—— 那是在让
 *     提交者（很多时候是 AI / 或是每轮都要重跑一遍流水线的人）做一件**纯机械**的事。
 *
 * 于是这一档的形态变成：**先验一次 → 红了就自己把那一档重新生成一遍、再验一次**。
 * 红了才花钱（绿的时候一次都不多跑），而红的时候省掉的是「一整轮流水线 + 一个人的
 * 手工动作」。
 *
 * ## 两件事刻意**不**做（边界就是这条的成本来源，别顺手扩）
 *
 * 1. **不自己 `git commit` / `git push`。**
 *    这条流水线在 `pull_request` 与 `push` 两个事件上都跑，而「CI 回写分支」的能力与
 *    目标分支的策略绑在一起（`master` 走分支保护；PR 源分支可能来自 fork）—— 那是
 *    一条**单独的决策**，不是这一档能顺手带上的（§13.5.4 已经为「新鲜度账要不要
 *    回写」写过同一条判断）。所以本档交付的是**修好的工作区 + 一句照抄就能用的命令**，
 *    提交与重跑仍由人 / 代理那一侧做。
 * 2. **不逐条改成「一红就自动修」。**
 *    能做这件事的前提有两条，两条都要满足：**产物是纯确定的重新生成**（跑一次就得到
 *    唯一答案、没有人工判断），且**它红了没有第二种成因**（不是「也可能你的源码本身就
 *    有错」）。绝大多数判据不满足第二条 —— 对它们自动「修」，等于把一次真回归悄悄改写成
 *    一次通过。这一档只收**同时满足两条**的那几档，逐条写在 `AUTOFIX_DUTIES` 里。
 *
 *    ⚠️ 两条前提对**生成物**这一族成立，是因为它们判的是「提交进 git 的产物与源同不同步」：
 *    源写错了由别处去红（类型检查 / 单测 / 生产构建），不会借这一档的红呈现。这也是
 *    `生成态文档与源同步` 与 `API 文档生成物与源同步` 能同时收进来的原因 ——
 *    **不是「贵所以自动修」，而是「红了只可能是忘了重新生成」**。
 *
 * ## 「收窄名单只有一处出处」（与 §13.5.18 同一条口径）
 *
 * `tests/ci-autofix-duties.test.ts` 双向核对：
 *   · 登记表里每条 ⇒ `.cnb.yml` 的 `script` 必须是它点名的入口（下面 `args` 逐字出现）；
 *   · `.cnb.yml` 里带 `--autofix`（或 `--fix` 由本表登记）的 stage ⇒ 必须在登记表里。
 * 少了任一半，「哪几档会自己改工作区」就没有唯一出处 —— 而这类失效**不会让任何别的
 * 判据变红**，只会让下一个人在某次构建里突然看到一份被改过的工作树。
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 一条「红了就自己补上再验」的登记。
 *
 * @typedef {object} AutofixDuty
 * @property {string} stage  `.cnb.yml` 里的 stage 名（字面比对）
 * @property {string} entry  入口脚本（仓库相对路径）—— 判据与配置两边都按它认
 * @property {readonly string[]} args `--autofix` 档必须落到的那个判定门（`script` 里的 args 要逐字出现）
 * @property {string} why   「为什么这一档可以自动修」（两条前提各自怎么成立的）
 */

/** @type {ReadonlyArray<AutofixDuty>} */
export const AUTOFIX_DUTIES = [
  {
    stage: "生成态文档与源同步",
    entry: "scripts/render-doc-placeholders.cjs",
    args: ["--check", "--autofix"],
    why:
      "① 纯确定的重生成：`renderDocContent()` 是「当前源 + 当前占位符事实 → 产物」的唯一一处计算，" +
      "`--check` 与写入模式共用它（共用这一份正是它自己写着的要求），所以「重渲染一遍」得到的就是唯一答案，" +
      "没有任何人工判断。② 红只有一种成因：三个方向（落后 / 缺失 / 多余）全部只说明「产物与源不一致」，" +
      "而源一侧不可能因为门禁而「写错」—— 编辑态文档是手写的输入，占位符提取失败会在渲染期抛错（另有出口）。" +
      "⇒ 自动修不会掩盖任何真回归，它做的正是判据红话里那句「修法」。",
  },
  {
    stage: "API 文档生成物与源同步",
    entry: "scripts/check-docs-api.cjs",
    args: ["--check", "--autofix"],
    why:
      "① 纯确定的重生成：typedoc 对同一份源与同一份 `typedoc.json` 产出逐字节相同 —— 这不是推测，" +
      "是判据自己每次都在复核的前提（`verifyDeterminism`：同源两次重生成相同、换一个路径的 worktree 也相同，" +
      "产物不含绝对路径与时间戳）。② 红只有一种成因：三个方向（落后 / 缺失 / 多余）全部只说明" +
      "「`docs/api/**` 与当前源不一致」，而它判的是**提交进 git 的产物**与源的关系，" +
      "不会因为「源码本身有错」而红（源码写错了由 `类型检查` / 单测 / 生产构建各自去红）。" +
      "⇒ 自动修不会掩盖任何真回归，它做的正是判据红话里那句「`pnpm run docs` 后一并提交」。" +
      "⚠️ 修不好时仍然红（孤儿删不掉、两份源映射到同一个产物名这类），见 `checkOrAutofix()` 的第二轮判定。",
  },
];

/** 登记表里的 stage 名集合（判据与配置两边共用，避免各处重算）。 */
export const AUTOFIX_STAGE_NAMES = new Set(AUTOFIX_DUTIES.map((d) => d.stage));

/**
 * 从 `.cnb.yml` 原文里解析出「每个 stage 的 script 行」。
 *
 * 解析口径与 `tests/no-platform-ci-config.test.ts` 的 `stageTimeouts()` /
 * `scripts/ci-incremental-gates.mjs` 的 `parseStageIfModify()` 同构（stage 列表项 =
 * 恰好两空格缩进的 `- name: X`，它下面的 4 空格键属于它）—— 三处都在回答「配置里
 * 写了什么」，同一份缩进口径，别各自发明一套。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {Map<string, string>} stage 名 → `script` 那一行的内容（单行脚本）
 */
export function parseStageScripts(text) {
  /** @type {Map<string, string>} */
  const out = new Map();
  let current = null;

  for (const raw of text.split("\n")) {
    const item = /^ {2}-\s+name:\s*(\S.*?)\s*$/.exec(raw);
    if (item?.[1] !== undefined) {
      current = item[1];
      continue;
    }
    // 同级或更浅的键 = 这一项结束了（`env:` / 顶层 `master:` 等）。
    if (current !== null && /^\S/.test(raw)) current = null;
    if (current === null) continue;

    const script = /^ {4}script:\s*(\S.*)$/.exec(raw);
    if (script?.[1] !== undefined) out.set(current, script[1]);
  }
  return out;
}

/**
 * 校验 `.cnb.yml` 与登记表是否双向同源 —— 判据本体。
 *
 * 运行方式两种都认，但**只认登记过的那个入口**（下面第二半）：`script` 里出现
 * `--autofix` 的 stage 必须在表里。第一半是「表里这条还在配置里跑着、跑的还是那个入口」。
 *
 * 第二条判据（`--autofix` 的 token）由调用方给：本文件不预设「自动修的旗标长什么样」，
 * 因为 `--check` / `--fix` / `--autofix` 三种写法在仓里都存在，把它们压成一个正则
 * 会把「某脚本的 `--fix` 本来就是写入模式」误判成自动修档。
 *
 * @param {string} text `.cnb.yml` 原文
 * @param {readonly string[]} autofixTokens 视为「自动修档」的旗标字面量
 * @returns {string[]} 逐条不一致（人读的话术）
 */
export function checkAutofixDuties(text, autofixTokens = ["--autofix"]) {
  const scripts = parseStageScripts(text);
  /** @type {string[]} */
  const problems = [];

  for (const duty of AUTOFIX_DUTIES) {
    const line = scripts.get(duty.stage);
    if (line === undefined) {
      problems.push(
        `\`${duty.stage}\` 在自动修登记表里，但 .cnb.yml 里没有它的单行 \`script:\` —— ` +
          `要么把这一步补回配置，要么把它从 scripts/ci-autofix-duties.mjs 的 AUTOFIX_DUTIES 里删掉`,
      );
      continue;
    }
    if (!line.includes(duty.entry)) {
      problems.push(
        `\`${duty.stage}\` 的 script 没点名登记表里的入口 ${duty.entry} —— ` +
          `「哪一档会自己改工作区」必须只有一处出处（配置实际跑的是：${line}）`,
      );
      continue;
    }
    const missing = duty.args.filter((a) => !line.includes(a));
    if (missing.length > 0) {
      problems.push(
        `\`${duty.stage}\` 的 script 少了 ${missing.join(" / ")} —— ` +
          `自动修档的判定门必须逐字落在配置上（配置实际跑的是：${line}）`,
      );
    }
  }

  for (const [stage, line] of scripts) {
    if (!autofixTokens.some((t) => line.includes(t))) continue;
    if (AUTOFIX_STAGE_NAMES.has(stage)) continue;
    problems.push(
      `\`${stage}\` 的 script 带着自动修旗标，但不在登记表里 —— ` +
        `「哪几档会自己改工作区」必须只有一处出处：把它登记进 ` +
        `scripts/ci-autofix-duties.mjs（含「为什么这一档可以自动修」），或去掉那个旗标`,
    );
  }

  return problems;
}

/**
 * 读仓库根上的 `.cnb.yml`（判据与自测的唯一入口，别各自拼路径）。
 *
 * @param {string} root 仓库根（调用方给，与 `ci-incremental-gates.mjs` 同一条处置：
 *   判据链上「读哪一份配置」必须显式可见，不靠 cwd 隐式决定）
 * @returns {string}
 */
export function readCnbConfig(root) {
  return fs.readFileSync(path.join(root, ".cnb.yml"), "utf8");
}
