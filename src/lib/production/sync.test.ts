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
    characterIds: [],
    description: "",
    id: "shot-1",
    index: 1,
    negativePrompt: "模糊",
    params: {},
    prompt: "一只戴宇航员头盔的柴犬",
    sceneHeading: "场景一",
    sceneId: "s1",
    shotType: "medium",
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
        imageUrl: "/api/generated/a.png",
        status: "done",
        taskId: "t9",
      }),
    );
    expect(patch).toMatchObject({
      kind: "image",
      negative: "模糊",
      prompt: "一只戴宇航员头盔的柴犬",
      resultPath: "/api/generated/a.png",
      shotId: "shot-1",
      status: "done",
      taskId: "t9",
    });
  });
});

describe("nodeEditToShot", () => {
  it("只回写编辑面（prompt/negative），不带生成态字段", () => {
    const patch = nodeEditToShot({ negative: "新负向", prompt: "新提示词" });
    expect(patch).toEqual({ negativePrompt: "新负向", prompt: "新提示词" });
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("taskId");
  });
});

describe("planShotSync", () => {
  it("已有同 shotId 节点 → 只出补丁、无新建；缺的列为待新建", () => {
    const shots = [makeShot({ id: "a" }), makeShot({ id: "b" })];
    const { newShotIds, patches } = planShotSync(shots, new Set(["a"]));
    expect(patches.map((p) => p.shotId)).toEqual(["a", "b"]);
    expect(newShotIds).toEqual(["b"]);
  });

  it("空 shot 列表 → 无补丁、无新建", () => {
    const { newShotIds, patches } = planShotSync([], new Set(["a"]));
    expect(patches).toEqual([]);
    expect(newShotIds).toEqual([]);
  });
});

describe("applyShotPatches", () => {
  it("命中 shotId 的节点合并补丁；非镜头节点原样保留", () => {
    const nodes = [
      { data: { kind: "image", prompt: "旧", shotId: "a" }, id: "n1" },
      { data: { content: "自由节点", kind: "text" }, id: "n2" },
    ];
    const out = applyShotPatches(nodes, [
      {
        kind: "image",
        negative: "",
        prompt: "新提示词",
        resultPath: "/api/generated/a.png",
        shotId: "a",
        status: "done",
      },
    ]);
    expect(out[0]?.data).toMatchObject({
      prompt: "新提示词",
      resultPath: "/api/generated/a.png",
      shotId: "a",
      status: "done",
    });
    // 非镜头节点原样返回（同一引用）
    expect(out[1]).toBe(nodes[1]);
  });

  it("无匹配补丁的镜头节点不动", () => {
    const nodes = [{ data: { prompt: "x", shotId: "a" }, id: "n1" }];
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
    expect(shotStatusToNodeStatus(nodeStatusToShotStatus("error"))).toBe("error");
  });
});

describe("nodeGenToShot", () => {
  it("done + 结果 → 写 status/taskId/imageUrl", () => {
    expect(
      nodeGenToShot({
        resultPath: "/api/generated/a.png",
        status: "done",
        taskId: "t1",
      }),
    ).toEqual({
      imageUrl: "/api/generated/a.png",
      status: "done",
      taskId: "t1",
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
      imageUrl: "/x.png",
      status: "done",
      taskId: "t",
    });
    expect(out[0]).toMatchObject({
      id: "a",
      imageUrl: "/x.png",
      status: "done",
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
        clipUrl: "/y.mp4",
        id: "a",
        imageUrl: "/x.png",
        rev: 2,
        status: "done",
      },
      { id: "b", imageUrl: "/z.png" },
    ];
    const out = applyShotRedo(shots, "a");
    const a = /* SAFETY: 类型断言已复核 */ out[0] as Record<string, unknown>;
    expect(a.imageUrl).toBeUndefined();
    expect(a.clipUrl).toBeUndefined();
    expect(a.status).toBe("idle");
    expect(a.clipStatus).toBe("idle");
    expect(a.rev).toBe(3);
    expect(out[1]).toBe(shots[1]);
    expect(out[0]).not.toBe(shots[0]);
  });

  it("无 rev 的镜头按 0 起，退回后置 1", () => {
    const out = /* SAFETY: 类型断言已复核 */ applyShotRedo(
      [{ id: "a", imageUrl: "/x" }],
      "a",
    ) as Array<Record<string, unknown>>;
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
        clipUrl: "/y.mp4",
        id: "a",
        imageUrl: "/x.png",
        prompt: "旧提示词",
        rev: 2,
        status: "done",
      },
      { id: "b", prompt: "别的" },
    ];
    const out = /* SAFETY: 类型断言已复核 */ applyReprompt(shots, "a", "新提示词") as Array<
      Record<string, unknown>
    >;
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
    const out = /* SAFETY: 类型断言已复核 */ applyReprompt(shots, "b", "改后") as Array<
      Record<string, unknown>
    >;
    expect(out[0]).toBe("字符串项");
    expect(out[1]!.prompt).toBe("改后");
    expect(out[1]!.rev).toBe(1);
  });
});
