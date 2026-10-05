// use-shot-review 契约（P8-1b）：评审走 run-client 并写 verdict、失败置 error；
// 重生成成功后回调刷新 + 成功 toast，失败走 error toast。toast / run-client 均 mock。
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reviewShot, regenerateShot } = vi.hoisted(() => ({
  reviewShot: vi.fn(),
  regenerateShot: vi.fn(),
}));
vi.mock("~/lib/production/run-client", () => ({ reviewShot, regenerateShot }));

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("~/components/studio/ToastProvider", () => ({ useToast: () => toast }));

import { useShotReview } from "./use-shot-review";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useShotReview.review", () => {
  it("成功 → 写入 verdict", async () => {
    const verdict = {
      pass: false,
      issues: ["含混"],
      suggestion: "更具体",
      scoredAt: "t",
    };
    reviewShot.mockResolvedValue(verdict);
    const { result } = renderHook(() => useShotReview("proj_1"));
    await act(async () => {
      await result.current.review("s1");
    });
    expect(reviewShot).toHaveBeenCalledWith("proj_1", "s1");
    expect(result.current.verdict).toEqual(verdict);
    expect(result.current.error).toBe("");
    expect(result.current.reviewing).toBe(false);
  });

  it("失败 → verdict 清空、error 有文案", async () => {
    reviewShot.mockRejectedValue(new Error("模型未配置"));
    const { result } = renderHook(() => useShotReview("proj_1"));
    await act(async () => {
      await result.current.review("s1");
    });
    expect(result.current.verdict).toBeNull();
    expect(result.current.error).toBe("模型未配置");
  });

  it("无 projectId → 不发请求", async () => {
    const { result } = renderHook(() => useShotReview(""));
    await act(async () => {
      await result.current.review("s1");
    });
    expect(reviewShot).not.toHaveBeenCalled();
  });
});

describe("useShotReview.regenerate", () => {
  it("gacha 成功 → 调 run-client + 成功 toast + 刷新回调", async () => {
    regenerateShot.mockResolvedValue(undefined);
    const onRegenerated = vi.fn();
    const { result } = renderHook(() => useShotReview("proj_1", onRegenerated));
    await act(async () => {
      await result.current.regenerate("s1", "gacha");
    });
    expect(regenerateShot).toHaveBeenCalledWith("proj_1", "s1", "gacha");
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() => expect(onRegenerated).toHaveBeenCalledTimes(1));
  });

  it("失败 → error toast，不触发刷新回调", async () => {
    regenerateShot.mockRejectedValue(new Error("网络失败"));
    const onRegenerated = vi.fn();
    const { result } = renderHook(() => useShotReview("proj_1", onRegenerated));
    await act(async () => {
      await result.current.regenerate("s1", "reprompt");
    });
    expect(toast.error).toHaveBeenCalled();
    expect(onRegenerated).not.toHaveBeenCalled();
  });
});
