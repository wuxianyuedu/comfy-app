/**
 * 画布只画工作流自身的图 —— 勾选 IO 不得往画布上新增任何节点。
 *
 * 为什么要有这条：映射曾经以「每个对外参数一张卡片（`pio:<条目>` 节点）+ 一条
 * 连线」的形式画在画布上，于是「勾了某个参数」和「图上多出一个节点」被绑死：
 * 取消勾选节点还在、切模式线还在、子图内部勾选还会留下悬空线头。语义上勾选只做
 * 一件事 —— 把这个端口暴露成工作流的对外参数（落 workflowIO / 出现在运行表单
 * 与「预览 IO」里），画布是工作流本身的呈现，不该被暴露选择影响。
 *
 * 编辑器画布与工作流库的画布预览**共用**这条约束：两处都只能画工作流自身的
 * 节点与图内连线。
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

/** 曾经用来把「对外参数」画成画布节点的模块名 —— 一个都不许回来。 */
const BANNED_MODULES = [
  "workflow-param-nodes.ts",
  "workflow-param-edges.ts",
  "workflow-param-nodes.test.ts",
  "WorkflowParamNode.tsx",
  "WorkflowParamNode.test.tsx",
  "WorkflowParamCard.tsx",
  "workflow-param-node-data.ts",
  "WorkflowParamMapLayer.tsx",
  "workflow-library-canvas-config.ts",
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
