// @vitest-environment jsdom
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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { WorkflowRow } from "./workflow-library-config";
import type { MetaEditorController } from "./hooks/use-workflow-library-detail";
import { DetailHeader } from "./sections/DetailHeader";

afterEach(cleanup);

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

function renderHeader() {
  render(
    <DetailHeader
      workflow={
        {
          id: "wf-1",
          name: "image_z_image_int8_t2i",
          taskType: "T2I",
          source: "local",
          modes: ["T2I"],
          defaultMode: "T2I",
          modelTags: [],
        } as unknown as WorkflowRow
      }
      usable
      canResync={false}
      missing={false}
      isTechnical={false}
      busyDownload={false}
      busyResync={false}
      meta={meta}
      onEdit={vi.fn()}
      onResync={vi.fn()}
      onDownload={vi.fn()}
      onDelete={vi.fn()}
      onOpenSource={vi.fn()}
      onUse={vi.fn()}
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
    expect(screen.getByTestId("detail-title-block").className).toContain(
      "min-w-[180px]",
    );
  });
});

describe("详情头部：执行日志入口固定在这一排", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  it("没跑过也显示入口，点开是全屏日志弹窗（入口不随有没有跑过而变）", () => {
    renderHeader();
    const open = screen.getByTestId("wflib-log-open");
    expect(open.textContent).toContain("暂无运行");
    fireEvent.click(open);
    expect(screen.getByTestId("wflib-log-modal")).toBeTruthy();
  });

  it("入口只有头部一处：两个页签里各放一个入口的旧形态不再回来", () => {
    /* 用户口径：入口要放在详情头部这一排。页签里再各挂一个会让「门」重新变成
     *  两处（ISSUE #611 的旧形态），位置也继续随页签 / 有无运行记录变化。 */
    expect(read("sections/WorkshopEncapsulationPanel.tsx")).not.toContain(
      "WorkflowRunLogButton",
    );
    expect(read("WorkflowCanvasNodePreview.tsx")).not.toContain(
      "WorkflowRunLogButton",
    );
  });
});

describe("左右分栏：详情面板能窄于内容最小宽度", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  it("详情面板带 min-w-0 + overflow-hidden，列表侧栏固定不缩", () => {
    /* 少了 `min-w-0`，`flex-1` 的自动最小尺寸会让面板撑破窗口宽度，
     * 右侧内容被裁 —— 这正是「小屏幕看不到最右侧」的成因。 */
    const library = read("WorkflowLibrary.tsx");
    expect(library).toMatch(/min-w-0 flex-1 overflow-hidden/);
    /* 宽度压力全给详情面板：列表是固定宽侧栏，不参与收缩（否则两边都变形）。 */
    expect(read("WorkflowLibraryList.tsx")).toMatch(/w-80 shrink-0 flex-col/);
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
   * 根因是**高度链条断了 + fitView 的下限由内容高度决定**：画布容器钉在
   * `h-[460px]`、横向画布之外还套了一层 `overflow-auto`（它按内容高度收边），
   * 而 React Flow 的 `fitView` 又只按节点包围盒缩放 —— 内容比视口矮时它不会
   * 把画布放大到铺满视口，于是画布底边以下落回面板底色。
   *
   * 这里锁三件事：① 容器不再被钉死高度；② 三列之上真的垫了背景板（它才是把
   * 包围盒撑到视口的那个）；③ 背景板尺寸由「视口与内容取大」给出（纯函数另有
   * 精确用例，这里钉住「没被写成只按内容算」）。 */

  it("画布容器吃满可用高度，不再被钉死在外层高度上", () => {
    const canvas = read("WorkflowLibraryCanvas.tsx");
    expect(canvas).toMatch(/bg-canvas relative h-full min-h-\[460px\]/);
    /* 画布自己的底色要在画布这一层（面板底色深浅不同，没铺到就成了那条缝）。 */
    expect(canvas).not.toMatch(/bg-panel-deep relative h-full min-h-\[460px\]/);
  });

  it("预览纵向吃满父级，中间不再有一层按内容收边的高度来源", () => {
    expect(read("WorkflowCanvasNodePreview.tsx")).toMatch(
      /flex h-full min-h-0 w-full flex-col items-center gap-3/,
    );
    /* 页签面板把高度传下去（缺 `h-full` 则整条链断在第一层）。 */
    expect(read("sections/DetailBody.tsx")).toMatch(
      /flex h-full min-h-\[420px\] flex-col/,
    );
  });

  it("三列之上垫了一层背景板，且它的尺寸由视口与内容取大", () => {
    const flow = read("hooks/use-library-wire-flow.ts");
    expect(flow).toContain("LIB_NODE_BACKDROP");
    /* 背景板不可交互：它只是底，不能抢走卡片的点击 / 拖动 / 连线。 */
    expect(flow).toMatch(/selectable: false[\s\S]{0,80}draggable: false/);

    const graph = read("workflow-library-wire-graph.ts");
    /* 取大，缺一边都会退回空白：比视口矮（高度）或比三列窄（右列被挤出视野）。 */
    expect(graph).toMatch(
      /Math\.max\(content\.height,\s*clamp\(viewport\.height\)\)/,
    );
    expect(graph).toMatch(
      /Math\.max\(content\.width,\s*clamp\(viewport\.width\)\)/,
    );
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
    expect(filters).toMatch(
      /workflow-library-filter-row[\s\S]{0,80}flex flex-nowrap items-center gap-2/,
    );
    expect(filters).not.toMatch(/flex flex-wrap items-center gap-2/);

    /* 触发按钮：宽度跟内容走，且不许被压。 */
    expect(filters).toContain("min-w-[112px] shrink-0");
  });

  it("页头把筛选包成一组并交给整行换行，动作组不许被压", () => {
    const header = read("WorkflowLibraryHeader.tsx");

    /* 根容器换行：排不下时整组落到第二行，而不是把某个下拉挤变形。 */
    expect(header).toMatch(/flex flex-wrap items-center gap-x-3 gap-y-2/);
    /* 筛选是一组：组内不换行（组之间才换行）。 */
    expect(header).toMatch(
      /workflow-library-header-filters[\s\S]{0,80}flex shrink-0 flex-nowrap/,
    );
    /* 标题与动作组同样不收缩。 */
    expect(header).toContain('className="font-title text-ink shrink-0 text-lg');
    expect(header).toMatch(
      /ml-auto flex shrink-0 flex-wrap items-center gap-2/,
    );
  });
});
