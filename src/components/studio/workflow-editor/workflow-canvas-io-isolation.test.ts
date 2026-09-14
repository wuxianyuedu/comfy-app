/**
 * 编辑器画布只画**工作流图**；对外参数的映射连线只在工作流库「画布节点」页签。
 *
 * 背景（两轮收敛）：
 *   ① 曾经把「对外参数映射」渲染成复用图节点视觉的画布节点，取消勾选 / 切模式时
 *      还会以另一种形态残留，看图时分不清哪些是真实节点；
 *   ② 改成独立的接线卡片（`wfParam` / `wfOutput`）后虽然不再混淆，但卡片贴着宿主
 *      节点左右各排一列、`zIndex` 比图节点高，**常态查看工作流时把图本身挡掉一片**
 *      （用户口径：「工作流编辑器画布中，不应该显示对外暴露的参数节点」）；
 *   ③ 最终口径是「彻底不显示」：落点映射编辑收敛到工作流库详情的「画布节点」
 *      页签（卡片列 + 连线层），编辑器画布只剩工作流图。
 *
 * 因此本守卫锁四件事：
 *   ① 编辑器画布的节点只来自 `buildInitialNodes`、连线只来自 `buildEdges` —— 谁都不
 *      许把 IO 条目拼进图节点/图连线的数组里；
 *   ② 编辑器里不再有卡片/映射线的构建入口，节点类型注册表里也没有 `wfParam` /
 *      `wfOutput`（删掉的模块不许回来）；
 *   ③ 编辑器仍要**保住**已有的落点映射：保存时把 `paramMap` 并进去（库内改过的线
 *      不能因为在这里按一次保存就被抹掉）；
 *   ④ 库内仍是可编辑的连线面（卡片圆点锚点 + 独立连线层 + 落库编排在 hooks/）。
 *
 * 这条守卫是源码级的：视图层出现第三条「派生画布节点/连线」的来源即被拦下。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EDITOR_DIR = path.resolve(__dirname);
const LIBRARY_DIR = path.resolve(__dirname, "../workflow-library");

/** 编辑器侧「工作流图」的允许来源。 */
const ALLOWED_GRAPH_SOURCES = ["buildInitialNodes", "buildEdges"];

/** 曾经把「对外参数映射」渲染成画布节点的模块 —— 一个都不许回来。
 *  它们的共同点是：卡片与映射线成为画布节点的一部分，浮在图节点之上挡住工作流。 */
const BANNED_EDITOR_MODULES = [
  "workflow-param-nodes.ts",
  "workflow-param-nodes.test.ts",
  "workflow-param-edges.ts",
  "workflow-output-nodes.ts",
  "workflow-output-nodes.test.ts",
  "workflow-param-node-data.ts",
  "WorkflowParamNode.tsx",
  "WorkflowParamNode.test.tsx",
  "WorkflowOutputParamNode.tsx",
  "WorkflowParamMapLayer.tsx",
  "workflow-library-canvas-config.ts",
];

/** 去掉块注释与行注释，避免文档里提到旧机制时误伤断言。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function readEditor(file: string): string {
  return readFileSync(path.join(EDITOR_DIR, file), "utf8");
}

describe("编辑器画布只画工作流图", () => {
  it("曾经的「把映射渲染成画布节点」的模块没有回来", () => {
    for (const banned of BANNED_EDITOR_MODULES) {
      expect(existsSync(path.join(EDITOR_DIR, banned)), banned).toBe(false);
    }
  });

  it("画布节点/连线的来源只有工作流自身", () => {
    const inner = stripComments(readEditor("WorkflowEditorInner.tsx"));
    for (const allowed of ALLOWED_GRAPH_SOURCES) expect(inner).toContain(allowed);
    /* 卡片 / 映射线的构建入口已从编辑器移除。 */
    for (const gone of [
      "buildParamNodes",
      "buildParamEdges",
      "buildOutputWiring",
      "isValidParamConnection",
      "isValidOutputConnection",
      "paramNodeId",
      "outputIoKeyFromNodeId",
    ]) {
      expect(inner, `${gone} 不该再出现在编辑器`).not.toContain(gone);
    }
    /* 连线数组里只有图连线。 */
    expect(inner).toMatch(/setEdges\(buildEdges\(/);
  });

  it("节点类型注册表里没有对外参数卡片", () => {
    const nodes = readEditor("WorkflowEditorNodes.tsx");
    expect(nodes).toMatch(/export const workflowNodeTypes = \{/);
    expect(nodes).not.toContain("wfParam");
    expect(nodes).not.toContain("wfOutput");
    /* 图自身的五类仍要齐（少了哪一类画布都会静默丢节点）。 */
    for (const keep of ["wfNode", "wfNote", "wfGroup", "wfSubgraph", "wfIoPort"]) {
      expect(nodes).toContain(keep);
    }
  });

  it("编辑器保存原样带上 paramMap：库内改过的落点不被抹掉", () => {
    /* 在库内改过的落点写在 `paramMap.source`。编辑器不再提供连线手势，但它保存时
     * 必须把当前 `paramMap` **原样**交上去 —— 否则「进编辑器点一次保存」就会把
     * 库内改的线抹掉。 */
    const persistence = stripComments(
      readFileSync(
        path.join(EDITOR_DIR, "hooks/use-workflow-persistence.ts"),
        "utf8",
      ),
    );
    expect(persistence).toMatch(/savePatch\.mutateAsync\(\{[\s\S]{0,120}paramMap/);
    /* 编辑器仍读映射状态（顶栏「恢复默认映射」的可用性 / 执行）。 */
    const inner = stripComments(readEditor("WorkflowEditorInner.tsx"));
    expect(inner).toContain("useParamMapping");
    expect(inner).toContain("resetAll");
  });

  it("编辑器不再有连线手势（连线只发生在库内）", () => {
    const inner = stripComments(readEditor("WorkflowEditorInner.tsx"));
    for (const gone of ["onConnect", "onEdgesDelete", "isValidConnection"]) {
      expect(inner, `${gone} 不该再出现在编辑器`).not.toContain(gone);
    }
  });
});

describe("库内「画布节点」页签仍是映射连线的编辑面", () => {
  it("卡片列只画圆点 + 标锚点，手势与落库在独立层", () => {
    const column = stripComments(
      readFileSync(path.join(LIBRARY_DIR, "WorkflowParamCardColumn.tsx"), "utf8"),
    );
    /* 圆点带锚点（连线层据此量位置 + 起手拖动）。 */
    expect(column).toContain("data-wire-anchor");
    /* 卡片列不是画布节点：不许碰 React Flow。 */
    for (const forbidden of ["@xyflow/react", "Handle", "onConnect"]) {
      expect(column).not.toContain(forbidden);
    }
    /* 连线层独立成文件：量位置 + 画 SVG + 上抛手势结果；不直接动数据。 */
    const wires = stripComments(
      readFileSync(path.join(LIBRARY_DIR, "WorkflowParamWires.tsx"), "utf8"),
    );
    expect(wires).toContain("data-wire-anchor");
    /* 落点两种形状都要认：独立参数行（`data-io-key`）与组合参数控件
     *  （`data-io-pins`，宽高 / 比例像素由同一控件录入，没有独立行）。属性名
     *  来自共享契约（workflow-io-types），两边用同一个字符串。 */
    expect(wires).toContain("WIRE_ROW_ATTR");
    expect(wires).toContain("WIRE_PINS_ATTR");
    /* 命中判定与落点解析同一份纯函数（别在这里另算一套）。 */
    expect(wires).toContain("resolveDropTarget");
    for (const forbidden of ["@xyflow/react", "savePatch", "mutateAsync"]) {
      expect(wires).not.toContain(forbidden);
    }
    /* 写入编排收在 hooks/ 里（第②层），经回调落库；连线层只上抛。 */
    const hook = stripComments(
      readFileSync(path.join(LIBRARY_DIR, "hooks/use-param-wiring.ts"), "utf8"),
    );
    expect(hook).toContain("applyWireEdit");
    expect(hook).toContain("onPatchParamMap");
  });

  it("库内也画对外输出卡片列（左列说「要什么」，右列说「给什么」）", () => {
    const outputColumn = stripComments(
      readFileSync(
        path.join(LIBRARY_DIR, "WorkflowOutputParamCardColumn.tsx"),
        "utf8",
      ),
    );
    expect(outputColumn).toContain('side="left"');
    expect(outputColumn).toContain("data-wire-anchor");
    /* 输出侧同样只有圆点 + 锚点，不碰 React Flow。 */
    for (const forbidden of ["@xyflow/react", "Handle", "onConnect"]) {
      expect(outputColumn).not.toContain(forbidden);
    }
  });

  it("卡片视觉本体与 React Flow 解耦（端点由消费方注入）", () => {
    const card = stripComments(readEditor("WorkflowParamCard.tsx"));
    for (const forbidden of ["@xyflow/react", "Handle"]) {
      expect(card).not.toContain(forbidden);
    }
  });

  it("工作流库不叠「对外参数映射层」（库内是卡片列 + 连线层，不是画布节点）", () => {
    const preview = readFileSync(
      path.join(LIBRARY_DIR, "WorkflowCanvasNodePreview.tsx"),
      "utf8",
    );
    const code = stripComments(preview);
    expect(code).not.toContain("WorkflowParamMapLayer");
    expect(code).not.toContain("deriveLibraryCanvas");
    expect(code).not.toContain("resolveManualEntryIds");
    expect(code).toContain("WorkflowParamCardColumn");
    expect(code).toContain("WorkflowOutputParamCardColumn");
  });

  it("对外参数清单只来自契约（按模式），不再逐节点列出工作流内部参数", () => {
    /* 「对外参数」是产品对用户承诺的那几个口子（提示词 / 尺寸 / 首帧…），
     *  由模式决定，与具体工作流无关 —— 契约表是唯一来源。 */
    const lib = readFileSync(
      path.resolve(__dirname, "../../../lib/workflow-exposed-params.ts"),
      "utf8",
    );
    expect(lib).toContain("exposedParamsForMode");
    const mapping = stripComments(
      readFileSync(
        path.resolve(__dirname, "../../../lib/workflow-param-mapping.ts"),
        "utf8",
      ),
    );
    expect(mapping).toContain("exposedParamsForMode");
  });

  it("库内按端口名找圆点锚点，落点仍在 ioKey 键空间（两者不混）", () => {
    const cards = stripComments(
      readFileSync(path.join(LIBRARY_DIR, "workflow-library-param-cards.ts"), "utf8"),
    );
    /* 落点是 ioKey；圆点锚点是端口名 —— 两者之间由 `wireHandleIdForIoKey` 换算，
     * 库内不许各写一套字符串拼装。 */
    expect(cards).toContain("wiredTargetsForEntry");
    expect(cards).toContain("wireHandleIdForIoKey");
    const mapping = readFileSync(
      path.resolve(__dirname, "../../../lib/workflow-param-mapping.ts"),
      "utf8",
    );
    expect(mapping).toContain("export function wiredTargetsForEntry");
    expect(mapping).toContain("wireHandleIdForIoKey");
  });
});
