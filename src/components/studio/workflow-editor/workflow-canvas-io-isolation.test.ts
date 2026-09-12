/**
 * 画布上的「对外参数节点」只表达映射，不得改动工作流图。
 *
 * 背景：勾选 IO 与画布节点曾经被绑死过一次 —— 那套派生节点复用了工作流节点的
 * 视觉，取消勾选 / 切模式时还会以另一种形态残留，看图时分不清哪些是真实节点。
 *
 * 但映射本身**必须**在画布上看得见、并且可连线（ISSUE #355）：作者要知道
 * 「这个对外口落到工作流的哪一行」，最自然的地方就是画布本身 —— 一张接线卡片
 * 拖一条线到宿主节点的端口。所以这里的约束不是「画布上不许有对外参数」，而是
 * 三条边界：
 *
 *   ① 图节点只来自工作流自身（`buildInitialNodes` / 图内连线 `buildEdges`）；
 *      对外参数节点只能由 `buildParamNodes` 产出、连线只能由 `buildParamEdges`
 *      产出 —— 谁都不许把 IO 条目拼进图节点/图连线的数组里；
 *   ② 对外参数节点必须与图节点在 id、类型、可拖性上分开：`pio:<条目id>` 前缀、
 *      `wfParam` 类型、`draggable:false`（位置派生自宿主节点）；
 *   ③ 连线只表达映射：目标是宿主节点上真实存在的端口（ioKey），且**不改工作流
 *      图** —— 拉线 / 删线只写 `paramMap`，不写图。
 *
 * 这条守卫是源码级的：视图层出现第三条「派生画布节点/连线」的来源即被拦下。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EDITOR_DIR = path.resolve(__dirname);
const LIBRARY_DIR = path.resolve(__dirname, "../workflow-library");

/** 视图层里「工作流图」的允许来源（对外参数节点/连线是另一条受约束的通道）。 */
const ALLOWED_GRAPH_SOURCES = ["buildInitialNodes", "buildEdges"];
/** 视图层里「对外参数节点 / 映射连线」的允许来源。 */
const ALLOWED_PARAM_SOURCES = ["buildParamNodes", "buildParamEdges"];

/** 曾经把「对外参数映射」渲染成画布节点/连线的模块名 —— 一个都不许回来。
 *  它们与当前这套的区别是：卡片复用了工作流节点的视觉与节点类型，且连线被
 *  当成图连线的一部分（切模式 / 取消勾选会留下残影）。 */
const BANNED_MODULES = [
  "workflow-param-node-data.test.ts",
  "WorkflowParamMapLayer.tsx",
  "WorkflowParamMapLayer.test.tsx",
  "workflow-library-canvas-config.ts",
  "workflow-library-canvas-config.test.ts",
];

/** 去掉块注释与行注释，避免文档里提到旧机制时误伤断言。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("对外参数节点只在画布上表达映射", () => {
  it("曾经的「复用图节点视觉」的映射模块没有回来", () => {
    for (const dir of [EDITOR_DIR, LIBRARY_DIR]) {
      for (const banned of BANNED_MODULES) {
        expect(existsSync(path.join(dir, banned))).toBe(false);
      }
    }
  });

  it("工作流图上没有「对外参数卡片」这类 node type —— 它们有独立类型", () => {
    const nodes = readFileSync(
      path.join(EDITOR_DIR, "WorkflowEditorNodes.tsx"),
      "utf8",
    );
    expect(nodes).toMatch(/export const workflowNodeTypes = \{/);
    /* 对外参数卡片注册在 `wfParam` 名下（不是工作流图的一部分）。 */
    expect(nodes).toContain("wfParam: WorkflowParamNode");
  });

  it("图节点只来自工作流自身；对外参数节点只来自 buildParamNodes", () => {
    const inner = stripComments(
      readFileSync(path.join(EDITOR_DIR, "WorkflowEditorInner.tsx"), "utf8"),
    );
    for (const allowed of ALLOWED_GRAPH_SOURCES)
      expect(inner).toContain(allowed);
    for (const allowed of ALLOWED_PARAM_SOURCES)
      expect(inner).toContain(allowed);
    /* 图节点 / 图连线数组里不许出现 IO 派生的卡片与映射线：它们各自有独立
     *  的构建入口（buildParamNodes / buildParamEdges），与图一起并排推送。 */
    expect(inner).not.toMatch(/setNodes\(\[\.\.\.[^\]]*param/i);
    expect(inner).not.toMatch(/buildEdges\([^)]*param/i);
  });

  it("拉线 / 删线只写映射，不写工作流图", () => {
    const inner = stripComments(
      readFileSync(path.join(EDITOR_DIR, "WorkflowEditorInner.tsx"), "utf8"),
    );
    /* 连线的源必须是 `pio:` 卡片（entryIdFromParamNodeId 反解），落点写入
     * paramMapping.connect —— 两者都在，且 savePatch 不出现在这两个回调里。 */
    const connectBlock = inner.slice(
      inner.indexOf("const onConnect = useCallback"),
    );
    expect(connectBlock).toContain("paramMapping.connect");
    const deleteBlock = inner.slice(
      inner.indexOf("const onEdgesDelete = useCallback"),
    );
    expect(deleteBlock).toContain("paramMapping.connect");
    for (const block of [connectBlock, deleteBlock]) {
      const body = block.slice(0, block.indexOf("const ", 10));
      expect(body).not.toContain("savePatch");
      expect(body).not.toContain("workflowIO");
    }
  });

  it("对外参数卡片是接线面板：不可拖（位置派生自宿主节点）", () => {
    const build = stripComments(
      readFileSync(path.join(EDITOR_DIR, "workflow-param-nodes.ts"), "utf8"),
    );
    expect(build).toContain("draggable: false");
    expect(build).toContain("connectable: false");
    expect(build).toContain("placeParamNodes");
  });

  it("映射连线带得动两个键空间：source 是卡片、targetHandle 是落点 ioKey", () => {
    const edges = stripComments(
      readFileSync(path.join(EDITOR_DIR, "workflow-param-edges.ts"), "utf8"),
    );
    expect(edges).toContain("paramNodeId(entry.id)");
    expect(edges).toContain("targetHandle: target");
    /* 卡片不存在时不画线 —— 否则图上会多出一条指向不存在节点的线头。 */
    expect(edges).toContain("renderedCardIds");
  });

  it("工作流库不叠「对外参数映射层」（库内是只读说明，不是画布节点）", () => {
    const preview = readFileSync(
      path.join(LIBRARY_DIR, "WorkflowCanvasNodePreview.tsx"),
      "utf8",
    );
    const code = stripComments(preview);
    expect(code).not.toContain("WorkflowParamMapLayer");
    expect(code).not.toContain("deriveLibraryCanvas");
    expect(code).not.toContain("resolveManualEntryIds");
  });

  it("对外参数卡片列不是画布节点：无 React Flow、无端点、无连线", () => {
    /* 卡片列是画布之外的只读视图：它只能 import 卡片视觉本体与纯派生函数，
     * 不许碰 React Flow（Handle / 边 / 节点类型），也不许自己画线。 */
    const column = stripComments(
      readFileSync(
        path.join(LIBRARY_DIR, "WorkflowParamCardColumn.tsx"),
        "utf8",
      ),
    );
    for (const forbidden of [
      "@xyflow/react",
      "Handle",
      "onConnect",
      "<svg",
      "<path",
    ]) {
      expect(column).not.toContain(forbidden);
    }
    /* 卡片视觉本体本身也不许依赖 React Flow —— 端点由消费方注入。 */
    const card = stripComments(
      readFileSync(path.join(EDITOR_DIR, "WorkflowParamCard.tsx"), "utf8"),
    );
    for (const forbidden of ["@xyflow/react", "Handle"]) {
      expect(card).not.toContain(forbidden);
    }
  });

  it("工作流库详情不靠单侧定宽留白给卡片列腾位置", () => {
    /* 卡片列与宿主卡片并排居中。历史上这里曾经用一条约 300px 的左侧 gutter 给
     * 卡片列挂靠，卡片层撤掉后 gutter 没跟着撤 —— 表现就是用户看到的「卡片没
     * 看到、左边空出块区域」。容器只负责居中，不做单侧留白。 */
    const body = readFileSync(
      path.join(LIBRARY_DIR, "sections/DetailBody.tsx"),
      "utf8",
    );
    const code = stripComments(body);
    expect(code).not.toMatch(/pl-\[\d+px\]/);
    expect(code).toContain("flex min-h-0 flex-1 justify-center overflow-auto");
  });

  it("映射几何只由纯函数给出（位置派生，不落库）", () => {
    const lib = stripComments(
      readFileSync(
        path.resolve(__dirname, "../../../lib/workflow-param-mapping.ts"),
        "utf8",
      ),
    );
    /* 位置 / 尺寸必须来自这里，视图层不许自己算卡片坐标。 */
    for (const required of [
      "PARAM_NODE_PREFIX",
      "paramNodeId",
      "entryIdFromParamNodeId",
      "placeParamNodes",
      "paramNodeHeight",
    ]) {
      expect(lib).toContain(required);
    }
    /* 位置是派生的：不写回 paramMap / positions。 */
    expect(lib).not.toContain("positions[");
  });
});
