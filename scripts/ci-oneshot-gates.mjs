/**
 * 三档重档的「单跑」清单：每一档要带哪些前提格，以及单跑那一份的格名。
 *
 * 为什么这张表要存在：单跑那六条流水线（手点 + API 各三条）的 `stages:` 引用三张整表
 * 锚点（`.oneshot-build` / `.oneshot-e2e` / `.oneshot-unit`），而**前提格里那些正文是每日
 * 那几格的副本**（元素级别名这条路被否掉了，理由写在 `.cnb.yml` 那三张锚点头上）。
 * 副本必须有「不许漂」的那条线，而判据要知道每个 `单跑<档>·X` 对应哪一格 `每日X` ——
 * 这个对应关系是一个**决定**，不能从文本推出来，所以它存在这里，判据 import 它。
 *
 * ⚠️ 这张表**不含任何命令**。命令的原文只有 `.cnb.yml` 里那两处（每日那格、单跑那格），
 * 而两处之间的等值由判据判（`tests/no-platform-ci-config.test.ts` 的「逐字相同」那条）。
 *
 * 前提集为什么不能省（取证，不是猜测）：每次构建都是全新 job 目录、`node_modules`
 * 恒不在场（`.cnb.yml` 的 `工作区复用读数` 两跑实测），所以缺前提的那一跑会以
 * 「找不到 next / 连不上库 / 没有浏览器」的形态红 —— 那是**已知的假红**，不是结论。
 * 逐条理由写在每一行的注释上。
 */

/**
 * 一行的形状：某一档 + 它的两个触发口事件键 + 前提格的「每日名 ⇄ 单跑名」配对。
 *
 * @typedef {{
 *   eventWeb: string,
 *   eventApi: string,
 *   pipelineWeb: string,
 *   pipelineApi: string,
 *   prereqs: Array<{ daily: string, oneshot: string }>,
 *   gate: { daily: string, oneshot: string },
 * }} OneshotTarget
 */

/** @type {OneshotTarget[]} */
export const ONESHOT_TARGETS = [
  {
    eventWeb: "web_trigger_build",
    eventApi: "api_trigger_build",
    pipelineWeb: "单跑生产构建（手动触发）",
    pipelineApi: "单跑生产构建（API 触发）",
    gate: { daily: "每日生产构建", oneshot: "单跑构建·生产构建" },
    prereqs: [
      { daily: "每日安装依赖", oneshot: "单跑构建·安装依赖" },
      { daily: "每日同步数据库表结构", oneshot: "单跑构建·同步数据库表结构" },
    ],
    // 构建链的收尾是 `standalone-private-inputs` → `check-standalone-contents` → 冒烟，
    // 三者都要 `node_modules` 在位，而冒烟起的是那份 standalone 产物、连的是本地库
    // （`.cnb.yml` 那段实测：缺安装档就会以「找不到 next / 连不上库」红）。
  },
  {
    eventWeb: "web_trigger_e2e",
    eventApi: "api_trigger_e2e",
    pipelineWeb: "单跑全量E2E（手动触发）",
    pipelineApi: "单跑全量E2E（API 触发）",
    gate: { daily: "每日全量E2E", oneshot: "单跑E2E·全量E2E" },
    prereqs: [
      { daily: "每日安装依赖", oneshot: "单跑E2E·安装依赖" },
      { daily: "每日同步数据库表结构", oneshot: "单跑E2E·同步数据库表结构" },
      { daily: "每日浏览器安装", oneshot: "单跑E2E·浏览器安装" },
    ],
    // `浏览器安装` 是**唯一**的执行者（2026-10-19 起 PR 上那一格撤到这里），
    // 而 `e2e-run.mjs` 真起浏览器、要建库、要 `node_modules`。
    // 顺序照搬每日清单里那一族的相对位置（浏览器在 E2E 之前）—— 那条顺序本身有判据。
  },
  {
    eventWeb: "web_trigger_unit",
    eventApi: "api_trigger_unit",
    pipelineWeb: "单跑全量单测（手动触发）",
    pipelineApi: "单跑全量单测（API 触发）",
    gate: { daily: "每日单元测试", oneshot: "单跑单测·全量单测" },
    prereqs: [{ daily: "每日安装依赖", oneshot: "单跑单测·安装依赖" }],
    // 全量单测只问「这套代码在锁定的依赖上过不过」；建库与浏览器它不碰。
    // ⚠️ 这一档**故意不带 `每日 Python 可用性`**：Python 那两格答的是 E2E 那条链的
    // 解释器问题（见 `.cnb.yml` 里 `每日 Python 探针读数` 那段），与 vitest 无关。
  },
];

/**
 * 某档单跑流水线的格名清单：`[前提…, 目标]`，顺序是语义所以是数组。
 *
 * @param {OneshotTarget} target `ONESHOT_TARGETS` 里的一行
 * @returns {string[]} 单跑那六条流水线里应当出现的格名（按执行顺序）
 */
export function oneshotGates(target) {
  return [...target.prereqs.map((p) => p.oneshot), target.gate.oneshot];
}

/**
 * 某档单跑清单里每一格的「单跑名 ⇄ 每日名」对照（判据据此逐格比正文）。
 *
 * @param {OneshotTarget} target `ONESHOT_TARGETS` 里的一行
 * @returns {Array<{ daily: string, oneshot: string }>}
 */
export function oneshotPairs(target) {
  return [...target.prereqs, target.gate];
}
