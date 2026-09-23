// Phase 3a：生产模型同步 reducer 的单测（纯函数，无需 render / 网络）。
// 锁住 shot ↔ 画布节点 的换算与「单一写入者」边界：投影写生成态、回写只动编辑面。

import { describe, expect, it } from "vitest";

import type { Shot } from "~/lib/workshop/types";
import {
  applyReprompt,
  applyShotGeneration,
  applyShotPatches,
  applyShotRedo,
  nodeEditToShot,
  nodeGenToShot,
  nodeStatusToShotStatus,
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

describe("nodeStatusToShotStatus", () => {
  it("节点词表逐一对回 Shot 词表", () => {
    expect(nodeStatusToShotStatus("done")).toBe("done");
    expect(nodeStatusToShotStatus("error")).toBe("failed");
    expect(nodeStatusToShotStatus("running")).toBe("running");
    expect(nodeStatusToShotStatus("idle")).toBe("idle");
  });

  it("与 shotStatusToNodeStatus 对偶：done/error 往返一致", () => {
    expect(shotStatusToNodeStatus(nodeStatusToShotStatus("done"))).toBe("done");
    expect(shotStatusToNodeStatus(nodeStatusToShotStatus("error"))).toBe(
      "error",
    );
  });
});

describe("nodeGenToShot", () => {
  it("done + 结果 → 写 status/taskId/imageUrl", () => {
    expect(
      nodeGenToShot({
        status: "done",
        taskId: "t1",
        resultPath: "/api/generated/a.png",
      }),
    ).toEqual({
      status: "done",
      taskId: "t1",
      imageUrl: "/api/generated/a.png",
    });
  });

  it("error → 只标 failed，不带 imageUrl（不清空已有 url）", () => {
    const patch = nodeGenToShot({ status: "error", taskId: "t2" });
    expect(patch).toEqual({ status: "failed", taskId: "t2" });
    expect(patch).not.toHaveProperty("imageUrl");
  });

  it("done 但无 resultPath → 不写 imageUrl", () => {
    const patch = nodeGenToShot({ status: "done" });
    expect(patch).toEqual({ status: "done" });
    expect(patch).not.toHaveProperty("imageUrl");
  });
});

describe("applyShotGeneration", () => {
  it("命中 shotId → 生成态合并进该镜头，其它镜头原样引用", () => {
    const shots = [makeShot({ id: "a" }), makeShot({ id: "b" })];
    const out = applyShotGeneration(shots, "a", {
      status: "done",
      taskId: "t",
      imageUrl: "/x.png",
    });
    expect(out[0]).toMatchObject({
      id: "a",
      status: "done",
      imageUrl: "/x.png",
    });
    // 未命中的镜头是同一引用（未变）
    expect(out[1]).toBe(shots[1]);
    // 命中的镜头是新对象（不可变）
    expect(out[0]).not.toBe(shots[0]);
  });

  it("无命中 → 原样返回入参引用（供调用方判「无需落库」）", () => {
    const shots = [makeShot({ id: "a" })];
    const out = applyShotGeneration(shots, "missing", { status: "done" });
    expect(out).toBe(shots);
  });
});

describe("applyShotRedo", () => {
  it("命中镜头：清图/视频、状态回 idle、rev 自增；其它镜头原样引用", () => {
    const shots = [
      {
        id: "a",
        imageUrl: "/x.png",
        clipUrl: "/y.mp4",
        status: "done",
        rev: 2,
      },
      { id: "b", imageUrl: "/z.png" },
    ];
    const out = applyShotRedo(shots, "a");
    const a = out[0] as Record<string, unknown>;
    expect(a.imageUrl).toBeUndefined();
    expect(a.clipUrl).toBeUndefined();
    expect(a.status).toBe("idle");
    expect(a.clipStatus).toBe("idle");
    expect(a.rev).toBe(3);
    expect(out[1]).toBe(shots[1]);
    expect(out[0]).not.toBe(shots[0]);
  });

  it("无 rev 的镜头按 0 起，退回后置 1", () => {
    const out = applyShotRedo([{ id: "a", imageUrl: "/x" }], "a") as Record<
      string,
      unknown
    >[];
    expect(out[0]!.rev).toBe(1);
  });

  it("非记录项 / 无命中 → 原样返回入参引用", () => {
    const shots = ["字符串项", { id: "b" }];
    expect(applyShotRedo(shots, "missing")).toBe(shots);
  });
});

describe("applyReprompt", () => {
  it("命中镜头：换新 prompt + 复用退回语义（清产物 / 状态 idle / rev 自增）", () => {
    const shots = [
      {
        id: "a",
        prompt: "旧提示词",
        imageUrl: "/x.png",
        clipUrl: "/y.mp4",
        status: "done",
        rev: 2,
      },
      { id: "b", prompt: "别的" },
    ];
    const out = applyReprompt(shots, "a", "新提示词") as Record<
      string,
      unknown
    >[];
    expect(out[0]!.prompt).toBe("新提示词");
    expect(out[0]!.imageUrl).toBeUndefined();
    expect(out[0]!.clipUrl).toBeUndefined();
    expect(out[0]!.status).toBe("idle");
    expect(out[0]!.rev).toBe(3);
    // 未命中镜头保持原引用（不被连带改写）
    expect(out[1]).toBe(shots[1]);
  });

  it("无命中 → 原样返回入参引用（不误改别的镜头）", () => {
    const shots = [{ id: "a", prompt: "x" }];
    expect(applyReprompt(shots, "missing", "新").length).toBe(1);
    expect(applyReprompt(shots, "missing", "新")).toBe(shots);
  });

  it("非记录项被跳过（只认带 id 的对象）", () => {
    const shots = ["字符串项", { id: "b", prompt: "p" }];
    const out = applyReprompt(shots, "b", "改后") as Record<string, unknown>[];
    expect(out[0]).toBe("字符串项");
    expect(out[1]!.prompt).toBe("改后");
    expect(out[1]!.rev).toBe(1);
  });
});
