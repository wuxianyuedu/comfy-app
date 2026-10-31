/**
 * 工作流库左右分栏的**窄屏适配**回归（用户口径：「小屏幕看不到最右侧的内容」）。
 *
 * 两个成因，缺一个都还会被裁掉：
 *   ① 详情面板是弹性项，没有 `min-w-0` 时 `min-width: auto` 会让它**不肯窄于
 *      内容的最小宽度**（面板里的画布预览、卡片列都不小）→ 整行比窗口宽，右侧
 *      连同头部按钮被根容器的 `overflow-hidden` 裁掉；
 *   ② 头部那一排按钮组此前 `shrink-0` 且外层不换行 → 面板一窄就被挤出去。
 *
 * 因此这里同时锁住「面板能变窄」与「按钮组会换行且换行后仍靠右」。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { WorkflowRow } from "./workflow-library-config";
import type { MetaEditorController } from "./hooks/use-workflow-library-detail";
import { DetailHeader } from "./sections/DetailHeader";

import { normalizeControlFlow } from "../../../../tests/helpers/source-shape";

afterEach(cleanup);

/**
 * 取出含 `needle` 的那个 JSX 开标签原文。
 *
 * JSX 属性顺序由 oxlint `perfectionist/sort-jsx-props` 机械排序，而这里要钉的是
 * 「同一个标签上有这些属性 / 这串类名」，与属性先后无关 —— 直接对整份源码写
 * `A[\s\S]{0,80}B` 会把「排过序」读成「契约破了」（判据钉语义不钉行形状）。
 */
function tagContaining(src: string, needle: string): string {
  const at = src.indexOf(needle);
  expect(at, `源码里找不到 ${needle}`).toBeGreaterThan(-1);
  return src.slice(src.lastIndexOf("<", at), src.indexOf(">", at) + 1);
}

const meta: MetaEditorController = {
  modes: ["T2I"],
  defaultMode: "T2I",
  modelTags: [],
  allModelTags: [],
  busy: false,
  patchModes: async () => undefined,
  patchModelTags: async () => undefined,
  patchSeedMode: async () => undefined,
  patchParamMap: async () => undefined,
};

/** 详情头部要的是一整行 `WorkflowRow`（不是「几字段就够」的窄接口），
 *  夹具因此按真实行形状构造 —— 原先的 `as unknown as WorkflowRow` 是把
 *  「形状对不对」这项检查换成了一次断言，字段改名不会红（ISSUE #1460）。 */
function headerRow(over: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-1",
    name: "image_z_image_int8_t2i",
    taskType: "T2I",
    source: "local",
    modes: ["T2I"],
    defaultMode: "T2I",
    modelTags: [],
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    paramMap: null,
    sourcePath: null,
    diskDirty: false,
    diskMissing: false,
    diskMtimeSec: null,
    sourceMtimeSec: null,
    diskRenamed: false,
    diskRenamedTo: null,
    ...over,
  };
}

function renderHeader() {
  render(
    <DetailHeader
      busyDownload={false}
      busyResync={false}
      canResync={false}
      isTechnical={false}
      meta={meta}
      missing={false}
      onDelete={vi.fn()}
      onDownload={vi.fn()}
      onEdit={vi.fn()}
      onOpenSource={vi.fn()}
      onResync={vi.fn()}
      onUse={vi.fn()}
      usable
      workflow={headerRow()}
    />,
  );
}

describe("详情头部：窄屏不丢按钮", () => {
  it("标题区与按钮组同排且都允许换行，换行后按钮组仍靠右", () => {
    renderHeader();
    const row = screen.getByTestId("detail-header-row");
    /* 整行可换行：装不下时按钮组整组落到第二行，而不是溢出被裁。 */
    expect(row.className).toContain("flex-wrap");

    const actions = screen.getByTestId("detail-actions");
    /* 组内也能换行（窄到一行都放不下时按钮分多行，仍然全都点得到）。 */
    expect(actions.className).toContain("flex-wrap");
    /* `ml-auto`：独占第二行时靠右，不被父级 `justify-between` 推到左边。 */
    expect(actions.className).toContain("ml-auto");
    /* 按钮不许被压扁 —— 让位的是标题区，不是按钮。 */
    expect(actions.className).not.toContain("shrink-0");
  });

  it("标题区有可读下限（压缩压力交给它，标题截断而不是把按钮挤出去）", () => {
    renderHeader();
    expect(screen.getByTestId("detail-title-block").className).toContain("min-w-45");
  });
});

describe("详情头部：执行日志入口已下沉到各页签", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  it("详情头部不再集中放置统一入口（入口分散到画布节点 / 工坊封装页签）", () => {
    expect(read("sections/DetailHeader.tsx")).not.toContain("WorkflowRunLogButton");
  });

  it("画布节点页签有独立入口，且带 canvas-node 来源过滤", () => {
    /* 入口按钮随「实际使用」视图拆在 WorkflowPreviewUsePanel（全屏弹窗仍由
     * WorkflowCanvasNodePreview 挂载）—— 两处同属画布节点页签。 */
    const src = read("WorkflowPreviewUsePanel.tsx");
    expect(src).toContain("WorkflowRunLogButton");
    expect(src).toContain('source="canvas-node"');
  });

  it("工坊封装页签有独立入口，且带 encapsulation-test 来源过滤", () => {
    const src = read("sections/WorkshopEncapsulationPanel.tsx");
    expect(src).toContain("WorkflowRunLogButton");
    expect(src).toContain('source="encapsulation-test"');
  });
});

describe("左右分栏：详情面板能窄于内容最小宽度", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  it("分栏走 v4 字符串百分比（issue #981 回归），列表填满面板、详情可窄于内容", () => {
    const library = read("WorkflowLibrary.tsx");
    /* react-resizable-panels v4：数值 = 像素、字符串 = 百分比。#981 的 bug 正是
     * 写成数值（defaultSize={24} → 24px、maxSize={45} → 45px，列表被夹到 45px）。
     * 这里钉死两件事：① 三处尺寸都是字符串百分比；② 不再残留任何数值形式。 */
    const listPanel = tagContaining(library, 'defaultSize="24"');
    expect(listPanel.startsWith("<ResizablePanel")).toBe(true);
    expect(listPanel).toContain('minSize="16"');
    expect(listPanel).toContain('maxSize="45"');
    const detailPanel = tagContaining(library, 'defaultSize="76"');
    expect(detailPanel.startsWith("<ResizablePanel")).toBe(true);
    expect(detailPanel).toContain('minSize="40"');
    expect(library).not.toMatch(/defaultSize=\{\d+\}/);
    expect(library).not.toMatch(/(?:min|max)Size=\{\d+\}/);
    /* 详情面板仍可窄于内容最小宽度（小屏不裁右侧）。 */
    expect(library).toMatch(/min-w-0[^"]*overflow-hidden|overflow-hidden/);
    /* 列表根填满所属面板（宽度交给 ResizablePanel，不再钉死 w-80）。 */
    expect(read("WorkflowLibraryList.tsx")).toMatch(/w-full min-w-0 flex-col/);
  });

  it("拆分文件确实存在（防止上面的源码断言读到空内容而静默全绿）", () => {
    expect(existsSync(path.join(ROOT, "WorkflowLibrary.tsx"))).toBe(true);
    expect(existsSync(path.join(ROOT, "WorkflowLibraryList.tsx"))).toBe(true);
  });
});

describe("画布页签：画布铺到面板底部（ISSUE #596）", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  /* 用户口径：「全屏时，下方区域有空白却不是画布」。
   *
   * 根因是**高度链条断了 + fitView 的下限由内容高度决定**：画布容器只给了一层
   * 固定下限（`min-h-115`）、横向画布之外还套了一层 `overflow-auto`（它按内容高度收边），
   * 而 React Flow 的 `fitView` 又只按节点包围盒缩放 —— 内容比视口矮时它不会
   * 把画布放大到铺满视口，于是画布底边以下落回面板底色。
   *
   * 这里锁三件事：① 容器不再被钉死高度；② 三列之上真的垫了背景板（它才是把
   * 包围盒撑到视口的那个）；③ 背景板尺寸由「视口与内容取大」给出（纯函数另有
   * 精确用例，这里钉住「没被写成只按内容算」）。 */

  it("画布容器吃满可用高度，不再被钉死在外层高度上", () => {
    const canvas = read("WorkflowLibraryCanvas.tsx");
    expect(canvas).toMatch(/bg-canvas relative h-full min-h-115/);
    /* 画布自己的底色要在画布这一层（面板底色深浅不同，没铺到就成了那条缝）。 */
    expect(canvas).not.toMatch(/bg-panel-deep relative h-full min-h-115/);
  });

  it("预览纵向吃满父级，中间不再有一层按内容收边的高度来源", () => {
    expect(read("WorkflowCanvasNodePreview.tsx")).toMatch(
      /flex h-full min-h-0 w-full flex-col items-center gap-3/,
    );
    /* 页签面板把高度传下去（缺 `h-full` 则整条链断在第一层）。 */
    expect(read("sections/DetailBody.tsx")).toMatch(/flex h-full min-h-105 flex-col/);
  });

  it("三列之上垫了一层背景板，且它的尺寸由视口与内容取大", () => {
    const flow = read("hooks/use-library-wire-flow.ts");
    expect(flow).toContain("LIB_NODE_BACKDROP");
    /* 背景板不可交互：它只是底，不能抢走卡片的点击 / 拖动 / 连线。 */
    expect(flow).toMatch(/selectable: false[\s\S]{0,80}draggable: false/);

    const graph = read("workflow-library-wire-graph.ts");
    /* 取大，缺一边都会退回空白：比视口矮（高度）或比三列窄（右列被挤出视野）。 */
    expect(graph).toMatch(/Math\.max\(content\.height,\s*clamp\(viewport\.height\)\)/);
    expect(graph).toMatch(/Math\.max\(content\.width,\s*clamp\(viewport\.width\)\)/);
  });
});

/* ISSUE #720 的四条用户口径，逐条钉在源码上（这几条都是「删掉 / 加回来」型回归，
 * 行为层用 RTL 很难表达：例如「页面上不再出现『手动落点』」是**没有**这件事）。 */
describe("工坊封装页签：模式可切换 / 必填可分 / 不再有手动落点", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  it("第 1 条：不再显示「手动 / 自动」落点（相关字段也一并删了）", () => {
    /* 落点现在**只**来自作者画的线（没有第二条来源），「手动落点」这句话已经
     *  没有区分能力，留着只会让用户以为还有别的落点来源。 */
    expect(read("sections/WorkshopEncapsulationPanel.tsx")).not.toContain("手动落点");
    /* 状态派生的类型上也不再有这个字段（不是只把渲染删掉）。 */
    const status = readFileSync(
      path.resolve(__dirname, "../../../lib/workshop/workshop-encapsulation-status.ts"),
      "utf8",
    );
    expect(status).not.toMatch(/^\s*manual: boolean;/m);
  });

  it("第 2 条：每个口标出必填 / 可选，且说明「可选口不必连到工作流」", () => {
    const panel = read("sections/WorkshopEncapsulationPanel.tsx");
    expect(panel).toContain('entry.required ? "必填" : "可选"');
    expect(panel).toContain("不必连到工作流");
    expect(panel).toContain("必填口 ");
  });

  it("第 2 条复审（ISSUE #720）：没落点的可选口不再多挂一个同义徽标", () => {
    const panel = read("sections/WorkshopEncapsulationPanel.tsx");
    /* 用户口径：「可选-未落地 有些重复了，前面已经显示了可选标签」。
       「必填 / 可选」读的正是「没落点会不会挡住运行」，再挂一个同义徽标就是把
       同一份事实换个说法说第二遍。判据先去掉注释 —— 把「为什么删掉它」写进
       注释不该让计数停在原地（同 §16.2.4.12 的 P9 口径）。 */
    const code = panel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("可选 · 未落点");
    expect(code).not.toContain("必备 · 未落点");
    /* 例外只留「必填口没落点」：那不是复述，是缺件状态。 */
    expect(panel).toContain("if (entry.required) {");
    expect(panel).toContain('label: "未落点"');
    /* 已落点照常给徽标（它是与「必填 / 可选」正交的那一档信息）。 */
    expect(panel).toContain('label: "已落点"');
  });

  it("第 3 条：封装页签能切模式跑流程测试（多模式时渲染切换器）", () => {
    const panel = read("sections/WorkshopEncapsulationPanel.tsx");
    expect(panel).toContain("SelectMenu");
    expect(panel).toMatch(/modes\.length > 1/);
    /* 模式由详情层下发（两个页签共用同一份当前模式）。 */
    expect(read("sections/DetailBody.tsx")).toMatch(/mode=\{activeMode\}/);
    expect(read("WorkflowLibraryDetailView.tsx")).toContain("activeMode={activeMode}");
  });

  it("第 4 条：首帧 fit 落地前画布不可见（不在错误缩放上画一帧）", () => {
    const canvas = read("WorkflowLibraryCanvas.tsx");
    /* 不再用 `<ReactFlow fitView>` 的「全部节点」口径（背景板会把缩放带偏）。 */
    expect(canvas).not.toMatch(/^\s*fitView$/m);
    expect(canvas).toContain("libraryFitViewOptions()");
    /* 首帧不画：`fitted` 之前画布不可见；fit 落地后显形。 */
    expect(canvas).toMatch(/fitted \? "" : "invisible"/);
    expect(canvas).toContain('data-fitted={fitted ? "true" : "false"}');
    /* 兜底路径必须在：fitView 不 resolve 时也要显形，不能永远看不见。 */
    expect(canvas).toMatch(/setTimeout\(markFitted,/);
  });
});

describe("页头：筛选菜单水平排列（ISSUE #716）", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  /* 用户口径：「工作流库界面的上方筛选菜单应该是水平布局排列的」。
   *
   * 触发条件是宽度不足 —— 三个筛选下拉 + 「管理模型」在窄窗口里排不下时，
   * 组内 `flex-wrap` 会让它们**各自折行**，叠成一个竖列，页头因此吃掉三行。
   * 判据因此是两条：① 组内 `flex-nowrap`（三个下拉是一组，拆行会错位）；
   * ② 每项 `shrink-0`（不许被压扁成两行小字，规范 03 §3.8.1）。 */

  it("筛选组不换行，组内每项不收缩", () => {
    const filters = read("WorkflowLibraryFilters.tsx");

    /* 组容器：一行到底。 */
    expect(tagContaining(filters, 'data-testid="workflow-library-filter-row"')).toContain(
      "flex flex-nowrap items-center gap-2",
    );
    expect(filters).not.toMatch(/flex flex-wrap items-center gap-2/);

    /* 触发按钮：宽度跟内容走，且不许被压。 */
    expect(filters).toContain("min-w-28 shrink-0");
  });

  it("页头把筛选包成一组并交给整行换行，动作组不许被压", () => {
    const header = read("WorkflowLibraryHeader.tsx");

    /* 根容器换行：排不下时整组落到第二行，而不是把某个下拉挤变形。 */
    expect(header).toMatch(/flex flex-wrap items-center gap-x-3 gap-y-2/);
    /* 筛选是一组：组内不换行（组之间才换行）。 */
    expect(tagContaining(header, 'data-testid="workflow-library-header-filters"')).toContain(
      "flex shrink-0 flex-nowrap",
    );
    /* 动作组不许被压（规范 03 §3.8.1）。 */
    expect(header).toMatch(/ml-auto flex shrink-0 flex-wrap items-center gap-2/);

    /* 屏名不再有可见标题（ISSUE #1847 / #1693）：顶栏与页签常驻写着「工作流库」，
     * 屏内再写一遍是同一个名字出现两次。名字仍从注册表取（`pageHeaderTitle`），
     * 且退到 `sr-only` —— 不占视觉空间，但读屏仍能按 `h1` 跳转。 */
    expect(header).toContain('<h1 className="sr-only">');
    expect(header).toContain('pageHeaderTitle("workflows")');
    expect(header).not.toContain("u-title-page");
  });
});

/* 局部内容加载不许用「整列 / 整屏」加载界面（用户实测口径：工作流库打开时
 * 有一张「加载工作流编辑器…」的全屏加载，而这只是部分区域在加载）。
 *
 * 两处成因，都是**渲染面 > 加载面**：
 *   ① 画布编辑器是个模态，却常驻渲染 —— `dynamic()` 的分块是「一渲染就下载」，
 *      于是打开工作流库这一步就把 7k 行编辑器拉下来，它的过渡屏
 *      （`absolute inset-0`，吃满内容列）顺势盖住列表与详情；
 *   ② 详情面板的「编辑对外参数 / 实际使用」共用一份常驻实例，此前**无论当前在
 *      哪个页签都渲染**（靠 `hidden` 藏起来）—— 默认落在工坊封装时，那棵子树
 *      连同画布引擎 `@xyflow/react` 照样执行。`hidden` 只藏不卸载。
 *
 * 判据因此钉在源码上：编辑器的挂载点在 `editingId` 之后，常驻实例的挂载点在
 * `canvasMounted` 之后。 */
describe("局部加载不许用整列加载界面", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  it("画布编辑器只在真的打开时才挂载（分块不再随工作流库一起下）", () => {
    const library = read("WorkflowLibrary.tsx");
    /* 按需形态：挂载点被 `c.editingId && (` 收住（`<WorkflowCanvasEditor` 紧跟在
     *  这个条件表达式之后）。 */
    expect(library).toMatch(/\{c\.editingId && \(\s*<WorkflowCanvasEditor/);
    /* 常驻形态的回归：`<WorkflowCanvasEditor …>` 不出现在**任何**条件之外
     *  —— 逐个匹配点都必须在 `editingId &&` 里。取反的写法是把条件那一段剥掉
     *  再看还剩不剩裸的 `<WorkflowCanvasEditor`。 */
    expect(library.replace(/\{c\.editingId && \(\s*<WorkflowCanvasEditor/g, "<GATED")).not.toMatch(
      /<WorkflowCanvasEditor\s+workflowId=/,
    );
    /* 编辑器自身仍带 `open` 契约（组件 API 不变）。 */
    expect(library).toMatch(/<WorkflowCanvasEditor[\s\S]{0,180}\bopen\b/);
  });

  it("详情面板的画布常驻实例首次访问画布页签之前不渲染", () => {
    const view = read("WorkflowLibraryDetailView.tsx");
    /* 常驻实例套在 `canvasMounted &&` 里，而不是只有 `hidden`。 */
    expect(view).toMatch(/\{canvasMounted && \(/);
    expect(view).toMatch(/hidden=\{activeTab !== "canvas" && activeTab !== "use"\}/);
  });

  it("`canvasMounted` 由 controller 给，且落在「首次切到画布页签」那一刻", () => {
    /* 读源断言钉的是**结构**（字段在 controller 上、记录点在切页签那条路上），
     * 不是括号形态：先过归一化，oxlint `curly` 补 `{}` 不改变这条判据的结论。 */
    const hook = normalizeControlFlow(read("hooks/use-workflow-library-detail.ts"), "detail.ts");
    /* 契约：controller 上有这个字段。 */
    expect(hook).toMatch(/canvasMounted: boolean;/);
    /* 判据：当前工作流访问过画布页签才为真。 */
    expect(hook).toMatch(/canvasMounted: !!workflow && canvasVisitedFor === workflow\.id/);
    /* 记录点只在切页签那一条路径上（不是 effect 里 setState）。 */
    expect(hook).toMatch(
      /if \(isCanvasTab\(tab\) && workflow\) setCanvasVisitedFor\(workflow\.id\)/,
    );
  });
});
