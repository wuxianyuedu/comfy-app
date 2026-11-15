#!/usr/bin/env node
// @ts-nocheck -- UI 基元判据的**声明合并层**（规则表 RULES 与扫描面/豁免的重导出）
/**
 * `check-ui-primitives.cjs` 的声明层门面（ISSUE #1811 拆 R5 超限文件）。
 *
 * 两层数据在这里合到一起，主脚本只 `require` 这一份：
 *   · **规则表** `RULES` —— 判据的 `count` 实现，按 P 编号区间切成多份
 *     （`ui-primitives-rules-p1-p37.cjs` 等）后用 `{...a, ...b}` 合并；
 *   · **扫描面与豁免层** —— 在 `ui-primitives-scope.cjs`，这里原样转出。
 *
 * 合并顺序即对象键顺序，与拆分前逐字一致（`Object.keys(RULES)` 的顺序被
 * `--report` 的输出顺序与分档自检依赖着）。
 *
 * 为什么不把 `RULES` 整张表留在这里：2754 行超过 R5 的 900 行阈值，
 * 而阈值是尺子、不是建议 —— 拆出来的新文件同样受它约束。
 */
const RULE_PARTS = [
  require("./ui-primitives-rules-p1-p37.cjs"),
  require("./ui-primitives-rules-p38-p58.cjs"),
  require("./ui-primitives-rules-p59-p66.cjs"),
  require("./ui-primitives-rules-p67-p86.cjs"),
  /* P87 单列一片：它属于 P67~P86 的编号区间，但那一片只剩 1 行余量就撞 R5 的
   * 900 行硬闸（下一条判据一进来就红）。追加在最后 = 键序与拆分前逐字一致。 */
  require("./ui-primitives-rules-p87.cjs"),
  /* P88 单列一片：host 元素原生 `title=`（#3681 出口 A）—— P87 那一片的余量同样
   * 不够再装一条判据进来，按追加于尾部的同一切法。 */
  require("./ui-primitives-rules-p88.cjs"),
];

/** 判据定义的合并表。键序 = 分片的拼接顺序，`Object.keys(RULES)` 的顺序被
 *  `--report` 的输出顺序与分档自检依赖着。 */
const RULES = Object.assign({}, ...RULE_PARTS);

module.exports = {
  ...require("./ui-primitives-scope.cjs"),
  RULES,
};
