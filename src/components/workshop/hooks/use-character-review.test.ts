// @vitest-environment jsdom
// use-character-review 契约：评审走 run-client 写 verdict、失败置 error、无 projectId 不发请求。
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reviewCharacter } = vi.hoisted(() => ({
  reviewCharacter: vi.fn(),
}));
vi.mock("~/lib/production/run-client", () => ({ reviewCharacter }));

import { useCharacterReview } from "./use-character-review";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCharacterReview", () => {
  it("成功 → 写入 verdict", async () => {
    const verdict = {
      pass: true,
      issues: [],
      suggestion: "",
      scoredAt: "t",
    };
    reviewCharacter.mockResolvedValue(verdict);
    const { result } = renderHook(() => useCharacterReview("proj_1"));
    await act(async () => {
      await result.current.review("c1");
    });
    expect(reviewCharacter).toHaveBeenCalledWith("proj_1", "c1");
    expect(result.current.verdict).toEqual(verdict);
    expect(result.current.error).toBe("");
    expect(result.current.reviewing).toBe(false);
  });

  it("失败 → verdict 清空、error 有文案", async () => {
    reviewCharacter.mockRejectedValue(new Error("模型未配置"));
    const { result } = renderHook(() => useCharacterReview("proj_1"));
    await act(async () => {
      await result.current.review("c1");
    });
    expect(result.current.verdict).toBeNull();
    expect(result.current.error).toBe("模型未配置");
  });

  it("无 projectId → 不发请求", async () => {
    const { result } = renderHook(() => useCharacterReview(""));
    await act(async () => {
      await result.current.review("c1");
    });
    expect(reviewCharacter).not.toHaveBeenCalled();
  });

  it("reset → 清空 verdict 与 error", async () => {
    reviewCharacter.mockResolvedValue({
      pass: false,
      issues: ["x"],
      suggestion: "y",
      scoredAt: "t",
    });
    const { result } = renderHook(() => useCharacterReview("proj_1"));
    await act(async () => {
      await result.current.review("c1");
    });
    expect(result.current.verdict).not.toBeNull();
    await act(async () => {
      result.current.reset();
    });
    expect(result.current.verdict).toBeNull();
    expect(result.current.error).toBe("");
  });
});
