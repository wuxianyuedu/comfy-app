/**
 * 漫剧推荐工作流包分析（ISSUE #5219）：模式识别、必需节点缺件与依赖清单的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import { analyzeAnimeWorkflowPack, ANIME_PACK_MODES } from "./anime-workflow-pack";

const pack = (types: Array<string>, meta?: Record<string, unknown>) => ({
  meta,
  nodes: types.map((type, i) => ({
    id: i,
    inputs: i === 0 ? { ckpt_name: "model.safetensors" } : {},
    type,
  })),
});

describe("ANIME_PACK_MODES", () => {
  it("词表按字典序，判据与展示同源", () => {
    expect([...ANIME_PACK_MODES]).toEqual(["FLF2V", "I2V", "T2V"]);
  });
});

describe("analyzeAnimeWorkflowPack", () => {
  it("显式 meta.mode 优先，命中模式且节点齐全 → ok", () => {
    const result = analyzeAnimeWorkflowPack(
      pack(["CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode"], { mode: "t2v" }),
    );
    expect(result).toMatchObject({
      dependencies: ["ckpt_name:model.safetensors"],
      missingNodes: [],
      mode: "T2V",
      ok: true,
      requiredNodes: ["CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode"],
    });
    expect(result.purpose).toContain("文生视频");
  });

  it("从节点名识别 I2V，缺首帧加载节点时点名", () => {
    const result = analyzeAnimeWorkflowPack(
      pack(["CLIPTextEncode", "KSampler", "VAEDecode", "I2VGen"]),
    );
    expect(result.mode).toBe("I2V");
    expect(result.missingNodes).toEqual(["LoadImage"]);
    expect(result.ok).toBe(false);
  });

  it("FLF2V 的首尾帧变体也能识别", () => {
    const result = analyzeAnimeWorkflowPack(
      pack(["FirstLastFrameNode", "CLIPTextEncode", "KSampler", "LoadImage", "VAEDecode"]),
    );
    expect(result.mode).toBe("FLF2V");
    expect(result.ok).toBe(true);
  });

  it("脏形状按无法判定返回，不抛", () => {
    expect(analyzeAnimeWorkflowPack(null)).toMatchObject({ mode: null, ok: false });
    expect(analyzeAnimeWorkflowPack({ nodes: "x" })).toMatchObject({
      dependencies: [],
      missingNodes: [],
      mode: null,
      purpose: "未识别出漫剧镜头模式",
    });
  });
});
