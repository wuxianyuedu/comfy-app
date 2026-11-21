import { describe, expect, it } from "vitest";

import type { TaskLogEntry } from "~/lib/workshop/generation-client";
import { parseTaskLogProgress } from "./task-log-progress";

/** 造一条 info 日志（进度事件都以 `[comfy-cli 原始] <json>` 形态进日志）。 */
const line = (msg: string, t = 0): TaskLogEntry => ({ level: "info", msg, t });

describe("parseTaskLogProgress", () => {
  it("空日志给空快照", () => {
    expect(parseTaskLogProgress([])).toEqual({ currentNodeId: null, stages: [] });
  });

  it("executing 登记节点名与类名并标 running", () => {
    const snap = parseTaskLogProgress([
      line(
        '[comfy-cli 原始] {"schema":"event/1","type":"executing","node":"23:15","title":"Generate Text","class_type":"TextGenerateV2","prompt_id":"p1"}',
      ),
    ]);
    expect(snap.currentNodeId).toBe("23:15");
    expect(snap.stages).toEqual([
      {
        classType: "TextGenerateV2",
        nodeId: "23:15",
        pct: null,
        status: "running",
        title: "Generate Text",
      },
    ]);
  });

  it("progress 帧更新 completed/total 与百分比，同节点最新帧胜出（minimax-h3 文本生成逐 token）", () => {
    const snap = parseTaskLogProgress([
      line(
        '[comfy-cli 原始] {"type":"executing","node":"23:15","title":"Generate Text","class_type":"TextGenerateV2"}',
      ),
      line('[comfy-cli 原始] {"type":"progress","node":"23:15","completed":3,"total":8192}'),
      line('[comfy-cli 原始] {"type":"progress","node":"23:15","completed":4096,"total":8192}'),
      line('[comfy-cli 原始] {"type":"progress","node":"23:15","completed":8192,"total":8192}'),
    ]);
    const [textStage] = snap.stages;
    expect(textStage).toMatchObject({
      completed: 8192,
      nodeId: "23:15",
      pct: 100,
      status: "running",
      total: 8192,
    });
  });

  it("executed / execution_success / execution_cached 都算节点收尾", () => {
    const snap = parseTaskLogProgress([
      line('[comfy-cli 原始] {"type":"executing","node":"23:15","title":"Generate Text"}'),
      line('[comfy-cli 原始] {"type":"progress","node":"23:15","completed":8192,"total":8192}'),
      line('[comfy-cli 原始] {"type":"executed","node":"23:15","output":{}}'),
      line(
        '[comfy-cli 原始] {"type":"executing","node":"23:7","title":"KSampler","class_type":"KSampler"}',
      ),
      line('[comfy-cli 原始] {"type":"execution_success","node":"23:7"}'),
      line(
        '[comfy-cli 原始] {"type":"executing","node":"23:8","title":"VAE Decode","class_type":"VAEDecode"}',
      ),
      line('[comfy-cli 原始] {"type":"execution_cached","node":"23:8"}'),
    ]);
    expect(snap.stages.map((s) => [s.nodeId, s.status])).toEqual([
      ["23:15", "done"],
      ["23:7", "done"],
      ["23:8", "done"],
    ]);
  });

  it("阶段按节点首次出现顺序稳定排列（与图执行顺序一致）", () => {
    const snap = parseTaskLogProgress([
      line('[comfy-cli 原始] {"type":"executing","node":"23:1","title":"Load Diffusion Model"}'),
      line('[comfy-cli 原始] {"type":"executing","node":"23:15","title":"Generate Text"}'),
      line('[comfy-cli 原始] {"type":"executing","node":"23:7","title":"KSampler"}'),
      line('[comfy-cli 原始] {"type":"executing","node":"23:15","title":"Generate Text"}'),
    ]);
    expect(snap.stages.map((s) => s.nodeId)).toEqual(["23:1", "23:15", "23:7"]);
    expect(snap.currentNodeId).toBe("23:15");
  });

  it("顺序执行语义：新节点开跑时，此前仍 running 的节点一律按 done 收尾", () => {
    const snap = parseTaskLogProgress([
      line(
        '[comfy-cli 原始] {"type":"executing","node":"23:16","title":"Load CLIP","class_type":"CLIPLoader"}',
      ),
      line(
        '[comfy-cli 原始] {"type":"executing","node":"23:15","title":"Generate Text","class_type":"TextGenerateV2"}',
      ),
      line('[comfy-cli 原始] {"type":"progress","node":"23:15","completed":4096,"total":8192}'),
      line(
        '[comfy-cli 原始] {"type":"executing","node":"23:5","title":"MiniMax H3 Image Conditioning"}',
      ),
    ]);
    expect(snap.stages.map((s) => [s.nodeId, s.status])).toEqual([
      ["23:16", "done"],
      ["23:15", "done"],
      ["23:5", "running"],
    ]);
    expect(snap.currentNodeId).toBe("23:5");
  });

  it("只经由 progress 出现的节点也登记（无 executing 事件的形态）", () => {
    const snap = parseTaskLogProgress([
      line('[comfy-cli 原始] {"type":"progress","node":"23:7","completed":1,"total":6}'),
    ]);
    expect(snap.stages).toEqual([
      { nodeId: "23:7", pct: 17, status: "running", completed: 1, total: 6 },
    ]);
  });

  it("非 comfy-cli 原始行、非 JSON 行、坏 JSON、数组载荷都忽略", () => {
    const snap = parseTaskLogProgress([
      line("▶ comfy-cli 节点 [23:15] 生成文本（TextGenerateV2） 开始执行"),
      line('[comfy-cli stdout] {"type":"progress","node":"x","completed":1,"total":2}'),
      line('[comfy-cli 原始] {"type":"progress","node":"y",'),
      line("[comfy-cli 原始] [1,2,3]"),
      line("[comfy-cli 原始] not json"),
    ]);
    expect(snap).toEqual({ currentNodeId: null, stages: [] });
  });

  it("total ≤ 0 的 progress 帧不产生百分比（分母不可用）", () => {
    const snap = parseTaskLogProgress([
      line('[comfy-cli 原始] {"type":"executing","node":"23:15"}'),
      line('[comfy-cli 原始] {"type":"progress","node":"23:15","completed":3,"total":0}'),
    ]);
    const [stage] = snap.stages;
    expect(stage).toMatchObject({ nodeId: "23:15", pct: null });
    expect(stage?.completed).toBeUndefined();
  });

  it("minimax-h3-image 一轮完整序列：文本生成（8192 token）→ KSampler（6 步）→ 收尾", () => {
    const logs: Array<TaskLogEntry> = [
      line('[comfy-cli 原始] {"type":"queued","prompt_id":"p1"}'),
      line(
        '[comfy-cli 原始] {"type":"executing","node":"23:15","title":"Generate Text","class_type":"TextGenerateV2"}',
      ),
    ];
    /* 文本生成 88 帧 progress 里取首中尾三帧。 */
    for (const completed of [3, 4096, 8192]) {
      logs.push(
        line(
          `[comfy-cli 原始] {"type":"progress","node":"23:15","completed":${String(completed)},"total":8192}`,
        ),
      );
    }
    logs.push(
      line('[comfy-cli 原始] {"type":"executed","node":"23:15"}'),
      line(
        '[comfy-cli 原始] {"type":"executing","node":"23:5","title":"MiniMax H3 Image Conditioning","class_type":"MiniMaxH3ImageConditioning"}',
      ),
      line('[comfy-cli 原始] {"type":"executed","node":"23:5"}'),
      line(
        '[comfy-cli 原始] {"type":"executing","node":"23:7","title":"KSampler","class_type":"KSampler"}',
      ),
      line('[comfy-cli 原始] {"type":"progress","node":"23:7","completed":3,"total":6}'),
    );
    const snap = parseTaskLogProgress(logs);
    expect(snap.stages.map((s) => [s.nodeId, s.status, s.pct])).toEqual([
      ["23:15", "done", 100],
      ["23:5", "done", null],
      ["23:7", "running", 50],
    ]);
    expect(snap.currentNodeId).toBe("23:7");
  });
});
