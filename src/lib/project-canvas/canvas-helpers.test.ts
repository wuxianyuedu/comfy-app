// @vitest-environment jsdom
// 项目画布的纯函数工具单测。连线传播（applyPropagationToNodes）是画布
// 数据流的地基：上游产出怎么落进下游节点，全靠这一个函数。

import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { CanvasNodeData, CanvasNodeType } from "./canvas-types";
import {
  applyPropagationToNodes,
  makeNodeId,
  placeCanvasNode,
  viewportCenter,
} from "./canvas-helpers";

/** 构造最小画布节点：applyPropagationToNodes 只读 id / type / data，
 *  其余 React Flow 字段（position 等）与传播逻辑无关。 */
function node(id: string, data: Partial<CanvasNodeData>): CanvasNodeType {
  return {
    id,
    type: "canvasNode",
    data,
    position: { x: 0, y: 0 },
  } as CanvasNodeType;
}

const ardotNode: CanvasNodeType = {
  id: "visual",
  type: "workflowArdot",
  data: {},
  position: { x: 0, y: 0 },
};

/** 出边最小形状：传播逻辑只读 target / targetHandle。 */
function edge(target: string, targetHandle?: string): Edge {
  return { id: `e-${target}`, source: "s", target, targetHandle };
}

describe("makeNodeId", () => {
  it("n_ 前缀 + 时间戳 + 序号，两次调用不重复", () => {
    /* id 走全库唯一出口 `~/lib/unique-id`（规范 16 §16.2.4.36）——
     * 收口前是 `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`：
     * 「同一毫秒会不会撞」靠概率，而节点 id 是连线的引用目标
     *（撞 id 的表现是「新节点把旧节点的连线一起接管」）。 */
    const a = makeNodeId();
    const b = makeNodeId();
    expect(a).toMatch(/^n_[0-9a-z]+-[0-9a-z]+$/);
    expect(a).not.toBe(b);
  });
});

describe("viewportCenter", () => {
  it("取浏览器视口中心（三处收口前各写一份，其中一处用容器尺寸）", () => {
    const original = { w: window.innerWidth, h: window.innerHeight };
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    expect(viewportCenter()).toEqual({ x: 600, y: 400 });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: original.w,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: original.h,
    });
  });
});

describe("placeCanvasNode", () => {
  const flow = {
    /* 屏幕坐标 → 画布坐标：只要断言「出口把**落点**交给了它」。 */
    screenToFlowPosition: (p: { x: number; y: number }) => ({
      x: p.x + 1000,
      y: p.y + 2000,
    }),
  };

  it("取落点 → 换算 → 组节点 → 追加（四步一次给全）", () => {
    const base = [node("existing", { kind: "text" })];
    const next = placeCanvasNode({
      nodes: base,
      point: { x: 30, y: 40 },
      flow,
      data: { kind: "image" } as CanvasNodeData,
    });
    expect(next).toHaveLength(2);
    expect(next[1]!.type).toBe("canvasNode");
    expect(next[1]!.position).toEqual({ x: 1030, y: 2040 });
    expect(next[1]!.data.kind).toBe("image");
  });

  it("不给落点时落在视口中心（收口前三处的第二分支）", () => {
    let received: { x: number; y: number } | null = null;
    placeCanvasNode({
      nodes: [],
      flow: {
        screenToFlowPosition: (p) => {
          received = p;
          return p;
        },
      },
      data: { kind: "image" } as CanvasNodeData,
    });
    expect(received).toEqual(viewportCenter());
  });

  it("落点显式为 null 时同样回落视口中心", () => {
    let received: { x: number; y: number } | null = null;
    placeCanvasNode({
      nodes: [],
      point: null,
      flow: {
        screenToFlowPosition: (p) => {
          received = p;
          return p;
        },
      },
      data: { kind: "image" } as CanvasNodeData,
    });
    expect(received).toEqual(viewportCenter());
  });

  it("不改动传进来的节点表（返回新数组）", () => {
    const base = [node("existing", { kind: "text" })];
    const next = placeCanvasNode({
      nodes: base,
      point: { x: 0, y: 0 },
      flow,
      data: { kind: "image" } as CanvasNodeData,
    });
    expect(base).toHaveLength(1);
    expect(next).not.toBe(base);
  });

  it("坐标本身已在画布坐标系时走 `flowPosition`（不再换算）", () => {
    /* 工作流跑完自动孵化下游节点就是这种情形：落点是「源节点右侧 340px」，
     * 它**已经是画布坐标**。这一支是 P35 判据在收口时抓出来的第四个落点
     * （当时只找到三处）—— 上一条的 `screenToFlowPosition` 被调了两次就说明
     * 走错了支。 */
    let calls = 0;
    const next = placeCanvasNode({
      nodes: [],
      flowPosition: { x: 340, y: 10 },
      flow: {
        screenToFlowPosition: (p) => {
          calls += 1;
          return { x: p.x + 9999, y: p.y + 9999 };
        },
      },
      data: { kind: "image" } as CanvasNodeData,
    });
    expect(calls).toBe(0);
    expect(next[0]!.position).toEqual({ x: 340, y: 10 });
  });

  it("可以显式指定 id（调用处要提前拿它建边）", () => {
    const next = placeCanvasNode({
      nodes: [],
      id: "n_sink",
      flowPosition: { x: 0, y: 0 },
      flow,
      data: { kind: "image" } as CanvasNodeData,
    });
    expect(next[0]!.id).toBe("n_sink");
  });

  it("每个新节点拿到不同的 id（连线引用目标不能撞）", () => {
    const first = placeCanvasNode({
      nodes: [],
      point: { x: 0, y: 0 },
      flow,
      data: { kind: "image" } as CanvasNodeData,
    });
    const second = placeCanvasNode({
      nodes: first,
      point: { x: 0, y: 0 },
      flow,
      data: { kind: "image" } as CanvasNodeData,
    });
    expect(first[0]!.id).not.toBe(second[1]!.id);
  });
});

describe("applyPropagationToNodes", () => {
  it("source 自身不被改写", () => {
    const src = node("s", { kind: "text", content: "一只猫" });
    const out = applyPropagationToNodes([src], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [edge("s")],
      importedFile: null,
    });
    expect(out[0]).toBe(src);
  });

  it("text → prompt handle：写进 prompt", () => {
    const src = node("s", { kind: "text", content: "一只猫" });
    const target = node("t", { kind: "image", prompt: "" });
    const out = applyPropagationToNodes([src, target], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [edge("t", "prompt")],
      importedFile: null,
    });
    expect(out[1]!.data.prompt).toBe("一只猫");
    expect(out[1]!.data.upstreamId).toBeUndefined();
  });

  it("text 内容为空时不覆盖下游已有的 prompt", () => {
    const src = node("s", { kind: "text", content: "   " });
    const target = node("t", { kind: "image", prompt: "保留我" });
    const out = applyPropagationToNodes([src, target], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [edge("t", "prompt")],
      importedFile: null,
    });
    expect(out[1]!.data.prompt).toBe("保留我");
  });

  /* ⚠️ 已知缺陷（本批只记录不改，见 docs/standards/17-UI与逻辑分离.md §17.9）：
   * 节点的 `mode` 实际存的是工作流类型 code（"T2I" / "I2I" / "T2V"，由
   * ImageGenerationPanel 的 patch({ mode: code }) 与 defaultData 写入），
   * 而 applyPropagationToNodes 里的自动切换比的是小写 "txt2img" / "t2v"，
   * 因此这两行**从未命中** —— 连线上游图片后模式不会被切成图生图。
   * 下面两条断言锁定的是**现状**，改 mode 枚举时它们会变红，
   * 提醒一起核对 CanvasNode/hooks/use-generate.ts 里同族的三个判断
   * （分别是 img2img、i2v、flf 这三处）。 */
  it("inputImage：写入 inputImage 并记录上游（模式自动切换当前不生效 — 见注释）", () => {
    const src = node("s", { kind: "image", resultPath: "/outputs/a.png" });
    const target = node("t", { kind: "image", mode: "T2I" });
    const out = applyPropagationToNodes([src, target], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [edge("t", "inputImage")],
      importedFile: "imported.png",
    });
    expect(out[1]!.data.inputImage).toBe("imported.png");
    expect(out[1]!.data.upstreamId).toBe("s");
    // 缺陷证据：mode 保持 T2I，没有切成 img2img
    expect(out[1]!.data.mode).toBe("T2I");
  });

  it("inputImage 分支在 mode 为小写 txt2img 时才切换（说明为何线上不生效）", () => {
    const src = node("s", { kind: "image", resultPath: "/outputs/a.png" });
    const target = node("t", { kind: "image", mode: "txt2img" });
    const out = applyPropagationToNodes([src, target], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [edge("t", "inputImage")],
      importedFile: "imported.png",
    });
    expect(out[1]!.data.mode).toBe("img2img");
  });

  it("inputImage：无导入文件时回落到上游 image 的 prompt（非 picture/movie 直连）", () => {
    const src = node("s", { kind: "image", prompt: "上游提示词" });
    const target = node("t", { kind: "image", prompt: "" });
    const out = applyPropagationToNodes([src, target], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [edge("t", "prompt")],
      importedFile: null,
    });
    expect(out[1]!.data.prompt).toBe("上游提示词");
  });

  it("picture 内容载体：把上游 mediaPath 写入 mediaPath 并记录上游", () => {
    const src = node("s", { kind: "picture", mediaPath: "ref.png" });
    const target = node("t", { kind: "picture", mediaPath: "" });
    const out = applyPropagationToNodes([src, target], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [edge("t")],
      importedFile: null,
    });
    expect(out[1]!.data.mediaPath).toBe("ref.png");
    expect(out[1]!.data.upstreamId).toBe("s");
  });

  it("picture 内容载体：importedFile 优先于 mediaPath", () => {
    const src = node("s", { kind: "picture", mediaPath: "ref.png" });
    const target = node("t", { kind: "picture", mediaPath: "" });
    const out = applyPropagationToNodes([src, target], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [edge("t")],
      importedFile: "fresh.png",
    });
    expect(out[1]!.data.mediaPath).toBe("fresh.png");
  });

  it("workflow 节点按 targetHandle 写进 workflowInputs", () => {
    const src = node("s", { kind: "text", content: "参考" });
    const target = node("t", { kind: "workflow", workflowInputs: {} });
    const out = applyPropagationToNodes([src, target], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [edge("t", "3.inputs.text")],
      importedFile: null,
    });
    expect(out[1]!.data.workflowInputs).toEqual({ "3.inputs.text": "参考" });
    expect(out[1]!.data.upstreamId).toBe("s");
  });

  it("seed / steps / cfg 按 handle 分派，空值不覆盖", () => {
    const src = node("s", { kind: "image", steps: 30, cfg: 7.5, seed: "42" });
    const withEmptySeed: CanvasNodeData = {
      ...(src.data as CanvasNodeData),
      seed: "",
    };
    const targets = [
      node("t1", { kind: "image", steps: 1 }),
      node("t2", { kind: "image", cfg: 1 }),
      node("t3", { kind: "image", seed: "old" }),
    ];
    const out = applyPropagationToNodes([src, ...targets], "s", {
      srcData: withEmptySeed,
      outEdges: [edge("t1", "steps"), edge("t2", "cfg"), edge("t3", "seed")],
      importedFile: null,
    });
    expect(out[1]!.data.steps).toBe(30);
    expect(out[2]!.data.cfg).toBe(7.5);
    // seed 为空串 → 不覆盖下游原值
    expect(out[3]!.data.seed).toBe("old");
  });

  it("workflowArdot 纯视觉节点跳过（无 data 可写）", () => {
    const src = node("s", { kind: "image", prompt: "x" });
    const out = applyPropagationToNodes([src, ardotNode], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [edge("visual", "prompt")],
      importedFile: null,
    });
    expect(out[1]).toBe(ardotNode);
  });

  it("没有出边指向的节点保持原样（引用不变，避免无谓重渲染）", () => {
    const src = node("s", { kind: "text", content: "x" });
    const unrelated = node("u", { kind: "image" });
    const out = applyPropagationToNodes([src, unrelated], "s", {
      srcData: src.data as CanvasNodeData,
      outEdges: [],
      importedFile: null,
    });
    expect(out[1]).toBe(unrelated);
  });

  it("video 节点接 inputImage：小写 t2v 才切 i2v（大写 T2V 不切 — 同一缺陷）", () => {
    const src = node("s", { kind: "image", resultPath: "/o/a.png" });
    const lower = applyPropagationToNodes(
      [src, node("t", { kind: "video", mode: "t2v" })],
      "s",
      {
        srcData: src.data as CanvasNodeData,
        outEdges: [edge("t", "inputImage")],
        importedFile: "imported.png",
      },
    );
    expect(lower[1]!.data.mode).toBe("i2v");

    const upper = applyPropagationToNodes(
      [src, node("t", { kind: "video", mode: "T2V" })],
      "s",
      {
        srcData: src.data as CanvasNodeData,
        outEdges: [edge("t", "inputImage")],
        importedFile: "imported.png",
      },
    );
    expect(upper[1]!.data.mode).toBe("T2V");
  });
});
