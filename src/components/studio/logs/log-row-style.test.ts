// @vitest-environment jsdom
/**
 * 日志行样式与**选区判定**的纯逻辑（ISSUE #262 复审）。
 *
 * 用户反馈：「日志到上限了还继续产生新日志，面板中显示的内容就不断移动，我想复制
 * 其中某一项十分困难，甚至无法选择，刚选择就刷新把我的选择弄没了」。
 *
 * 一半的解法在 store（贴底基线不再追着最新跑），另一半在这里：
 * 贴底前要问一句「用户是不是正在框选日志正文」，正在框就不动滚动位置。
 * 这条判据是纯函数（规范 17 第①层），可脱离浏览器直接断言；真实浏览器里的
 * 「框住之后内容不再自己上移」由规范 07 §7.22 的现场复核兜底。
 */
import { describe, expect, it } from "vitest";

import {
  LOG_ROW_TEXT_ATTRIBUTE,
  selectionInsideLogs,
  type SelectionLike,
} from "./log-row-style";

/** 造一段带行正文标记的 DOM（与 LogRow 渲染出来的结构一致）。 */
function renderRows(): { inRow: Text; outside: Text } {
  document.body.innerHTML = `
    <div class="panel">
      <div data-log-index="0">
        <span ${LOG_ROW_TEXT_ATTRIBUTE}>第一行日志内容</span>
      </div>
    </div>
    <p id="other">页面里别的文本</p>
  `;
  return {
    inRow: document.querySelector(`[${LOG_ROW_TEXT_ATTRIBUTE}]`)!
      .firstChild as Text,
    outside: document.querySelector("#other")!.firstChild as Text,
  };
}

/** 「用户框了某段文本」的最小选区视图。 */
function selectionOn(node: Node | null, collapsed = false): SelectionLike {
  return {
    rangeCount: node ? 1 : 0,
    anchorNode: node,
    focusNode: node,
    isCollapsed: collapsed,
  };
}

describe("selectionInsideLogs 选区是否落在日志正文里", () => {
  it("选在日志行的文本节点上 → true（复制日志时的常见形态）", () => {
    const { inRow } = renderRows();
    expect(selectionInsideLogs(selectionOn(inRow))).toBe(true);
  });

  it("选在日志行元素本身上 → true（浏览器给的是元素端点）", () => {
    const { inRow } = renderRows();
    const element = (inRow.parentElement ?? inRow) as Node;
    expect(selectionInsideLogs(selectionOn(element))).toBe(true);
  });

  it("选在页面里别的文本上 → false（不该因为别处的选区就停止贴底）", () => {
    const { outside } = renderRows();
    expect(selectionInsideLogs(selectionOn(outside))).toBe(false);
  });

  it("折叠选区（只是点了一下光标）不算在框选 → false", () => {
    const { inRow } = renderRows();
    expect(selectionInsideLogs(selectionOn(inRow, true))).toBe(false);
  });

  it("取不到选区（jsdom / 无选区 API）→ false，不因此整体关掉贴底", () => {
    expect(selectionInsideLogs(null)).toBe(false);
    expect(
      selectionInsideLogs({
        rangeCount: 0,
        anchorNode: null,
        focusNode: null,
        isCollapsed: false,
      }),
    ).toBe(false);
  });
});
