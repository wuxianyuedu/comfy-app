#!/usr/bin/env node
// @ts-nocheck -- UI 基元判据的规则表分片：P87（整块容器自带 backdrop-blur）
/**
 * `ui-primitives-rules.cjs` 的规则表分片 —— 单条 P87。
 *
 * 为什么它单独一份：P87 属于 P67~P86 那一片的编号区间（按编号切分片是本仓的既有
 * 切法，见 `ui-primitives-rules-p67-p86.cjs` 头注），但落进去之后那一片只剩 1 行
 * 余量就撞上 §12.6 R5 的 900 行硬闸 —— 而**下一条判据一进来就红**。与其等到那天
 * 再被迫按编号切出一个空档，不如现在就把 P87 单独成片：切法从「编号区间」变成
 * 「编号区间 + 尾部这一条」。
 *
 * 合并层面零改动：`ui-primitives-rules.cjs` 按数组顺序 `Object.assign`，本片追加在
 * 最后，`Object.keys(RULES)` 的顺序与拆分前逐字一致（那个顺序被 `--report` 的输出
 * 顺序与分档自检依赖着）。引擎 helper 按本片用量解构。
 */
const { stripCommentsCached } = require("./ui-primitives-engine.cjs");

module.exports = {
  /* ── P87「整块容器自己带背景模糊」（硬闸，ISSUE #2031 · 规范 03 §3.13）───────
   * 扁平档说的是「纯色、无阴影、无模糊、无渐变发光」。阴影有真实的分层语义
   * （浮层真的浮在内容之上），所以只禁**按钮上的装饰发光**；**模糊**不一样，
   * 它只在「下面有活的、会动的东西」时才看得出来 —— 一条贴边的降透明条
   * （顶栏 / 页脚 / 只占一条的状态栏）与一张卡片是两件事：
   *
   *   · **贴边条**（有两条对边贴齐容器）就坐在滚动的画布上，模糊在那里是
   *     「内容从底下流过」的唯一可读线索 —— 留；与它成对的 `bg-*` 85-95 档
   *     半透则**不许留**（模糊 + 半透是「同一笔合成税的两半」，§3.13 表格
   *     要求贴边条「留模糊、不再叠半透」，ISSUE #5269 收紧补上这一半）。
   *   · **整块容器**（卡片 / 弹窗 / 浮层 / 提示条）下面是一层带色遮罩或静止
   *     页面：模糊 0 像素效果，代价是把自身与背后的每一份内容拖进一个
   *     backdrop-filter 图层。这一档禁止。
   *
   * 判据按**行**取锚（不是整文件、也不是整串 class）：一行里出现
   * `backdrop-blur*` 之后，依次过两道闸——
   *   ① **两条对边贴齐**（`inset-x-0` / `inset-y-0` / `inset-0`，或
   *      `top-0`+`bottom-0` / `left-0`+`right-0`）。单独一个 `fixed` 只说明
   *      脱文档流、不说明贴住了容器两条边，**不足以放行**（ISSUE #5269：
   *      `AgentOverlay` 的 `bg-panel-deep/95 ... fixed ... backdrop-blur-xl`
   *      与 `GlobalStepLogPanel` 的 `fixed top-16 right-3 ... backdrop-blur-sm`
   *      都曾凭一个 `fixed` 漏过）。
   *   ② 即便形状是贴边条，底色也不得带 `/85~95` 高不透明半透档
   *      (`bg-panel/95` + `backdrop-blur-sm` 的 `BrowserStatusBar` 曾漏过)。
   *
   * 两道任一不满足即判红；`ui/dialog-overlay.ts` 的遮罩是
   * `fixed ... inset-0 ... bg-scrim ... backdrop-blur-xs`：`inset-0` 过①、
   * `bg-scrim` 不带 `/85~95` 过②，继续豁免（§3.13 明确）。
   *
   * 为什么锚「贴边」而不是白名单文件：白名单会随新增屏漂移（同 P86 的教训），
   * 而「这一条是不是贴着容器边」是**从形状读得出来的**。
   *
   * ⚠️ 判定范围是**视图层**（默认作用域）。`ui/` 走 `UI_ALSO_SCANNED` 一起扫：
   * 基元自己带模糊是更贵的一处 —— 它下面所有调用点会一起绕开这条规范。 */
  P87: {
    label:
      "整块容器自带 backdrop-blur（卡片/弹窗/浮层下面没有活的内容，模糊 0 像素效果却整树多一个图层；贴边条要求两条对边贴齐且底色不带 /85~95 半透）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      let n = 0;
      for (const line of t2.split("\n")) {
        if (!/backdrop-blur/.test(line)) {
          continue;
        }
        /* 闸①：两条对边贴齐才算贴边条。`fixed` 刻意不在集合里 —— 它只说明
         * 元素脱文档流，不能单独短路（ISSUE #5269 收紧）。 */
        const spansBoth =
          /\b(?:inset-[xy]-0|inset-0)\b/.test(line) ||
          (/\btop-0\b/.test(line) && /\bbottom-0\b/.test(line)) ||
          (/\bleft-0\b/.test(line) && /\bright-0\b/.test(line));
        if (!spansBoth) {
          n++;
          continue;
        }
        /* 闸②：贴边条也不许再叠 /85~95 的高不透明半透底色 —— 模糊 + 半透
         * 是同一笔合成税的两半，§3.13 表格要求贴边条「留模糊、去半透」。 */
        if (/\bbg-[\w-]+\/(?:8[5-9]|9[0-5])\b/.test(line)) {
          n++;
        }
      }
      return n;
    },
  },
};
