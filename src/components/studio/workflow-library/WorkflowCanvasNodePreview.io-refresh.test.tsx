/* 默认值刷新（保覆盖）回归 —— ISSUE #288：IO 里改默认值保存后，未动过的参数
 * 显示新默认值，用户改过的保持原值。仅覆盖这条数据流，副作用全部打桩。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* 模式契约注册表（工坊封装 / 画布节点共读的那一份）打桩：
 * 预览现在也读它（卡片头与「工坊封装」页签同一份措辞），jsdom 里没有 tRPC
 * Provider，直接用「无自定义契约」的等价结果 —— 与 `useModeContracts` 在
 * 查询未落地时返回的空数组一致。 */
vi.mock("~/components/workshop/mode-contract/hooks/use-mode-contracts", () => ({
  useModeContracts: () => ({ contracts: [], loading: false, save: vi.fn() }),
}));
vi.mock("~/lib/workshop/generation-client", () => ({
  startLocalGenerate: vi.fn().mockResolvedValue("task-1"),
  watchTask: vi.fn(),
}));
vi.mock("~/lib/workflow/workflow-run-store", () => {
  /* 快照必须引用稳定：每次返回新对象会让 useSyncExternalStore 判定「一直在
   * 变」，触发无限重渲染（"Maximum update depth exceeded"）。 */
  const snapshot = { runs: [] };
  return {
    appendWorkflowRunLog: vi.fn(),
    getWorkflowRunStoreSnapshot: () => snapshot,
    latestRunForWorkflow: () => null,
    patchWorkflowRun: vi.fn(),
    registerWorkflowRun: vi.fn(),
    subscribeWorkflowRunStore: () => () => undefined,
  };
});

import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { buildParamEntries } from "~/lib/workflow/workflow-param-mapping";
import { exposedParamDisplayLabel } from "~/lib/workflow/workflow-exposed-params";
import { WorkflowCanvasNodePreview } from "./WorkflowCanvasNodePreview";

/* 预览卡片现在挂在 React Flow 画布上（ISSUE #355），React Flow 挂载时会自行
 * 测量容器尺寸 —— jsdom 没有 ResizeObserver，需要这个桩。 */
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

afterEach(cleanup);

/** steps=20 / cfg=7 两个 widget 参数。 */
function ioWith(steps: number, cfg: number): WorkflowIOMap {
  return {
    "7::widget::steps": {
      direction: "input",
      kind: "widget",
      nodeId: "7",
      name: "steps",
      label: "步数",
      type: "INT",
      defaultValue: steps,
    },
    "7::widget::cfg": {
      direction: "input",
      kind: "widget",
      nodeId: "7",
      name: "cfg",
      label: "引导系数",
      type: "FLOAT",
      defaultValue: cfg,
    },
  };
}

function renderPreview(io: WorkflowIOMap) {
  return render(
    <WorkflowCanvasNodePreview
      taskType="t2i"
      usable
      workflowId="wf-1"
      workflowIO={io}
      workflowName="测试工作流"
    />,
  );
}

/** 表单行没有 <label> 关联，按渲染顺序取两个数值输入框（步数 → 引导系数）。 */
function inputs(): Array<HTMLInputElement> {
  return screen.getAllByRole<HTMLInputElement>("textbox");
}
const stepsInput = () => inputs()[0]!;
const cfgInput = () => inputs()[1]!;

describe("WorkflowCanvasNodePreview — 默认值刷新", () => {
  it("初次挂载按默认值播种", () => {
    renderPreview(ioWith(20, 7));
    expect(stepsInput().value).toBe("20");
    expect(cfgInput().value).toBe("7.0");
  });

  it("IO 默认值变化时，未覆盖的参数刷新、已覆盖的保持", async () => {
    const { rerender } = renderPreview(ioWith(20, 7));
    expect(stepsInput().value).toBe("20");

    /* 用户把 steps 改成 8 —— 这是一次覆盖。走 userEvent 而非直接写
     * input.value：React 19 会跟踪 value setter，裸写 DOM 不会触发 onChange，
     * state 不更新，后面的断言就会拿到假的「已覆盖」。 */
    await userEvent.clear(stepsInput());
    await userEvent.type(stepsInput(), "8");
    expect(stepsInput().value).toBe("8");

    /* 作者在 IO 编辑里把 steps 默认改成 30、cfg 默认改成 9 并保存。 */
    rerender(
      <WorkflowCanvasNodePreview
        taskType="t2i"
        usable
        workflowId="wf-1"
        workflowIO={ioWith(30, 9)}
        workflowName="测试工作流"
      />,
    );

    expect(stepsInput().value).toBe("8"); // 已覆盖 → 保持用户的值
    expect(cfgInput().value).toBe("9.0"); // 未覆盖 → 跟随新默认值
  });

  it("换工作流时整表重播（不做保覆盖比较）", async () => {
    const { rerender } = renderPreview(ioWith(20, 7));
    await userEvent.clear(stepsInput());
    await userEvent.type(stepsInput(), "8");
    expect(stepsInput().value).toBe("8");
    /* NumberField 聚焦期间用本地 draft 回显（保证能顺畅打字），外部值变化
     * 会被 draft 挡住，直到 blur 提交。用户改完点别处就是这个时序。 */
    await userEvent.tab();

    rerender(
      <WorkflowCanvasNodePreview
        taskType="t2i"
        usable
        workflowId="wf-2"
        workflowIO={ioWith(50, 3)}
        workflowName="另一个工作流"
      />,
    );
    expect(stepsInput().value).toBe("50");
    expect(cfgInput().value).toBe("3.0");
  });
});

/* ── 对外参数卡片列 + 行尾归属徽标（ISSUE #355）──
 * 卡片列 = 模式统一对外暴露的参数；行尾徽标 = 该行属于哪个对外参数；
 * 两者都从同一份 paramMap（`source.mode:<模式>`）派生。 */

/** 一个「文生图」形状的工作流：提示词口 + 宽高比口。 */
function promptSizeIO(): WorkflowIOMap {
  return {
    "9::widget::positive_prompt": {
      direction: "input",
      kind: "widget",
      nodeId: "9",
      name: "positive_prompt",
      type: "STRING",
      defaultValue: "一只猫在喝山泉的完整描述词，足够长到被判定成提示词口",
    },
    /* 只有「宽高比」一个口 —— 成对的宽/高会被并成同一个控件（组合参数），
     * 没有独立的一行可以标徽标；这里刻意用单口形状测行尾徽标。 */
    "5::widget::aspect_ratio": {
      direction: "input",
      kind: "widget",
      nodeId: "5",
      name: "aspect_ratio",
      label: "宽高比",
      type: "COMBO",
      defaultValue: "16:9",
    },
  };
}

describe("WorkflowCanvasNodePreview — 对外参数卡片列", () => {
  it("卡片头是契约里的统一参数名（提示词 / 尺寸），不是工作流里的端口名", () => {
    const { container } = render(
      <WorkflowCanvasNodePreview
        defaultMode="T2I"
        paramMap={{}}
        taskType="t2i"
        usable
        workflowId="wf-1"
        workflowIO={promptSizeIO()}
        workflowName="测试工作流"
      />,
    );
    expect(container.querySelector('[data-testid="workflow-param-card-column"]')).toBeTruthy();
    expect(screen.getByTestId("param-node-prompt")).toBeTruthy();
    /* 尺寸：六行形态合成**一张卡**（`param-node-size`），不再并排六个节点
     * （用户口径：「尺寸这里不要显示这么多节点，尺寸只显示一个节点」）。 */
    expect(screen.getByTestId("param-node-size")).toBeTruthy();
    for (const id of [
      "size-width",
      "size-height",
      "size-aspect",
      "size-megapixels",
      "size-resolution",
      "size-multiple",
    ]) {
      expect(screen.queryByTestId(`param-node-${id}`)).toBeNull();
    }
    /* 工作流内部参数（步数 / CFG…）不再是「对外参数」——契约里没有它们。 */
    expect(screen.queryByTestId("param-node-other")).toBeNull();
  });

  it("节点上已经选了模式时，卡片不再提示「需要选择模式」", () => {
    const { container } = render(
      <WorkflowCanvasNodePreview
        defaultMode="I2V"
        modes={["T2V", "I2V"]}
        paramMap={{}}
        taskType="I2V"
        usable
        workflowId="wf-1"
        workflowIO={promptSizeIO()}
        workflowName="测试工作流"
      />,
    );
    expect(container.textContent).not.toContain("先选模式才能连线");
  });

  it("被对外参数落到的那一行，行尾标出它属于哪个对外参数", () => {
    const { container } = render(
      <WorkflowCanvasNodePreview
        defaultMode="T2I"
        /* 落点只由**作者画的线**决定：不给线就是未配置，行尾不该有徽标。 */
        paramMap={{
          source: {
            "mode:T2I": {
              prompt: "9::widget::positive_prompt",
              "size-aspect": "5::widget::aspect_ratio",
            },
          },
        }}
        taskType="t2i"
        usable
        workflowId="wf-1"
        workflowIO={promptSizeIO()}
        workflowName="测试工作流"
      />,
    );
    /* 提示词落到 positive_prompt、尺寸落到宽高比那一行 —— 两行各带一次徽标。 */
    const tags = [...container.querySelectorAll('[data-testid="wflib-param-owner"]')];
    /* 徽标文案 = 这个对外参数自己的名字（尺寸在映射层是子口，卡片上「尺寸 ·
     *  宽高比」那一行属于它）。按同一份派生取值断言，不写字面量。 */
    const sizeAspect = buildParamEntries(promptSizeIO(), undefined, {
      mode: "T2I",
    }).find((entry) => entry.id === "size-aspect")!;
    expect(tags.map((tag) => tag.textContent).sort()).toEqual(
      [sizeAspect.label, exposedParamDisplayLabel("prompt")].sort(),
    );
  });

  it("作者显式断开的那一条不再标徽标", () => {
    const promptEntry = buildParamEntries(promptSizeIO(), undefined, {
      mode: "T2I",
    }).find((entry) => entry.id === "prompt")!;
    const { container } = render(
      <WorkflowCanvasNodePreview
        defaultMode="T2I"
        paramMap={{
          source: {
            "mode:T2I": {
              [promptEntry.id]: null,
              "size-aspect": "5::widget::aspect_ratio",
            },
          },
        }}
        taskType="t2i"
        usable
        workflowId="wf-1"
        workflowIO={promptSizeIO()}
        workflowName="测试工作流"
      />,
    );
    const tags = [...container.querySelectorAll('[data-testid="wflib-param-owner"]')];
    const sizeAspect = buildParamEntries(promptSizeIO(), undefined, {
      mode: "T2I",
    }).find((entry) => entry.id === "size-aspect")!;
    expect(tags.map((tag) => tag.textContent)).toEqual([sizeAspect.label]);
  });

  it("每张卡片右侧有端点，宿主行是它另一端（ISSUE #355 复审 / #529）", () => {
    /* 对外参数的端口画在卡片输出端口行上，宿主表单行是另一端。ISSUE #529：
     * 端点换成 React Flow `<Handle>`、连线换成 edge，断言对象是节点/handle/edge DOM。 */
    const { container } = render(
      <WorkflowCanvasNodePreview
        defaultMode="T2I"
        paramMap={{}}
        taskType="t2i"
        usable
        workflowId="wf-1"
        workflowIO={promptSizeIO()}
        workflowName="测试工作流"
      />,
    );
    /* 左列卡片的 handle id = **条目 id**（一个口一颗点）：普通卡是契约口 id，
     *  尺寸那张卡是**子口 id**（卡的每一行 = 一个形态）。 */
    const params = container.querySelector('[data-testid="wflib-canvas-node-params"]')!;
    expect(params.querySelector('[data-handleid="prompt"]')).toBeTruthy();
    expect(params.querySelector('[data-handleid="size-aspect"]')).toBeTruthy();
    /* 宿主卡片的两端都在（连线的另一端）：提示词是普通参数行，
     *  宽高比则落在组合控件那一格上（比例/像素由同一块控件录入）。 */
    const host = container.querySelector('[data-testid="wflib-canvas-node-host"]')!;
    expect(host).toBeTruthy();
    expect(host.querySelector('[data-handleid="9::widget::positive_prompt"]')).toBeTruthy();
    expect(host.querySelector('[data-handleid="5::widget::aspect_ratio"]')).toBeTruthy();
  });

  it("组合控件右对齐、按内容收窄，三个参数在框外各自成行 —— ISSUE #355", () => {
    /* 用户口径：「组合参数不要现在这种样式」「改回之前的样式」「改成之前带有
     *  下拉菜单的样式」—— 这块控件（比例 / 像素 / 倍数同一个下拉）就是原来的
     *  样式，只是按内容收窄；「红框部分对齐到右侧，左侧留出的区域放置那三个
     *  参数，三个参数要到框外」—— 框贴右沿，宽高比 / 百万像素以真正的参数行
     *  （大端点）摆在框外左侧。 */
    const { container } = render(
      <WorkflowCanvasNodePreview
        defaultMode="T2I"
        paramMap={{}}
        taskType="t2i"
        usable
        workflowId="wf-1"
        workflowIO={{
          "5::widget::aspect_ratio": {
            direction: "input",
            kind: "widget",
            nodeId: "5",
            name: "aspect_ratio",
            label: "宽高比",
            type: "COMBO",
            defaultValue: "16:9",
          },
          "5::widget::megapixels": {
            direction: "input",
            kind: "widget",
            nodeId: "5",
            name: "megapixels",
            label: "像素量",
            type: "FLOAT",
            defaultValue: 1,
          },
        }}
        workflowName="测试工作流"
      />,
    );
    /* 控件在（带下拉触发器）。 */
    expect(container.querySelector('[aria-label="选择比例与像素"]')).toBeTruthy();
    const box = container.querySelector("[data-grouped-box]")!;
    expect(box).toBeTruthy();
    /* 框贴右沿：外层 flex 用 justify-end。 */
    expect(box.parentElement!.className).toContain("justify-end");
    /* 两个参数在框外各自成行、各带大端点；框里不再列它们。 */
    for (const ioKey of ["5::widget::aspect_ratio", "5::widget::megapixels"]) {
      const row = container.querySelector(`[data-io-key="${ioKey}"]`);
      expect(row, `${ioKey} 应当以参数行形态出现在框外`).toBeTruthy();
      expect(row!.closest("[data-grouped-box]")).toBeNull();
      const dot = row!.querySelector(`[data-port-dot="${ioKey}"]`);
      expect(dot, `${ioKey} 行左侧应当有大端点`).toBeTruthy();
      /* SAFETY: 类型断言已复核 */
      expect((dot as HTMLElement).style.width).toBe("12px");
      expect(box.querySelector(`[data-io-key="${ioKey}"]`)).toBeNull();
    }
    /* 两个端口各自是一个真正的落点（端点 id 即 ioKey）—— 拖到「百万像素」
     *  就连到 `megapixels`，不是笼统地落到整块控件上。 */
    for (const ioKey of ["5::widget::aspect_ratio", "5::widget::megapixels"]) {
      expect(
        container.querySelector(`[data-handleid="${ioKey}"]`),
        `${ioKey} 应有自己的端点`,
      ).toBeTruthy();
    }
  });

  it("三列依次排开、之间留出走线空间 —— ISSUE #355 复审 / #529", () => {
    /* 「对外参数和工作流节点太近了，看不清哪里连接哪里」：两列之间必须留出走线
     *  的横向空间，否则线短得看不出两端。换 React Flow 后这件事由**布局**承担
     *  （`layoutLibraryNodes` 的 `columnGap` 是节点坐标的一部分）。 */
    const { container } = render(
      <WorkflowCanvasNodePreview
        defaultMode="T2I"
        paramMap={{}}
        taskType="t2i"
        usable
        workflowId="wf-1"
        workflowIO={promptSizeIO()}
        workflowName="测试工作流"
      />,
    );
    const nodes = [...container.querySelectorAll<HTMLElement>(".react-flow__node")];
    const xOf = (id: string) => {
      const el = nodes.find((node) => node.dataset.id === id)!;
      expect(el, `节点 ${id} 应挂载`).toBeTruthy();
      return Number(/translate\((?<x>[-\d.]+)px/.exec(el.style.transform)?.groups?.x);
    };
    expect(xOf("lib:params")).toBeLessThan(xOf("lib:host"));
    expect(xOf("lib:host")).toBeLessThan(xOf("lib:outputs"));
    /* 列间留白 = 布局里的 columnGap（走线的空间）。 */
    expect(xOf("lib:host") - xOf("lib:params")).toBeGreaterThan(220);
  });

  it("组合控件的端口未被任何映射落到时，控件照旧画出来并可被连", () => {
    /* 落点为空也一样是这块控件，且它覆盖的每个端口都画出了自己的端点 ——
     *  拖线时有得可落。 */
    const { container } = render(
      <WorkflowCanvasNodePreview
        defaultMode="T2I"
        paramMap={{}}
        taskType="t2i"
        usable
        workflowId="wf-1"
        workflowIO={{
          "5::widget::aspect_ratio": {
            direction: "input",
            kind: "widget",
            nodeId: "5",
            name: "aspect_ratio",
            label: "宽高比",
            type: "COMBO",
            defaultValue: "16:9",
          },
          "5::widget::megapixels": {
            direction: "input",
            kind: "widget",
            nodeId: "5",
            name: "megapixels",
            label: "像素量",
            type: "FLOAT",
            defaultValue: 1,
          },
        }}
        workflowName="测试工作流"
      />,
    );
    expect(container.querySelector('[aria-label="选择比例与像素"]')).toBeTruthy();
    /* 两个端口各有自己的端点（同一块控件录入，但落点分开）。 */
    for (const ioKey of ["5::widget::aspect_ratio", "5::widget::megapixels"]) {
      expect(
        container.querySelector(`[data-handleid="${ioKey}"]`),
        `${ioKey} 应有自己的端点`,
      ).toBeTruthy();
    }
  });

  it("空 IO 也渲染卡片列：契约口常驻，落点为空（未配置）", () => {
    /* 以前这一条断言的是「没有对外参数就不渲染卡片列」——判据是工作流能承接
     *  什么。对外有哪些参数只由**契约**决定：工作流一个可落点端口都没有时，
     *  契约口照样在列，卡片如实显示成未配置（作者在库里连线才是落点问题）。 */
    const { container } = render(
      <WorkflowCanvasNodePreview
        paramMap={{}}
        taskType="t2i"
        usable
        workflowId="wf-1"
        workflowIO={{}}
        workflowName="测试工作流"
      />,
    );
    expect(container.querySelector('[data-testid="workflow-param-card-column"]')).toBeTruthy();
    expect(screen.getByTestId("param-node-prompt")).toBeTruthy();
    expect(screen.getByTestId("param-node-negative")).toBeTruthy();
    /* 尺寸：六行形态合成**一张卡**（契约口常驻，落点全空 = 未配置）。 */
    expect(screen.getByTestId("param-node-size")).toBeTruthy();
    for (const id of [
      "size-width",
      "size-height",
      "size-aspect",
      "size-megapixels",
      "size-resolution",
      "size-multiple",
    ]) {
      expect(screen.queryByTestId(`param-node-${id}`)).toBeNull();
    }
  });
});
