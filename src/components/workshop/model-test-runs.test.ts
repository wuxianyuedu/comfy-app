// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ModelTestRunInput } from "./model-test-runs";
import { useModelTestRuns } from "./model-test-runs";

function run(sessionKey: string, index: number): ModelTestRunInput {
  return {
    durationMs: index,
    error: null,
    kind: "image",
    mode: "T2I",
    model: sessionKey,
    referenceImages: [],
    result: { kind: "image", url: `https://img.example/${String(index)}.png` },
    sessionKey,
    startedAt: index,
    status: "succeeded",
    values: {},
  };
}

describe("useModelTestRuns", () => {
  it("每个模型会话各保留最近 30 条，不被其他模型的历史逐出", () => {
    const { result } = renderHook(() => useModelTestRuns());
    act(() => {
      for (let index = 0; index < 35; index += 1) {
        result.current.recordRun(run("image::T2I::a", index));
      }
      for (let index = 35; index < 40; index += 1) {
        result.current.recordRun(run("image::T2I::b", index));
      }
    });

    const a = result.current.runs.filter((item) => item.sessionKey === "image::T2I::a");
    const b = result.current.runs.filter((item) => item.sessionKey === "image::T2I::b");
    expect(a).toHaveLength(30);
    expect(a[0]?.startedAt).toBe(34);
    expect(a.at(-1)?.startedAt).toBe(5);
    expect(b).toHaveLength(5);
    expect(result.current.runs).toHaveLength(35);
  });
});
