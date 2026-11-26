/**
 * VirtualLogList 的行盒契约（ISSUE #4618）：行盒用 **minHeight** 承载内容，
 * 多行消息撑开行盒、不再被固定行高截断后与后一行重叠；每行带
 * `data-log-index` 供实测校正定位。jsdom 不做布局（offsetHeight 恒 0），
 * 「实测回填」那一跳在真实浏览器里生效，这里钉 DOM 形态与估算下限。
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VirtualLogList } from "./VirtualLogList";
import { rowHeightFor } from "./log-virtual";

/** 标准档单行行高（设计稿行距）：行盒下限断言按它推导。 */
const ROW_STD = rowHeightFor("standard");

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VirtualLogList 实测校正（ISSUE #5035 空行 / 卡顿）", () => {
  it("内容比估算矮时收窄到单行档：量的是内容不是带 minHeight 的行盒，空行消失", () => {
    /* jsdom 不做布局，offsetHeight 恒 0 → 给内容元素打桩一个比估算矮的值，
     * 验证实测回调双向采纳（旧实现只接受变高，多估的那行显示成空白）。 */
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(8);
    const long = "a".repeat(120);
    renderList([long]);
    const row = htmlEl(document.querySelector('[data-log-index="0"]'), "行盒");
    /* 收窄但不低于单行档（layoutRows 的 heightOf 出口钳在 base）。 */
    expect(Number.parseInt(row.style.minHeight, 10)).toBe(ROW_STD);
  });

  it("内容比估算高时撑开，不与后一行重叠", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
    renderList(["短"]);
    const row = htmlEl(document.querySelector('[data-log-index="0"]'), "行盒");
    expect(Number.parseInt(row.style.minHeight, 10)).toBeGreaterThanOrEqual(400);
  });

  it("offsetHeight 为 0（jsdom / 未布局）时不写入校正表，不产生 NaN 行高", () => {
    /* 不打桩即 jsdom 的 0；渲染不抛、行盒 minHeight 仍是合法数字。 */
    renderList(["a", "b"]);
    for (const i of [0, 1]) {
      const row = htmlEl(document.querySelector(`[data-log-index="${i}"]`), "行盒");
      expect(Number.isNaN(Number.parseInt(row.style.minHeight, 10))).toBe(false);
    }
  });
});

describe("VirtualLogList 行盒（ISSUE #4618）", () => {
  it("行盒用 minHeight 而非固定 height：多行消息撑得开，不再与后一行重叠", () => {
    const long = String.raw`G:\app\python.exe -m comfy_cli run --workflow x.json --json --wait --timeout 600`;
    renderList(["短消息", long]);
    const first = htmlEl(document.querySelector('[data-log-index="0"]'), "第一行行盒");
    const second = htmlEl(document.querySelector('[data-log-index="1"]'), "第二行行盒");
    /* 短消息仍是单行档。 */
    expect(first.style.minHeight).toBe(`${ROW_STD}px`);
    /* 长消息在估宽（jsdom 量不到面板 → 200px 下限）下折成多行，min-height
     * 高于单行档 —— 估算给到行盒的是「下限」，内容可继续撑开。 */
    expect(Number.parseInt(second.style.minHeight, 10)).toBeGreaterThan(ROW_STD);
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

describe("VirtualLogList 滚动收敛（#5121）", () => {
  it("同一帧内多次 scroll 只排一次下一帧回调", () => {
    const frames: Array<FrameRequestCallback> = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    renderList(["a", "b", "c"]);
    const scroller = htmlEl(document.querySelector(".custom-scrollbar"), "滚动容器");
    scroller.dispatchEvent(new Event("scroll"));
    scroller.dispatchEvent(new Event("scroll"));
    scroller.dispatchEvent(new Event("scroll"));
    expect(frames).toHaveLength(1);
  });
});
