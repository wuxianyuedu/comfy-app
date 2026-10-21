/**
 * 三档重档的「单跑」清单：每一档要带哪些前提格。
 *
 * 为什么这张表要存在：单跑那六条流水线（手点 + API 各三条）的 `stages:` 只由
 * **别名引用**组成（`- *stage_daily_install` 这种），格名与锚点的对应能从配置文本里
 * 推出来，所以这里**只存一个决定**：某一档单独跑时，前面必须挂哪几格。
 * 判据 `tests/no-platform-ci-config.test.ts` 拿它去比配置里那六条展开后的清单 ——
 * 两边不一致就红，于是这张表不会漂成装饰。
 *
 * ⚠️ 这张表**不含任何命令**。命令的原文只有 `.cnb.yml` 里锚点定义那一处
 * （那是每日档那十格本来的样子）。单跑口因此结构上不可能长成第二份实现。
 *
 * 为什么前提不能省（取证，不是猜测）：每次构建都是全新 job 目录、`node_modules`
 * 恒不在场（`.cnb.yml` 的 `工作区复用读数` 两跑实测），所以缺前提的那一跑会以
 * 「找不到 next / 连不上库 / 没有浏览器」的形态红 —— 那是**已知的假红**，不是结论。
 * 逐条理由写在每一行的注释上。
 */

/**
 * 一行的形状：某一档 + 它的两个触发口事件键 + 前提格名（顺序即执行顺序）。
 *
 * @typedef {{
 *   gate: string,
 *   eventWeb: string,
 *   eventApi: string,
 *   prereqs: string[],
 * }} OneshotTarget
 */

/** @type {OneshotTarget[]} */
export const ONESHOT_TARGETS = [
  {
    gate: "每日生产构建",
    eventWeb: "web_trigger_build",
    eventApi: "api_trigger_build",
    prereqs: ["每日安装依赖", "每日同步数据库表结构"],
    // 构建链的收尾是 `standalone-private-inputs` → `check-standalone-contents` → 冒烟，
    // 三者都要 `node_modules` 在位，而冒烟起的是那份 standalone 产物、连的是本地库
    // （`.cnb.yml` 那段实测：缺安装档就会以「找不到 next / 连不上库」红）。
  },
  {
    gate: "每日全量E2E",
    eventWeb: "web_trigger_e2e",
    eventApi: "api_trigger_e2e",
    prereqs: ["每日安装依赖", "每日同步数据库表结构", "每日浏览器安装"],
    // `浏览器安装` 是**唯一**的执行者（2026-10-19 起 PR 上那一格撤到这里），
    // 而 `e2e-run.mjs` 真起浏览器、要建库、要 `node_modules`。
    // 顺序照搬每日清单里那一族的相对位置（浏览器在 E2E 之前）—— 那条顺序本身有判据。
  },
  {
    gate: "每日单元测试",
    eventWeb: "web_trigger_unit",
    eventApi: "api_trigger_unit",
    prereqs: ["每日安装依赖"],
    // 全量单测只问「这套代码在锁定的依赖上过不过」；建库与浏览器它不碰。
    // ⚠️ 这一档**故意不带 `每日 Python 可用性`**：Python 那两格答的是 E2E 那条链的
    // 解释器问题（见 `.cnb.yml` 里 `每日 Python 探针读数` 那段），与 vitest 无关。
  },
];

/**
 * 某档的单跑清单：`[前提格…, 目标格]`，顺序是语义所以是数组。
 *
 * @param {OneshotTarget} target `ONESHOT_TARGETS` 里的一行
 * @returns {string[]} 格名，按执行顺序
 */
export function oneshotGates(target) {
  return [...target.prereqs, target.gate];
}
