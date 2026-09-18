// @vitest-environment jsdom
/* 工作流库画布预览里的**映射编辑** —— ISSUE #355 / #529
 *
 * 用户两条要求合一：库里要看得见对外参数与它们的线，**而且线要能改**
 * （「连线要能编辑，现在编辑不了」）。库里那三列现在是一个 React Flow 画布
 * （ISSUE #529）：
 *
 *   · 三列各一个 node（`[data-testid="wflib-canvas-node-params|host|outputs"]`）；
 *   · 每条映射线是一条 edge（`[data-testid="rf__edge-<edgeId>"]`），
 *     身份由 `libraryEdgeId` 给出，点选它即可反查出「点的是哪个口」；
 *   · 端点是真的 `<Handle>`（`[data-handleid]`），拖动由 React Flow 承担。
 *
 * 这里断言的是**节点 / 边的 DOM**（第 3 步口径：不再量 path 的 `d`），落库载荷
 * 仍按 `source.mode:<模式> = { <entryId>: ioKey }` 的形状断言（与编辑器逐字一致）。
 *
 * 运行相关的副作用（生成 / SSE / 日志弹窗）打桩，避免在 jsdom 里真发请求。 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
vi.mock("../WorkflowRunLogModal", () => ({ WorkflowRunLogModal: () => null }));

import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import {
  parseParamMapping,
  SIZE_SUB_IDS,
} from "~/lib/workflow/workflow-param-mapping";
import { applyWireEdit } from "~/lib/workflow/workflow-param-wiring";
import { WorkflowCanvasNodePreview } from "./WorkflowCanvasNodePreview";
import { deriveLibraryParamCards } from "./workflow-library-param-cards";
import { deriveLibraryEdges } from "./hooks/use-library-wire-flow";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

afterEach(cleanup);

/** 「尺寸」口有宽 / 宽高比 / 像素量 三个候选。 */
const io: WorkflowIOMap = {
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
    label: "百万像素",
    type: "FLOAT",
    defaultValue: 1,
  },
  "5::widget::width": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "width",
    label: "宽度",
    type: "INT",
    defaultValue: 1024,
  },
  "5::output::IMAGE": {
    direction: "output",
    kind: "output",
    nodeId: "5",
    name: "images",
    label: "images",
    type: "IMAGE",
  },
};

/** 作者画过的线：「尺寸 · 宽度」连到 width 那一行（形态由子口声明）。
 *  落点只由作者画的线决定 —— 不显式给线就没有任何落点。 */
const SIZE_WIRED = {
  source: { "mode:T2I": { "size-width": "5::widget::width" } },
};

function previewElement(
  paramMap: Record<string, unknown>,
  onPatch: (next: Record<string, unknown>) => void | Promise<void>,
) {
  return (
    <WorkflowCanvasNodePreview
      workflowId="wf-1"
      workflowName="测试工作流"
      taskType="t2i"
      workflowIO={io}
      paramMap={paramMap}
      usable
      defaultMode="T2I"
      onPatchParamMap={onPatch}
    />
  );
}

function renderPreview(paramMap: Record<string, unknown>) {
  const onPatch = vi.fn<(next: Record<string, unknown>) => void>();
  const view = render(previewElement(paramMap, onPatch));
  return { ...view, onPatch };
}

describe("库内映射编辑", () => {
  /* 手感（按下 → 拖动 → 落点）现在由 React Flow 承担，落点合法性由
   * `isValidConnection`（`libraryConnectionAllowed`）判 —— 那一层有独立、可直接
   * 断言的纯函数用例（`workflow-library-wire-graph.test.ts`）。这里断言的是它
   * **接到视图上之后**的两件事：
   *   ① 拖动起点是真的 <Handle>（画布的连线手势认得它）；
   *   ② 上抛回来的落点被写进 `paramMap.source.mode:<模式>`。
   */
  it("卡片圆点是真正的 <Handle>（画布的连线手势认得它）", () => {
    const { container } = renderPreview({});
    const dot = container.querySelector(
      '[data-handleid="size-megapixels"][data-nodeid="lib:params"]',
    );
    expect(dot, "尺寸卡「像素量」那一行应有一颗可连的 handle").toBeTruthy();
    /* 它是 source（线从这里出发去宿主卡片），不是装饰圆点。 */
    expect(
      container.querySelector(
        '.react-flow__handle.source[data-handleid="size-megapixels"]',
      ),
    ).toBeTruthy();
  });

  it("落点写入走库内编排：`source.mode:<模式>` 的形状与编辑器逐字一致", () => {
    /* 落库形状由 `useParamWiring` → `applyWireEdit` 给（纯函数，编辑器同一份）。
     *  这里不断言手势，只钉住「库内改的落点落成什么形状」—— 形状错了刷新后就
     *  读不回来（用户口径：「改了落点没生效」）。 */
    const parsed = parseParamMapping(
      applyWireEdit(
        {},
        {
          entryId: "size-megapixels",
          ioKey: "5::widget::megapixels",
          mode: "T2I",
        },
      ),
    );
    expect(parsed.manualByMode).toEqual({
      T2I: { "size-megapixels": "5::widget::megapixels" },
    });
  });

  it("落库后的 paramMap 读回来：卡片头「恢复默认」可用", () => {
    renderPreview({
      source: { "mode:T2I": { "size-megapixels": "5::widget::megapixels" } },
    });
    /* 作者把「尺寸 · 像素量」连到 megapixels 那一行 —— 卡片头出现「恢复默认」
     *  （尺寸是一张卡，↺ 撤掉的是它六行里的线）。 */
    const reset = screen.getByTestId("param-node-reset-size");
    expect(reset.hasAttribute("disabled")).toBe(false);
  });

  it("没改过时「恢复默认」不可用（点了不会有变化）", () => {
    renderPreview({});
    const reset = screen.getByTestId("param-node-reset-size");
    expect(reset.hasAttribute("disabled")).toBe(true);
  });

  it("尺寸卡头 ↺ 一次清掉六条形态线（一次落库，「重置清不掉」不复现）", () => {
    /* 用户口径：「尺寸那三项线现在变成固定连线了，我重置也清不掉」。
     *  成因：卡片头逐个上抛六个子口，消费方每收到一个就从**同一份旧值**算一次新
     *  表并落库 —— 后一次把前一次的删除覆盖回去，只有最后一条真的清掉了。 */
    const sixWired = {
      source: {
        "mode:T2I": Object.fromEntries(
          SIZE_SUB_IDS.map((id) => [id, "5::widget::width"]),
        ),
      },
    };
    const { onPatch } = renderPreview(sixWired);
    fireEvent.click(screen.getByTestId("param-node-reset-size"));
    /* 一次落库：`mode:T2I` 整段消失（六条线一起撤）。 */
    expect(onPatch).toHaveBeenCalledTimes(1);
    const next = onPatch.mock.calls[0]![0];
    expect(parseParamMapping(next).manualByMode).toEqual({});
  });

  it("有模式 → 卡片可连线；没有模式 → 不可（写入无归属）", () => {
    /* 落点覆盖必须归属一个模式 —— 没有模式时写入是无归属的空操作，卡片不给拖
     *  （`canWire=false`）。判据：卡片列的提示文案。 */
    const { unmount } = renderPreview({});
    expect(screen.getByText("对外参数 · 拖圆点改落点")).toBeTruthy();
    unmount();

    render(
      <WorkflowCanvasNodePreview
        workflowId="wf-2"
        workflowName="无模式工作流"
        taskType=""
        workflowIO={io}
        paramMap={{}}
        usable
        onPatchParamMap={vi.fn()}
      />,
    );
    expect(screen.getByText("对外参数")).toBeTruthy();
  });
});

describe("尺寸卡：六行的类型与拖线后的线（回归）", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
  /* 用户口径：「这几个都是固定类型的为什么显示星号，线连不上，一松手线就消失。」
   *
   * 两个症状各对应一处：
   *   ① 行的类型只从**落点**取 —— 未连过时 `io[target]` 无从取，徽标退成 `*`；
   *   ② 边集合是画布挂载时的快照（`useEdgesState` 的初值 + 挂载时派生一次），
   *      新写入的线进不了画布 —— 松手即消失（写入本身是成功的）。 */
  it("未连过的行显示形态固定的类型，而不是星号", () => {
    /* 用户口径：宽度 / 高度 / 像素量 = FLOAT，分辨率档 / 倍数 = INT，
     *  宽高比 = COMBO —— 形态语义固定，**连上之后也不改口**（落点那一行声明
     *  成什么只在行 title 里可查，见 `paramOutputPorts`）。 */
    const expectedByCls: Record<string, string> = {
      "size-width": "FLOAT",
      "size-height": "FLOAT",
      "size-megapixels": "FLOAT",
      "size-resolution": "INT",
      "size-multiple": "INT",
      "size-aspect": "COMBO",
    };
    const { container } = renderPreview({});
    SIZE_SUB_IDS.forEach((cls, index) => {
      const badge = container.querySelector(
        `[data-testid="param-node-out-type-size-${index}"]`,
      );
      expect(badge?.textContent, `${cls} 行的类型`).toBe(expectedByCls[cls]);
      expect(badge?.textContent, `${cls} 行不该显示星号`).not.toBe("*");
    });
  });

  it("连线两端锚点都在：卡片行（起手）与宿主数值行（落点）", () => {
    const { container } = renderPreview({});
    /* 少任一端，松手时都落不上（画布会提示「松手时不在任何端口上」）。 */
    expect(
      container.querySelector(
        '[data-handleid="size-megapixels"][data-nodeid="lib:params"]',
      ),
      "起手端：尺寸卡「像素量」那一行",
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[data-handleid="5::widget::megapixels"][data-nodeid="lib:host"]',
      ),
      "落点端：宿主卡片上那一行（handle id = ioKey）",
    ).toBeTruthy();
  });

  it("边集合跟随派生（新写入的线必须能进画布）", () => {
    /* 这条只能锁**源码形态**：jsdom 里 React Flow 渲染不出边（`ResizeObserver` 是
     *  桩、量不到 handleBounds，首帧带线的渲染也数不到 `.react-flow__edge`），
     *  所以这里钉的是两处必需形态：
     *   · `defaultEdges` 跟着 wires **重新派生**（不是挂载时算一次）；
     *   · 画布把派生出来的边**写回 edges 状态**。
     *  缺任一处，写入成功的线永远进不了画布 —— 用户看到的就是「一松手线就消失」。 */
    const flow = read("hooks/use-library-wire-flow.ts");
    /* 判据要**容忍换行**：prettier 会把这条调用拆成多行，
     * 而 `\s*` 化的写法既钉住了「四个实参按此顺序」这件事，
     * 又不把判据挂在「某次格式化后长什么样」上（规范 §12.11 的同款教训）。 */
    expect(flow).toMatch(
      /deriveLibraryEdges\(\s*paramCards\.wires,\s*outputWires,\s*!!canWire,\s*selectedEdgeIds,?\s*\)/,
    );
    const canvas = read("WorkflowLibraryCanvas.tsx");
    expect(canvas).toMatch(/setEdges\(flow\.defaultEdges\)/);
  });
});

describe("画布铺满：背景板（ISSUE #596）", () => {
  /* 用户口径：「全屏时，下方区域有空白却不是画布」。
   *
   * 画布的缩放由 React Flow 的 `fitView` 按节点包围盒算 —— 卡片比视口矮时它只会
   * 放大到内容高度，画布底边以下就落回面板底色。三列之上垫的那层背景板把包围盒
   * 撑到「视口与内容取大」，最优缩放因此只能是「等比铺满视口」的那个值。
   *
   * 背景板必须是**透明、不可交互**的：它只是底，不能抢走卡片与表单的点击 / 拖动。 */
  it("三列之下有一层背景板节点，且它不抢交互", () => {
    const { container } = renderPreview({});
    const backdrop = container.querySelector(
      '[data-testid="wflib-canvas-backdrop"]',
    );
    expect(backdrop, "画布应有一层撑满高度的背景板").toBeTruthy();

    /* 它的节点外壳不可选中 / 不可拖动 —— React Flow 只在为真时挂上这两个类，
     * 都不出现即「都不是」。否则画布上会多出一块能点、能拖的空面板。 */
    const wrapper = backdrop!.closest(".react-flow__node")!;
    expect(wrapper.className).not.toContain("selectable");
    expect(wrapper.className).not.toContain("draggable");
    /* 声明尺寸给的是撑满视口的那个值，容器才会铺到面板底边。 */
    expect(backdrop!.className).toContain("h-full");
  });

  it("背景板垫在三列之下，不遮挡卡片（DOM 顺序在前的那个先画）", () => {
    const { container } = renderPreview({});
    const nodes = Array.from(
      container.querySelectorAll(".react-flow__node"),
    ).map((el) => el.getAttribute("data-id"));
    const backdropIndex = nodes.indexOf("lib:backdrop");
    const paramsIndex = nodes.indexOf("lib:params");
    expect(backdropIndex).toBeGreaterThanOrEqual(0);
    expect(paramsIndex).toBeGreaterThan(backdropIndex);
  });
});

describe("对外输出参数（节点右侧）—— ISSUE #355", () => {
  it("宿主卡片的输出行带 <Handle>（红框里的那一行）", () => {
    /* 用户口径：「红框中的输出端口也要有端口圆点」。项目画布上的输出行一直有
     *  这颗点（`PortHandle dir="out"`），库内预览此前漏了 —— 补上，且它正是
     *  右列连线的起点。 */
    const { container } = renderPreview({});
    const host = container.querySelector(
      '[data-testid="wflib-canvas-node-host"]',
    )!;
    expect(
      host.querySelector(
        '.react-flow__handle.source[data-handleid="5::output::IMAGE"]',
      ),
    ).toBeTruthy();
  });

  it("节点右侧列出对外输出参数，卡片端点在卡片左缘", () => {
    const { container } = renderPreview({});
    const column = container.querySelector(
      '[data-testid="workflow-output-param-column"]',
    )!;
    expect(column).toBeTruthy();
    expect(column.getAttribute("aria-label")).toBe("对外输出参数");
    const card = column.querySelector(
      '[data-testid="param-node-5::output::IMAGE"]',
    )!;
    expect(card.textContent).toContain("images");
    /* 端点在行首（圆点在左）：卡片的左缘才是「线从宿主进来」的那一侧。 */
    const dot = column.querySelector(
      '.react-flow__handle.target[data-handleid="5::output::IMAGE"]',
    )!;
    expect(dot).toBeTruthy();
    expect(
      screen.getByTestId("param-node-out-5::output::IMAGE-0").firstElementChild,
    ).toBe(dot);
  });

  it("右列可连线：有模式 + 给了落库回调时端点就是起手位", () => {
    const { container } = renderPreview({ source: { "mode:T2I": {} } });
    /* 没改过时「恢复默认」不可用（点了不会有变化）。 */
    const card = container.querySelector(
      '[data-testid="param-node-5::output::IMAGE"]',
    )!;
    expect(
      card.querySelector<HTMLButtonElement>(
        '[data-testid^="param-node-reset"]',
      )!.disabled,
    ).toBe(true);
    /* 但端点本身在（可拖）—— 端点由画布的节点注入；锚点 = 输出口的 ioKey。 */
    expect(
      container.querySelector(
        '.react-flow__handle[data-handleid="5::output::IMAGE"]',
      ),
    ).toBeTruthy();
  });

  it("作者改过取值行后「恢复默认」可用", () => {
    const { container } = renderPreview({
      output: { "mode:T2I": { "5::output::IMAGE": "5::output::IMAGE" } },
    });
    const card = container.querySelector(
      '[data-testid="param-node-5::output::IMAGE"]',
    )!;
    expect(
      card.querySelector<HTMLButtonElement>(
        '[data-testid^="param-node-reset"]',
      )!.disabled,
    ).toBe(false);
  });
});

/* ── 画布视口（可拖动 / 缩放）与尺寸三项的候选收窄 —— ISSUE #355 ── */

describe("画布视口（由 React Flow 承担）", () => {
  /* 这部分以前是自绘的 `WorkflowCanvasViewportFrame`（量 rect + transform +
   *  非被动滚轮）。ISSUE #529 把它整块交给 React Flow：`panOnDrag` /
   *  `zoomOnScroll` / `fitView`。这里断言的是「画布真的挂上了、并且开着这些
   *  能力」，而不是复述 React Flow 自己的实现细节。 */
  it("挂载了画布，并开启拖动平移 / 滚轮缩放 / fitView", () => {
    const { container } = renderPreview({});
    expect(screen.getByTestId("wflib-canvas")).toBeTruthy();
    const flow = screen.getByTestId("wflib-canvas-flow");
    expect(flow).toBeTruthy();
    /* 画布自带视口（`.react-flow__viewport`）与平移面（`.react-flow__pane`）。 */
    expect(container.querySelector(".react-flow__viewport")).toBeTruthy();
    expect(container.querySelector(".react-flow__pane")).toBeTruthy();
  });

  it("三列各挂在一个节点里（左列 / 宿主 / 右列）", () => {
    const { container } = renderPreview({});
    for (const id of ["lib:params", "lib:host", "lib:outputs"]) {
      const node = container.querySelector(
        `.react-flow__node[data-id="${id}"]`,
      );
      expect(node, `节点 ${id} 应挂载`).toBeTruthy();
    }
  });

  it("节点可拖（React Flow 靠它打开指针事件），但拖完吸附回布局位置", () => {
    /* `nodesDraggable={false}` 会让 React Flow 给 `.react-flow__node` 去掉
     *  `pointer-events: all`，卡片列与宿主卡片整块变成不可交互 —— 表单输入、
     *  端点、按钮全部点不动。所以节点保持可拖，用「拖完吸附回布局」兜住
     *  「三列不错位」。 */
    const { container } = renderPreview({});
    const params = container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="lib:params"]',
    )!;
    expect(params.className).toContain("draggable");
  });
});

describe("尺寸各项各自可取外部值", () => {
  it("尺寸卡的六行形态各有一颗 handle（合成一张卡后仍逐行可连）", () => {
    const { container } = renderPreview({});
    for (const handle of ["size-aspect", "size-megapixels", "size-width"]) {
      expect(
        container.querySelector(
          `.react-flow__handle.source[data-handleid="${handle}"]`,
        ),
        `尺寸的 ${handle} 应各有一颗出口端点`,
      ).toBeTruthy();
    }
  });

  it("每个子口各派生出一条边（宽高比与百万像素都要能连出去）", () => {
    /* ISSUE #355 复审：截图里「尺寸」卡片有宽高比 / 百万像素两颗圆点，画面上
     *  却只有一条线通到宿主卡片 —— 用户要的是「这两项都需要能导入到工作流中，
     *  所以 2 条线都要能连出去」。
     *
     *  拆分之后六种形态各有自己的子口（`SIZE_WIRED` 那条老 `size` 线按落点形态
     *  归到「尺寸 · 宽度」），每个子口连到哪一行就派生哪一条边 —— 三条线各画各的。
     *
     *  ISSUE #529 之后这件事是**纯派生**：几条该画的线就有几条 edge，id 里带
     *  handle（`libwire:param:<条目>?<handle>`）。这里断言派生结果 —— 边的
     *  渲染本身由 React Flow 负责，jsdom 量不到 handleBounds。 */
    const paramCards = deriveLibraryParamCards({
      io,
      paramMap: {
        source: {
          "mode:T2I": {
            ...SIZE_WIRED.source["mode:T2I"],
            "size-aspect": "5::widget::aspect_ratio",
            "size-megapixels": "5::widget::megapixels",
          },
        },
      },
      mode: "T2I",
    });
    const edges = deriveLibraryEdges(paramCards.wires, [], true);
    /* 尺寸那张卡的行 = 形态，所以圆点 handle 就是**子口 id**（卡片与边同一份算式）。 */
    for (const entryId of ["size-width", "size-aspect", "size-megapixels"]) {
      expect(
        edges.find((edge) => edge.id === `libwire:param:${entryId}?${entryId}`),
        `${entryId} 应各有一条边`,
      ).toBeTruthy();
    }
  });
});

describe("画布节点页签：卡片列的口子清单取「生效契约」", () => {
  /* 用户报的现场：画布「对外参数」列着时长，点开「模式契约」→ 单图生视频里没有它。
   *  派生层已按 `contractIds` 收口（见 `workflow-param-mapping.test.ts` 与
   *  `workflow-library-param-cards.test.ts`），这里钉住**最后一跳**：视图把生效契约
   *  （`contractEntries`，用户改过的模式走注册表）真的传下去了 —— 传漏了就退回内置
   *  默认，两个表面又各说一份。判据容忍换行（prettier 会把调用拆成多行）。 */
  it("派生卡片列时把生效契约的 id 传下去", () => {
    const preview = readFileSync(
      path.join(__dirname, "WorkflowCanvasNodePreview.tsx"),
      "utf8",
    );
    expect(preview).toMatch(/contractIds:\s*contractEntries\.map/);
    expect(preview).toContain(
      "modeContractEntries(effectiveMode, storedContracts)",
    );
  });
});
