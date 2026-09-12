// @vitest-environment jsdom
/* 只读映射连线的**两端锚点契约**（DOM 级）—— ISSUE #355
 *
 * 线要画出来，两端都得量得到：
 *   · 起点 = 卡片输出端口行右端那颗小圆点（`data-wire-anchor` = 条目 id）；
 *   · 终点 = 宿主卡片上落点那一行（`data-io-key`）或覆盖它的组合控件
 *     （`data-io-pins`）。
 * 这里把两端真的挂进 DOM 量一次：单元测试里的桩能证明几何公式，证明不了
 * 「视图确实按这套属性渲染」—— 属性名写错一个字符，线就静默消失。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { buildParamEntries } from "~/lib/workflow-param-mapping";
import { WorkflowParamCardColumn } from "./WorkflowParamCardColumn";
import { WorkflowParamWires } from "./WorkflowParamWires";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const io: WorkflowIOMap = {
  "9::widget::positive_prompt": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    name: "positive_prompt",
    type: "STRING",
    defaultValue: "一只猫在喝山泉的完整描述词，足够长到被判定成提示词口",
  },
};

/** rect 打桩：jsdom 不做布局，量到的尺寸全 0，线会退化成零长度路径。 */
function stubRect(
  el: Element,
  rect: { left: number; top: number; width: number; height: number },
) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }) as DOMRect;
}

describe("映射连线的两端锚点", () => {
  it("点与宿主行都量得到时，画出一条从圆点外缘到该行的线", async () => {
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const prompt = entries.find((entry) => entry.id === "prompt")!;
    const wire = {
      entryId: prompt.id,
      targetIoKey: "9::widget::positive_prompt",
      manual: false,
    };
    const tree = (
      <div>
        <WorkflowParamCardColumn
          entries={entries}
          resolved={{ [prompt.id]: "9::widget::positive_prompt" }}
          io={io}
        />
        {/* 宿主卡片上被落到的那一行（画布节点里由 DynamicWorkflowForm 渲染）。 */}
        <div data-io-key="9::widget::positive_prompt" />
        <WorkflowParamWires wires={[wire]} />
      </div>
    );
    const { container } = render(tree);

    const dot = container.querySelector(`[data-wire-anchor="${prompt.id}"]`)!;
    const row = container.querySelector(
      '[data-io-key="9::widget::positive_prompt"]',
    )!;
    stubRect(dot, { left: 200, top: 70, width: 12, height: 12 });
    stubRect(row, { left: 400, top: 120, width: 300, height: 40 });

    /* 线层的 parentElement 就是上面这个包装 div —— 它是坐标原点，钉成 (0,0)。
     *  jsdom 里 rect 本来就全 0，这里显式钉一次，断言的坐标才有明确含义。 */
    stubRect(container.firstElementChild!, {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
    /* 组件挂载时会先量一次（那时 jsdom 的尺寸还是 0，线是退化的），随后在
     *  下一帧量第二次 —— 真尺寸在这时生效。jsdom 的 rAF 走定时器，给它一轮
     *  宏任务让重测与随后的 setState 落地。 */
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const svg = container.querySelector('[data-testid="wflib-param-wires"]')!;
    expect(svg).toBeTruthy();
    /* 起点 x = 圆点外缘（left + width + width/2）= 218，终点 x = 宿主行左沿 400。 */
    const path = svg.querySelector("path")!.getAttribute("d")!;
    expect(path).toMatch(/^M 218 \d/);
    expect(path.endsWith(" 400 140")).toBe(true);
  });
});
