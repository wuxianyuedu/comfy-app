/**
 * 画布只画工作流自身的图 —— 勾选 IO 不得往画布上新增任何 React Flow 节点。
 *
 * 为什么要有这条：映射曾经以「每个对外参数一张卡片（`pio:<条目>` 节点）+ 一条
 * 连线」的形式画在画布上，于是「勾了某个参数」和「图上多出一个节点」被绑死：
 * 取消勾选节点还在、切模式线还在、子图内部勾选还会留下悬空线头。语义上勾选只做
 * 一件事 —— 把这个端口暴露成工作流的对外参数（落 workflowIO / 出现在运行表单
 * 与「预览 IO」里），画布是工作流本身的呈现，不该被暴露选择影响。
 *
 * **例外（刻意保留）**：工作流库详情的「画布节点」页签里有一列**只读**的对外
 * 参数卡片（`WorkflowParamCardColumn`）。它不是画布上的节点（不进 React Flow、
 * 不可拖、没有端点、不连任何线），而是这张预览卡片旁边的一块说明：哪几个端口
 * 合成了哪个对外参数、每个对外参数落到哪一行。它与宿主卡片的表单行互补 ——
 * 表单行是「这一格填的是什么值」，卡片是「这一行属于哪个对外参数」。既然暴露的
 * 参数在库详情必须看得见，而画布上又不许长节点，这一列就落在画布**之外**的
 * flex 布局里，两张卡片并排居中（不靠固定留白挂靠，见下面最后一条）。
 *
 * 这条守卫是源码级的：视图层只允许 `buildInitialNodes`（工作流自身的节点）与
 * `buildEdges`（图内连线）两个来源，任何「按 IO 条目派生 React Flow 节点／连线」
 * 的重新引入都会被当场拦下。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EDITOR_DIR = path.resolve(__dirname);
const LIBRARY_DIR = path.resolve(__dirname, "../workflow-library");

/** 视图层里「派生画布节点 / 连线」的允许来源。 */
const ALLOWED_NODE_SOURCES = ["buildInitialNodes", "buildEdges"];

/** 曾经用来把「对外参数」画成**画布节点与连线**的模块名 —— 一个都不许回来。
 *  注意这里不含卡片视觉本体：卡片现在是画布之外的只读视图，允许存在。 */
const BANNED_MODULES = [
  "workflow-param-nodes.ts",
  "workflow-param-edges.ts",
  "workflow-param-nodes.test.ts",
  "WorkflowParamNode.tsx",
  "WorkflowParamNode.test.tsx",
  "workflow-param-node-data.ts",
  "WorkflowParamMapLayer.tsx",
  "WorkflowParamMapLayer.test.tsx",
  "workflow-library-canvas-config.ts",
  "workflow-library-canvas-config.test.ts",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map((entry) => String(entry))
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
    .map((name) => path.join(dir, name));
}

/** 去掉块注释与行注释，避免文档里提到旧机制时误伤断言。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("勾选 IO 不在画布上新增节点", () => {
  it("编辑器与工作流库里都没有「按对外参数条目派生画布节点/连线」的模块", () => {
    const names = [...sourceFiles(EDITOR_DIR), ...sourceFiles(LIBRARY_DIR)].map((file) =>
      path.basename(file)
    );
    for (const banned of BANNED_MODULES) expect(names).not.toContain(banned);
    for (const dir of [EDITOR_DIR, LIBRARY_DIR]) {
      for (const banned of BANNED_MODULES) {
        expect(existsSync(path.join(dir, banned))).toBe(false);
      }
    }
  });

  it("节点类型注册表里没有「对外参数卡片」这类 node type", () => {
    const nodes = readFileSync(path.join(EDITOR_DIR, "WorkflowEditorNodes.tsx"), "utf8");
    expect(nodes).toMatch(/export const workflowNodeTypes = \{/);
    expect(stripComments(nodes)).not.toContain("wfParam");
  });

  it("编辑器画布节点只来自工作流自身（buildInitialNodes / buildEdges）", () => {
    const inner = readFileSync(path.join(EDITOR_DIR, "WorkflowEditorInner.tsx"), "utf8");
    for (const allowed of ALLOWED_NODE_SOURCES) expect(inner).toContain(allowed);
    const code = stripComments(inner);
    /* 任何把 IO 条目拼进画布节点/连线数组的写法都会被这里拦下。 */
    expect(code).not.toMatch(/setNodes\(\[\.\.\.[^\]]*param/i);
    expect(code).not.toMatch(/\.\.\.param(Nodes|Edges)/);
    expect(code).not.toMatch(/from "\.\/workflow-param-(nodes|edges)"/);
  });

  it("工作流库画布预览不再叠「对外参数映射层」", () => {
    const preview = readFileSync(
      path.join(LIBRARY_DIR, "WorkflowCanvasNodePreview.tsx"),
      "utf8"
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
      readFileSync(path.join(LIBRARY_DIR, "WorkflowParamCardColumn.tsx"), "utf8")
    );
    for (const forbidden of ["@xyflow/react", "Handle", "onConnect", "<svg", "<path"]) {
      expect(column).not.toContain(forbidden);
    }
    const card = stripComments(readFileSync(path.join(EDITOR_DIR, "WorkflowParamCard.tsx"), "utf8"));
    for (const forbidden of ["@xyflow/react", "Handle", "onConnect", "<svg", "<path"]) {
      expect(card).not.toContain(forbidden);
    }
  });

  it("工作流库详情不靠单侧定宽留白给卡片列腾位置", () => {
    /* 卡片列与宿主卡片并排居中。历史上这里曾经用一条约 300px 的左侧 gutter 给
     * 卡片列挂靠，卡片层撤掉后 gutter 没跟着撤 —— 表现就是用户看到的「卡片没
     * 看到、左边空出块区域」。容器只负责居中，不做单侧留白。 */
    const body = readFileSync(
      path.join(LIBRARY_DIR, "sections/DetailBody.tsx"),
      "utf8"
    );
    const code = stripComments(body);
    expect(code).not.toMatch(/pl-\[\d+px\]/);
    expect(code).toContain("flex min-h-0 flex-1 justify-center overflow-auto");
  });

  it("对外参数模块不再导出画布几何（节点 id / 卡片尺寸）", () => {
    const lib = readFileSync(path.resolve(__dirname, "../../../lib/workflow-param-mapping.ts"), "utf8");
    const code = stripComments(lib);
    for (const gone of [
      "PARAM_NODE_PREFIX",
      "paramNodeId",
      "entryIdFromParamNodeId",
      "placeParamNodes",
      "PARAM_NODE_WIDTH",
      "PARAM_NODE_GAP",
    ]) {
      expect(code).not.toContain(gone);
    }
  });
});
