// 项目画布的纯函数工具单测。连线传播（applyPropagationToNodes）是画布
// 数据流的地基：上游产出怎么落进下游节点，全靠这一个函数。

import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { CanvasNodeData, CanvasNodeType } from "./canvas-types";
import { applyPropagationToNodes, makeNodeId } from "./canvas-helpers";

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
  it("n_ 前缀 + 时间戳 + 随机段，两次调用不重复", () => {
    const a = makeNodeId();
    const b = makeNodeId();
    expect(a).toMatch(/^n_\d+_[a-z0-9]{4}$/);
    expect(a).not.toBe(b);
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
