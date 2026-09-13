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
import {
  WorkflowParamCardColumn,
  wireAnchorValue,
} from "./WorkflowParamCardColumn";
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
      handleId: "positive_prompt",
      grouped: false,
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

    /* 锚点按「条目 + 被落到的那颗点的 handle id」定位（一个候选一颗点）。 */
    const anchor = wireAnchorValue(prompt.id, "positive_prompt");
    const dot = container.querySelector(`[data-wire-anchor="${anchor}"]`)!;
    expect(dot, `锚点 ${anchor} 应挂在卡片圆点上`).toBeTruthy();
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

/* ── 库内拖线改落点（ISSUE #355：「连线要能编辑，现在编辑不了」）──
 *
 * 库里那份连线不是只读呈现：从卡片圆点按下、拖到宿主卡片的某一行松开，就改
 * 了该对外参数在这个模式下的落点。手势在本层用指针事件实现（库里没有 React
 * Flow 上下文），命中判定复用 `resolveDropTarget`（与画布闸门同一套判据）。
 * 这里走完「按下 → 移动 → 松开」三段，断言落点被上抛且**只在真的命中了行时**
 * 才上抛。 */
describe("库内拖线改落点", () => {
  /** 卡片列 + 宿主行 + 可编辑连线层。 */
  function renderEditable(onConnect: (entryId: string, ioKey: string) => void) {
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const prompt = entries.find((entry) => entry.id === "prompt")!;
    const tree = (
      <div>
        <WorkflowParamCardColumn
          entries={entries}
          resolved={{ [prompt.id]: "9::widget::positive_prompt" }}
          io={io}
          canWire
        />
        <div data-port-dot="9::widget::positive_prompt" />
        <div data-io-key="9::widget::positive_prompt" />
        <div data-io-key="9::widget::negative_prompt" />
        <WorkflowParamWires
          wires={[]}
          onConnect={onConnect}
        />
      </div>
    );
    const { container } = render(tree);
    const dot = container.querySelector(
      `[data-wire-anchor="${wireAnchorValue(prompt.id, "positive_prompt")}"]`,
    )!;
    stubRect(dot, { left: 100, top: 70, width: 12, height: 12 });
    stubRect(container.querySelector('[data-io-key="9::widget::positive_prompt"]')!, {
      left: 300,
      top: 60,
      width: 240,
      height: 30,
    });
    stubRect(container.querySelector('[data-io-key="9::widget::negative_prompt"]')!, {
      left: 300,
      top: 120,
      width: 240,
      height: 30,
    });
    return { container, dot, prompt };
  }

  it("拖到宿主行上松手 → 该行被上抛为落点", async () => {
    const onConnect = vi.fn();
    const { dot, prompt } = renderEditable(onConnect);
    await act(async () => {
      dot.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 106, clientY: 76 }),
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 400, clientY: 75 }),
      );
    });
    /* 拖动中就该看得见一条预览线（否则「拖了没反应」与「拖坏了」长得一样）。 */
    expect(
      document.querySelector('[data-testid="wflib-param-wire-preview"]'),
    ).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 400, clientY: 75 }),
      );
    });
    expect(onConnect).toHaveBeenCalledWith(
      prompt.id,
      "9::widget::positive_prompt",
    );
  });

  it("拖到空白处松手 → 不上抛（不写映射，也不留悬空线）", async () => {
    const onConnect = vi.fn();
    const { dot } = renderEditable(onConnect);
    await act(async () => {
      dot.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 106, clientY: 76 }),
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 900, clientY: 900 }),
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 900, clientY: 900 }),
      );
    });
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("拖到另一行 → 改到那一行（改落点不是新连一条）", async () => {
    const onConnect = vi.fn();
    const { dot, prompt } = renderEditable(onConnect);
    await act(async () => {
      dot.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 106, clientY: 76 }),
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 400, clientY: 135 }),
      );
    });
    expect(onConnect).toHaveBeenCalledWith(
      prompt.id,
      "9::widget::negative_prompt",
    );
  });
});

/* ── 选中一条线后按 ⌫ 断开 ──
 *
 * 线层整层不吃指针事件（它盖在卡片与宿主卡片之上），所以键盘监听挂在 document
 * 上；否则这条快捷键永远按不动。焦点在输入框里时不拦截（那里的退格是删字）。 */
describe("断开与取消选中", () => {
  function renderSelected(onDisconnect: (id: string) => void, onSelect = vi.fn()) {
    const { container } = render(
      <div>
        <WorkflowParamWires
          wires={[
            {
              entryId: "size",
              targetIoKey: "5::widget::multiple",
              handleId: "multiple",
              grouped: false,
              manual: true,
            },
          ]}
          selectedEntryId="size"
          onSelect={onSelect}
          onDisconnect={onDisconnect}
        />
        <input data-testid="probe-input" />
      </div>,
    );
    return { container, onSelect };
  }

  it("按 ⌫ 断开选中的那条线", async () => {
    const onDisconnect = vi.fn();
    renderSelected(onDisconnect);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
      );
    });
    expect(onDisconnect).toHaveBeenCalledWith("size");
  });

  it("按 Esc 取消选中（不再指着一个口）", async () => {
    const onSelect = vi.fn();
    renderSelected(vi.fn(), onSelect);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("焦点在输入框里时退格不接头（那是在删字，不是在断线）", async () => {
    const onDisconnect = vi.fn();
    const { container } = renderSelected(onDisconnect);
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="probe-input"]',
    )!;
    input.focus();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
      );
    });
    expect(onDisconnect).not.toHaveBeenCalled();
  });
});
