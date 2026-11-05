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
 *    `生成态文档与源同步` 能收进来的原因 ——
 *    **不是「贵所以自动修」，而是「红了只可能是忘了重新生成」**。
 *
 *    ⚠️ **API 文档那一档在 2026-10-23 从本表删掉了**（ISSUE #2231）：`docs/api/**`
 *    产物**不再进 git** ⇒ 没有「自动修完再提交」的对象 ⇒ 那一档改成「生成一份 +
 *    自检」，不再带自动修旗标（`.cnb.yml` 的「每日 API 文档生成与自检」；2026-11-05 起
 *    已降到每日档，ISSUE #2537）。
 *    而这恰恰是它**必须**离开的原因：ISSUE #2231 的现场是「master 上那份产物与源差
 *    9 处，而平台那一格报绿」—— 因为那一格的形状是「自动修 + 再判」，「修好了」与
 *    「本来就对」在读数上完全同形 ⇒ 漂移在 CI 上隐形。
 *
 *    ⇒ 留在这里的**只有** `docs/generated/**` 那一族（它仍然提交进 git）。
 *
 * ## 「收窄名单只有一处出处」（与 §13.5.18 同一条口径）
 *
 * `tests/ci-autofix-duties.test.ts` 双向核对：
 *   · 登记表里每条 ⇒ 它的**执行者**必须是它点名的入口（下面 `args` 逐字出现）；
 *   · 执行者表里带 `--autofix`（或 `--fix` 由本表登记）的条目 ⇒ 必须在登记表里。
 * 少了任一半，「哪几档会自己改工作区」就没有唯一出处 —— 而这类失效**不会让任何别的
 * 判据变红**，只会让下一个人在某次构建里突然看到一份被改过的工作树。
 *
 * ## 执行者从「stage」改成「条目」（2026-10-19）
 *
 * 原来这两条各占 `.cnb.yml` 的一个 stage。平台单 stage 有 20m 硬上限，而摊成十几个
 * stage 时每一格都在各付一次 job 开销（现场与理由见 `scripts/ci-heavy-gates.mjs` 头注），
 * 于是它们被收进**一格**：`重档静态判据`。所以登记表的 `stage` 现在是**执行者名**，
 * 那个名字在两张表里指同一件事 —— 配置里的 stage 名，或聚合档里的条目名。
 * 「哪一格装哪些条目」的唯一出处是 `HEAVY_GATES`，本文件只按名字引用它。
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 一条「红了就自己补上再验」的登记。
 *
 * @typedef {object} AutofixDuty
 * @property {string} stage  执行者名（字面比对）：`.cnb.yml` 里的 stage 名，或
 *   `HEAVY_GATES` 里的条目名 —— 两者不会重名（重名时 `checkAutofixDuties` 会报）
 * @property {string} entry  入口脚本（仓库相对路径）—— 判据与配置两边都按它认
 * @property {readonly string[]} args `--autofix` 档必须落到的那个判定门（`script` 里的 args 要逐字出现）
 * @property {readonly string[]} outputs 这一档**会被它改写**的仓库相对路径前缀 ——
 *   「谁会写工作区」与「写到哪一处」必须同处登记：`scripts/ci-workspace-provenance.mjs`
 *   拿这份名单去判「tracked 面上出现的改动是不是登记过的写者干的」，而那条判据要的
 *   恰好是**唯一出处**（另抄一份前缀 = 加一档自动修时会漏改，而漏改的那一侧是静默的）。
 * @property {string} why   「为什么这一档可以自动修」（两条前提各自怎么成立的）
 */

/** @type {ReadonlyArray<AutofixDuty>} */
export const AUTOFIX_DUTIES = [
  /* 这里曾有 `oxfmt 格式` 一条（entry `scripts/ci-format-fixup.mjs`，
   * outputs `src/` + `.storybook/`，ISSUE #2342 的「红 ⇒ 就地修 + bot 推 format-only
   * 提交」）。ISSUE #2610（业主口径 2026-10-29）把它整条摘了：委托回写那一跳在 PR
   * 事件上恒发不出去（令牌缺 `repo-cnb-trigger:rw`，实测 403/errcode 10023），
   * 判与修都挪到本地 D0。**副作用是好的**：`src/` 与 `.storybook/` 从此不在
   * 「CI 会改写的面」名单里，`ci-workspace-provenance.mjs` 少一个合法写者 ——
   * 平台再没有任何一格会写源文件，只有下面这些「源 → 产物」的生成档。 */
  {
    stage: "生成态文档与源同步",
    entry: "scripts/render-doc-placeholders.cjs",
    args: ["--check", "--autofix"],
    outputs: ["docs/generated/"],
    why:
      "① 纯确定的重生成：`renderDocContent()` 是「当前源 + 当前占位符事实 → 产物」的唯一一处计算，" +
      "`--check` 与写入模式共用它（共用这一份正是它自己写着的要求），所以「重渲染一遍」得到的就是唯一答案，" +
      "没有任何人工判断。② 红只有一种成因：三个方向（落后 / 缺失 / 多余）全部只说明「产物与源不一致」，" +
      "而源一侧不可能因为门禁而「写错」—— 编辑态文档是手写的输入，占位符提取失败会在渲染期抛错（另有出口）。" +
      "⇒ 自动修不会掩盖任何真回归，它做的正是判据红话里那句「修法」。",
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
    const item = /^ {2}-\s+name:\s*(?<name>\S.*?)\s*$/.exec(raw);
    const itemName = item?.groups?.name;
    if (itemName !== undefined) {
      current = itemName;
      continue;
    }
    // 同级或更浅的键 = 这一项结束了（`env:` / 顶层 `master:` 等）。
    if (current !== null && /^\S/.test(raw)) {
      current = null;
    }
    if (current === null) {
      continue;
    }

    const script = /^ {4}script:\s*(?<script>\S.*)$/.exec(raw);
    const scriptText = script?.groups?.script;
    if (scriptText !== undefined) {
      out.set(current, scriptText);
    }
  }
  return out;
}

/**
 * 收集**全部执行面**的命令行：stage 名 → 它跑的那条命令。
 *
 * 两个来源，同一条口径：
 *   · `.cnb.yml` 里每个 stage 的单行 `script:`（`parseStageScripts()`）；
 *   · 聚合档 `重档静态判据` 里的每个条目（`HEAVY_GATES` 的 `argv` 拼成一行）。
 *
 * 为什么要合：摊成十几个 stage 时每一格都在各付一次 job 开销，于是它们被收进一格
 * （见 `scripts/ci-heavy-gates.mjs` 头注）。收进去之后「哪一档会自己改工作区」仍然
 * 得逐条可见 —— 否则自动修这件事就从「一处出处」退回「混在一个大 stage 的脚本里」。
 *
 * @param {string} text `.cnb.yml` 原文
 * @param {readonly {name: string, argv: readonly string[]}[]} heavyGates 聚合档的条目
 * @returns {Map<string, string>} 执行者名 → 命令行
 */
export function collectExecutors(text, heavyGates) {
  const out = parseStageScripts(text);
  for (const gate of heavyGates) {
    /* 聚合档的条目名与 stage 名共用一个命名空间：重名会让两份登记各说各话，
     * 而这在配置里完全看不出来（一边是 `- name:`，一边是 JS 数组项）。 */
    if (out.has(gate.name)) {
      throw new Error(
        `ci-autofix-duties: 「${gate.name}」同时是 .cnb.yml 的 stage 名与聚合档的条目名 —— 执行者名必须唯一`,
      );
    }
    out.set(gate.name, gate.argv.join(" "));
  }
  return out;
}

/**
 * 校验配置 + 聚合档 与登记表是否双向同源 —— 判据本体。
 *
 * 运行方式两种都认，但**只认登记过的那个入口**（下面第二半）：命令行里出现
 * `--autofix` 的执行者必须在表里。第一半是「表里这条还在跑着、跑的还是那个入口」。
 *
 * 第二条判据（`--autofix` 的 token）由调用方给：本文件不预设「自动修的旗标长什么样」，
 * 因为 `--check` / `--fix` / `--autofix` 三种写法在仓里都存在，把它们压成一个正则
 * 会把「某脚本的 `--fix` 本来就是写入模式」误判成自动修档。
 *
 * @param {string} text `.cnb.yml` 原文
 * @param {readonly string[]} autofixTokens 视为「自动修档」的旗标字面量
 * @param {readonly {name: string, argv: readonly string[]}[]} heavyGates 聚合档的条目
 *   （缺省为空 = 只认 stage，纯配置的自测样本走这一档）
 * @returns {string[]} 逐条不一致（人读的话术）
 */
export function checkAutofixDuties(text, autofixTokens = ["--autofix"], heavyGates = []) {
  const scripts = collectExecutors(text, heavyGates);
  /** @type {string[]} */
  const problems = [];

  for (const duty of AUTOFIX_DUTIES) {
    const line = scripts.get(duty.stage);
    if (line === undefined) {
      problems.push(
        `\`${duty.stage}\` 在自动修登记表里，但配置与聚合档里都没有这个名字 —— ` +
          `要么把这一步补回来，要么把它从 scripts/ci-autofix-duties.mjs 的 AUTOFIX_DUTIES 里删掉`,
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
    if (!autofixTokens.some((t) => line.includes(t))) {
      continue;
    }
    if (AUTOFIX_STAGE_NAMES.has(stage)) {
      continue;
    }
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
