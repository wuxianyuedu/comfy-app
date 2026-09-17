// @vitest-environment jsdom
/* 工作流库「画布节点」的只读对外参数卡片列 + 宿主卡片行尾徽标 —— ISSUE #355
 *
 * 库里要看得见「对外参数」，但它不是画布节点：卡片列与宿主卡片并排，卡片说
 * 「这个对外参数由哪些端口组成」，表单行尾的徽标说「这一行属于哪个对外参数」。
 * jsdom 里只断言两处的「有无」与文案，不断言像素。 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import {
  buildParamEntries,
  sizeSubLabel,
  SIZE_SUB_IDS,
} from "~/lib/workflow-param-mapping";
import { WorkflowParamCardColumn } from "./WorkflowParamCardColumn";
import { ParamOwnerTag } from "./ParamOwnerTag";

afterEach(cleanup);

const io: WorkflowIOMap = {
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    nodeTitle: "Text to Image",
    name: "positive_prompt",
    label: "提示词",
    type: "STRING",
    defaultValue: "3只小猫在喝山泉，一张足够长的描述词用于判定为提示词口",
  },
  "5::widget::height": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "height",
    label: "高度",
    type: "INT",
    defaultValue: 1024,
  },
};

const entries = buildParamEntries(io);

/** 尺寸的子口按形态连到同名的那一行（真实工作流就是一条形态一行）。 */
const SIZE_PIN_NAME: Record<string, string> = {
  "size-width": "width",
  "size-height": "height",
  "size-aspect": "aspect_ratio",
  "size-megapixels": "megapixels",
};

/** 作者画过的线（尺寸按形态连、其余连第一个候选）—— 落点只由作者画的线决定，
 *  没有线就是「未配置」，所以这里必须显式给（不再是自动判定）。 */
function wiredFor(
  list: { id: string; pins: { ioKey: string; name: string }[] }[],
) {
  const out: Record<string, string> = {};
  for (const entry of list) {
    const pin =
      entry.pins.find((item) => item.name === SIZE_PIN_NAME[entry.id]) ??
      entry.pins[0];
    if (pin) out[entry.id] = pin.ioKey;
  }
  return out;
}

describe("WorkflowParamCardColumn", () => {
  it("每个对外参数一张卡片（尺寸的六行形态合成一张），卡片头是它的名字", () => {
    const { container } = render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={wiredFor(entries)}
        io={io}
      />,
    );
    for (const entry of entries) {
      /* 尺寸：六行形态共用一张卡（`param-node-size`），下面单独断言。 */
      if (SIZE_SUB_IDS.includes(entry.cls)) continue;
      const card = container.querySelector(
        `[data-testid="param-node-${entry.id}"]`,
      );
      expect(card).toBeTruthy();
      /* 卡片头与端口行读的是同一个名字，所以按卡片作用域断言，不按全屏唯一文本查。 */
      expect(card!.textContent).toContain(entry.label);
    }
    /* 一张「尺寸」卡 + 卡内六行形态；六个子口不再各占一张卡。 */
    expect(
      container.querySelector('[data-testid="param-node-size"]'),
    ).toBeTruthy();
    for (const [index, form] of SIZE_SUB_IDS.entries()) {
      expect(
        screen.getByTestId(`param-node-out-size-${index}`).textContent,
      ).toContain(sizeSubLabel(form));
    }
    for (const form of SIZE_SUB_IDS) {
      expect(screen.queryByTestId(`param-node-${form}`)).toBeNull();
    }
  });

  it("卡片头取契约口清单的展示名（与「工坊封装」页签同一份）—— ISSUE #596", () => {
    /* 同一张卡片在库里由「画布节点」页签与「工坊封装」页签各画一次，两处必须说
     * 同一句话：无条件读 entry.label 时，「尺寸」在一处带括号、另一处只有两个字。 */
    const withLabels = [
      { ...entries[0]!, label: "工作流里的端口名" },
      { ...entries[1]!, label: "另一个端口名" },
    ];
    render(
      <WorkflowParamCardColumn
        entries={withLabels}
        contractEntries={[
          { id: withLabels[0]!.id, label: "提示词" },
          {
            id: withLabels[1]!.id,
            label: "尺寸（比例 + 分辨率 / (百万像素 + 倍数)）",
          },
        ]}
        resolved={wiredFor(withLabels)}
        io={io}
      />,
    );
    /* 标题与端口行都用契约口清单的展示名；工作流里那个名字一处都不出现。 */
    expect(screen.getAllByText("提示词").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("尺寸（比例 + 分辨率 / (百万像素 + 倍数)）").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("工作流里的端口名")).toBeNull();
  });

  it("端口行只列端口本身，落点不再在行尾重复一遍（ISSUE #355 复审）", () => {
    /* 用户圈出「红框内那段没用」：行尾的「→ 落点」与下面那行带类型的输出端口
     * 说的是同一件事（那一行已经写出落点名，还贴着端点圆点）。单端口条目因此
     * 不再在行尾重复标注 —— 只留端口自己的类型。 */
    const { container } = render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={wiredFor(entries)}
        io={io}
      />,
    );
    const promptCard = entries.find((entry) => entry.cls === "prompt")!;
    const card = container.querySelector(
      `[data-testid="param-node-${promptCard.id}"]`,
    )!;
    expect(card.textContent).not.toContain("→ positive_prompt");
    /* 端口行只说「这个对外参数是什么、出去是什么类型」；落到工作流的哪一行
     *  （pin 名）退到行的 title 提示里可查 —— 行上不写工作流内部名。 */
    const row = screen.getByTestId(`param-node-out-${promptCard.id}-0`);
    expect(row.textContent).toContain("提示词");
    expect(row.textContent).toContain("STRING");
    expect(row.textContent).not.toContain("positive_prompt");
    expect(row.getAttribute("title")).toContain("positive_prompt");
  });

  it("端口行显示对外参数自己的名字，落点 pin 名只在 title 里可查", () => {
    render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={wiredFor(entries)}
        io={io}
      />,
    );
    /* 尺寸合成一张卡：行 = 形态（「尺寸 · 高度」）；ComfyUI 内部的 pin 名
     * （`height`）不落在行文字上，只作为「落到哪一行」的提示留在 title。 */
    const row = screen.getByTestId("param-node-out-size-1");
    expect(row.textContent).toContain("高度");
    expect(row.textContent).not.toContain("height");
    expect(row.getAttribute("title")).toContain("height");
  });

  it("卡片带**有类型**的输出端口（提示词 → STRING）—— ISSUE #355 复审", () => {
    render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={wiredFor(entries)}
        io={io}
      />,
    );
    const promptCard = entries.find((entry) => entry.cls === "prompt")!;
    expect(
      screen.getByTestId(`param-node-out-type-${promptCard.id}-0`).textContent,
    ).toBe("STRING");
    /* 尺寸合成一张卡后，类型的来源是**它连上的那一行**：第 1 行是「尺寸 · 高度」，
     * 连到 INT 的 height 那一格。 */
    expect(screen.getByTestId("param-node-out-type-size-1").textContent).toBe(
      "INT",
    );
  });

  it("每张卡片右侧有一颗小圆点端点（可与宿主卡片上的参数相连）", () => {
    /* ISSUE #355 复审：卡片右侧此前是无属性的圆点甚至没有圆点，作者看不出
     * 「这个口能和节点上的哪一行连」。现在圆点画在它对应的**输出端口行**右沿，
     * 且**端点由消费方注入**（ISSUE #529 换成 React Flow 的 <Handle>）——
     * 卡片列只把槽位让出来。 */
    const { container } = render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={wiredFor(entries)}
        io={io}
        endpoint={(port) => (
          <span
            data-testid="probe-endpoint"
            data-endpoint-handle={port.handleId}
          />
        )}
      />,
    );
    const promptCard = entries.find((entry) => entry.cls === "prompt")!;
    /* 端点的 handle id = **落点 ioKey**（全图唯一）—— 用端口名会在同一张卡片上
     *  撞出重复 handle（两个节点各有一行 `text` 时最明显）。 */
    const dot = container.querySelector(
      `[data-endpoint-handle="9::widget::text"]`,
    );
    expect(dot).toBeTruthy();
    /* 端点必须落在输出端口行内（行是 absolute 的锚），而不是卡片上随便一处。 */
    const outputRow = screen.getByTestId(`param-node-out-${promptCard.id}-0`);
    expect(outputRow.contains(dot)).toBe(true);
  });

  it("两个节点各有一行同名 pin（`text`）时，同一张卡内的端点 id 不撞", () => {
    /* 用户口径：「提示词连不上 / 负向提示词拖不出线」。成因是同节点内 handle id
     *  重复：两张卡的候选都是那两行 `text`，而端点此前按**端口名**取 id ——
     *  React Flow 只认第一颗，第二颗拖着没反应。 */
    const dupIo: WorkflowIOMap = {
      "6::widget::text": {
        direction: "input",
        kind: "widget",
        nodeId: "6",
        name: "text",
        label: "正向",
        type: "STRING",
        defaultValue: "a",
      },
      "9::widget::text": {
        direction: "input",
        kind: "widget",
        nodeId: "9",
        name: "text",
        label: "负向",
        type: "STRING",
        defaultValue: "b",
      },
    };
    const dupEntries = buildParamEntries(dupIo, undefined, { mode: "T2I" });
    const { container } = render(
      <WorkflowParamCardColumn
        entries={dupEntries}
        resolved={{}}
        io={dupIo}
        endpoint={(port) => <span data-endpoint-handle={port.handleId} />}
      />,
    );
    for (const cardId of ["prompt", "negative"]) {
      const card = container.querySelector(
        `[data-testid="param-node-${cardId}"]`,
      )!;
      const handles = [...card.querySelectorAll("[data-endpoint-handle]")].map(
        (el) => el.getAttribute("data-endpoint-handle"),
      );
      expect(handles, `${cardId} 卡应有两颗端点`).toHaveLength(2);
      expect(new Set(handles).size, `${cardId} 卡内的端点 id 必须唯一`).toBe(
        handles.length,
      );
    }
  });

  it("尺寸只有一张卡，卡内六行形态各一颗端点", () => {
    /* 「尺寸这里不要显示这么多节点，尺寸只显示一个节点」——六行形态挤在一张卡里，
     * 每行一颗圆点：作者拖哪一行，哪一个形态就落到他松手的那一行上。 */
    const { container } = render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={{}}
        io={io}
        endpoint={(port, index) => (
          <span data-node-handle={port.handleId} data-node-index={index} />
        )}
      />,
    );
    for (const form of SIZE_SUB_IDS) {
      expect(
        container.querySelector(`[data-node-handle="${form}"]`),
        `形态 ${form} 应有自己的端点`,
      ).toBeTruthy();
    }
  });

  it("库里没有对外参数时不渲染卡片列", () => {
    const { container } = render(
      <WorkflowParamCardColumn entries={[]} resolved={{}} io={io} />,
    );
    expect(
      container.querySelector('[data-testid="workflow-param-card-column"]'),
    ).toBeNull();
  });
});

describe("ParamOwnerTag", () => {
  it("有归属时标出对外参数名", () => {
    render(<ParamOwnerTag label="提示词" />);
    expect(screen.getByTestId("wflib-param-owner").textContent).toBe("提示词");
  });

  it("没有归属时不渲染任何东西", () => {
    const { container } = render(<ParamOwnerTag />);
    expect(
      container.querySelector('[data-testid="wflib-param-owner"]'),
    ).toBeNull();
  });
});
