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
   *     也一并留（模糊 + 半透是一件事的两半，只留半边等于把可读性交给运气）。
   *   · **整块容器**（卡片 / 弹窗 / 浮层 / 提示条）下面是一层带色遮罩或静止
   *     页面：模糊 0 像素效果，代价是把自身与背后的每一份内容拖进一个
   *     backdrop-filter 图层。这一档禁止。
   *
   * 判据按**行**取锚（不是整文件、也不是整串 class）：只要某一行里
   * `backdrop-blur*` 与**贴边定位**（`inset-x-0|inset-y-0|inset-0|fixed` 这类
   * 铺满一段的声明，或 `top-0|bottom-0|left-0|right-0` 里出现两个相对的）
   * 同现，就判定为贴边条、放行；其余一律算整块容器。
   *
   * 为什么锚「贴边」而不是白名单文件：白名单会随新增屏漂移（同 P86 的教训），
   * 而「这一条是不是贴着容器边」是**从形状读得出来的**。
   *
   * ⚠️ 判定范围是**视图层**（默认作用域）。`ui/` 走 `UI_ALSO_SCANNED` 一起扫：
   * 基元自己带模糊是更贵的一处 —— 它下面所有调用点会一起绕开这条规范。 */
  P87: {
    label:
      "整块容器自带 backdrop-blur（卡片/弹窗/浮层下面没有活的内容，模糊 0 像素效果却整树多一个图层；贴边条不在此账）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      let n = 0;
      for (const line of t2.split("\n")) {
        if (!/backdrop-blur/.test(line)) {
          continue;
        }
        /* 贴边条：模糊要盖住的是一段会流动的内容，形态上必然「两条对边贴齐」。
         * 写法集合按实测取：整段铺满（inset-x-0 / inset-y-0 / inset-0 / fixed）、
         * 或两条对边各自归零（top-0+bottom-0 / left-0+right-0）。 */
        const spansBoth =
          /\b(?:inset-[xy]-0|inset-0|fixed)\b/.test(line) ||
          (/\b(?:top|bottom)-0\b/.test(line) &&
            /\b(?:top|bottom)-0\b/.test(line.replace(/^.*?(?:top-0|bottom-0)/, ""))) ||
          (/\bleft-0\b/.test(line) && /\bright-0\b/.test(line));
        if (!spansBoth) {
          n++;
        }
      }
      return n;
    },
  },
};
