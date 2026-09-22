// Phase 3a：生产模型同步 reducer 的单测（纯函数，无需 render / 网络）。
// 锁住 shot ↔ 画布节点 的换算与「单一写入者」边界：投影写生成态、回写只动编辑面。

import { describe, expect, it } from "vitest";

import type { Shot } from "~/lib/workshop/types";
import {
  applyShotPatches,
  nodeEditToShot,
  planShotSync,
  shotStatusToNodeStatus,
  shotToNodePatch,
} from "./sync";

function makeShot(over: Partial<Shot> = {}): Shot {
  return {
    id: "shot-1",
    index: 1,
    sceneId: "s1",
    sceneHeading: "场景一",
    shotType: "medium",
    description: "",
    characterIds: [],
    prompt: "一只戴宇航员头盔的柴犬",
    negativePrompt: "模糊",
    params: {},
    status: "idle",
    ...over,
  };
}

describe("shotStatusToNodeStatus", () => {
  it("queued/running 都算节点 running；done→done；failed→error；idle/stale→idle", () => {
    expect(shotStatusToNodeStatus("queued")).toBe("running");
    expect(shotStatusToNodeStatus("running")).toBe("running");
    expect(shotStatusToNodeStatus("done")).toBe("done");
    expect(shotStatusToNodeStatus("failed")).toBe("error");
    expect(shotStatusToNodeStatus("idle")).toBe("idle");
    expect(shotStatusToNodeStatus("stale")).toBe("idle");
  });
});

describe("shotToNodePatch", () => {
  it("镜头图投影为 image 节点补丁，带 shotId / prompt / negative / 生成态", () => {
    const patch = shotToNodePatch(
      makeShot({
        status: "done",
        imageUrl: "/api/generated/a.png",
        taskId: "t9",
      }),
    );
    expect(patch).toMatchObject({
      shotId: "shot-1",
      kind: "image",
      prompt: "一只戴宇航员头盔的柴犬",
      negative: "模糊",
      status: "done",
      taskId: "t9",
      resultPath: "/api/generated/a.png",
    });
  });
});

describe("nodeEditToShot", () => {
  it("只回写编辑面（prompt/negative），不带生成态字段", () => {
    const patch = nodeEditToShot({ prompt: "新提示词", negative: "新负向" });
    expect(patch).toEqual({ prompt: "新提示词", negativePrompt: "新负向" });
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("taskId");
  });
});

describe("planShotSync", () => {
  it("已有同 shotId 节点 → 只出补丁、无新建；缺的列为待新建", () => {
    const shots = [makeShot({ id: "a" }), makeShot({ id: "b" })];
    const { patches, newShotIds } = planShotSync(shots, new Set(["a"]));
    expect(patches.map((p) => p.shotId)).toEqual(["a", "b"]);
    expect(newShotIds).toEqual(["b"]);
  });

  it("空 shot 列表 → 无补丁、无新建", () => {
    const { patches, newShotIds } = planShotSync([], new Set(["a"]));
    expect(patches).toEqual([]);
    expect(newShotIds).toEqual([]);
  });
});

describe("applyShotPatches", () => {
  it("命中 shotId 的节点合并补丁；非镜头节点原样保留", () => {
    const nodes = [
      { id: "n1", data: { shotId: "a", prompt: "旧", kind: "image" } },
      { id: "n2", data: { kind: "text", content: "自由节点" } },
    ];
    const out = applyShotPatches(nodes, [
      {
        shotId: "a",
        kind: "image",
        prompt: "新提示词",
        negative: "",
        status: "done",
        resultPath: "/api/generated/a.png",
      },
    ]);
    expect(out[0]?.data).toMatchObject({
      shotId: "a",
      prompt: "新提示词",
      status: "done",
      resultPath: "/api/generated/a.png",
    });
    // 非镜头节点原样返回（同一引用）
    expect(out[1]).toBe(nodes[1]);
  });

  it("无匹配补丁的镜头节点不动", () => {
    const nodes = [{ id: "n1", data: { shotId: "a", prompt: "x" } }];
    const out = applyShotPatches(nodes, []);
    expect(out[0]).toBe(nodes[0]);
  });
});
