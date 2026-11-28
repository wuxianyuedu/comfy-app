/**
 * 工作流选型决策日志（ISSUE #5278）：外来候选收窄、选中项排第一、人读复盘的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import { buildSelectionLog, selectionCandidatesOf, selectionSummary } from "./selection-log";

describe("selectionCandidatesOf", () => {
  it("只收有 id/name 的对象，脏项跳过且限量", () => {
    expect(
      selectionCandidatesOf(
        [
          { id: "w1", name: "图生视频" },
          { id: "" },
          null,
          { id: "w2" },
          { id: "w3", name: "文生视频" },
        ],
        2,
      ),
    ).toEqual([
      { id: "w1", name: "图生视频" },
      { id: "w3", name: "文生视频" },
    ]);
    expect(selectionCandidatesOf("w1")).toEqual([]);
  });
});

describe("buildSelectionLog", () => {
  it("没选工作流时返回 null（没有决策可记）", () => {
    expect(
      buildSelectionLog({
        candidates: [],
        cost: { frames: 49, fps: 16, size: "1k" },
        source: "user",
        workflowId: "",
      }),
    ).toBeNull();
  });

  it("选中项排第一、其余去重跟上，来源与成本快照留存", () => {
    const log = buildSelectionLog({
      candidates: [
        { id: "w2", name: "备选" },
        { id: "w1", name: "主选" },
        { id: "w2", name: "备选重复" },
      ],
      cost: { frames: 81, fps: 16, size: "2k" },
      source: "pack",
      workflowId: "w1",
    });
    expect(log?.workflowId).toBe("w1");
    expect(log?.source).toBe("pack");
    expect(log?.candidates.map((candidate) => candidate.id)).toEqual(["w1", "w2"]);
    if (log === null) {
      throw new Error("期望有选型日志");
    }
    expect(selectionSummary(log)).toContain("推荐包导入");
    expect(selectionSummary(log)).toContain("81 帧 / 16 fps / 2k");
  });
});
