// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useStableHistoryTasks } from "./use-stable-history-tasks";

/** 4s 轮询回来的是新 data 对象，但行内容往往一字未变：
 *  旧实现每次都重建 100 个 TaskItem，让 memo 的卡片全部失效。这里钉住
 *  「值不变 → 沿用旧数组引用；值变了 → 才换引用」这条行为。 */
function page(id: string, finishedAt: string) {
  return {
    tasks: [
      {
        id,
        status: "SUCCEEDED",
        createdAt: "2026-01-01T00:00:00Z",
        finishedAt,
        prompt: "一只猫",
        cover: null,
        workflowName: "t2i",
        type: "image",
      },
    ],
  };
}

describe("useStableHistoryTasks（轮询引用稳定）", () => {
  it("新 pages 对象但内容一致时返回同一个 tasks 数组", () => {
    const first = page("a", "2026-01-01T00:01:00Z");
    const { result, rerender } = renderHook(({ pages }) => useStableHistoryTasks(pages), {
      initialProps: { pages: [first] },
    });
    const before = result.current;
    rerender({ pages: [page("a", "2026-01-01T00:01:00Z")] });
    expect(result.current).toBe(before);
  });

  it("完成时刻变了就重建数组（用户看得见的字段都参与比较）", () => {
    const { result, rerender } = renderHook(({ pages }) => useStableHistoryTasks(pages), {
      initialProps: { pages: [page("a", "2026-01-01T00:01:00Z")] },
    });
    const before = result.current;
    rerender({ pages: [page("a", "2026-01-01T00:02:00Z")] });
    expect(result.current).not.toBe(before);
    expect(result.current[0]?.finishedAt).toBe("2026-01-01T00:02:00Z");
  });

  it("params / validationErrors 是每次轮询新造的等价对象时仍沿用旧引用", () => {
    const withObjects = (seed: number) => ({
      tasks: [
        {
          id: "a",
          status: "SUCCEEDED",
          createdAt: "2026-01-01T00:00:00Z",
          finishedAt: "2026-01-01T00:01:00Z",
          prompt: "一只猫",
          cover: null,
          workflowName: "t2i",
          type: "image",
          params: { workflow: "wf-1", seed },
          validationErrors: [
            { classType: "KSampler", field: "prompt", message: "ok", nodeId: "1" },
          ],
        },
      ],
    });
    const { result, rerender } = renderHook(({ pages }) => useStableHistoryTasks(pages), {
      initialProps: { pages: [withObjects(42)] },
    });
    const before = result.current;
    /* 服务端每次 JSON 反序列化都会给新对象；内容一致就不该重建 100 个 TaskItem。 */
    rerender({ pages: [withObjects(42)] });
    expect(result.current).toBe(before);
    rerender({ pages: [withObjects(43)] });
    expect(result.current).not.toBe(before);
  });

  it("新增一页时重建，且仍按 id 去重保持页序", () => {
    const { result, rerender } = renderHook(({ pages }) => useStableHistoryTasks(pages), {
      initialProps: { pages: [page("a", "2026-01-01T00:01:00Z")] },
    });
    rerender({
      pages: [page("a", "2026-01-01T00:01:00Z"), page("b", "2026-01-01T00:02:00Z")],
    });
    expect(result.current.map((task) => task.id)).toEqual(["a", "b"]);
  });
});
