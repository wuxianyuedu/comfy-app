/**
 * VirtualLogList 的行盒契约（ISSUE #4618）：行盒用 **minHeight** 承载内容，
 * 多行消息撑开行盒、不再被固定行高截断后与后一行重叠；每行带
 * `data-log-index` 供实测校正定位。jsdom 不做布局（offsetHeight 恒 0），
 * 「实测回填」那一跳在真实浏览器里生效，这里钉 DOM 形态与估算下限。
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VirtualLogList } from "./VirtualLogList";
import { LOG_ROW_SINGLE } from "./log-virtual";

/** querySelector 的收窄助手：命中失败当场抛，类型经 instanceof 收窄（不走 as 断言）。 */
function htmlEl(el: Element | null, what: string): HTMLElement {
  if (!(el instanceof HTMLElement)) {
    throw new Error(`${what} 不是 HTMLElement`);
  }
  return el;
}

function renderList(messages: Array<string>) {
  return render(
    <VirtualLogList
      entries={messages.map((message, index) => ({ id: String(index), message }))}
      getMessage={(entry) => entry.message}
      renderRow={(entry) => <div>{entry.message}</div>}
    />,
  );
}

describe("VirtualLogList 行盒（ISSUE #4618）", () => {
  it("行盒用 minHeight 而非固定 height：多行消息撑得开，不再与后一行重叠", () => {
    const long = String.raw`G:\app\python.exe -m comfy_cli run --workflow x.json --json --wait --timeout 600`;
    renderList(["短消息", long]);
    const first = htmlEl(document.querySelector('[data-log-index="0"]'), "第一行行盒");
    const second = htmlEl(document.querySelector('[data-log-index="1"]'), "第二行行盒");
    /* 短消息仍是单行档。 */
    expect(first.style.minHeight).toBe(`${LOG_ROW_SINGLE}px`);
    /* 长消息在估宽（jsdom 量不到面板 → 200px 下限）下折成多行，min-height
     * 高于单行档 —— 估算给到行盒的是「下限」，内容可继续撑开。 */
    expect(Number.parseInt(second.style.minHeight, 10)).toBeGreaterThan(LOG_ROW_SINGLE);
    /* 固定 height 不再出现：它正是「内容比行盒高 → 与后一行重叠」的根因。 */
    expect(first.style.height).toBe("");
    expect(second.style.height).toBe("");
  });

  it("每行带 data-log-index：实测校正按它定位行盒（绝对下标，窗口滑动仍稳定）", () => {
    renderList(["a", "b", "c"]);
    for (const index of [0, 1, 2]) {
      expect(document.querySelector(`[data-log-index="${index}"]`)).not.toBeNull();
    }
  });
});
