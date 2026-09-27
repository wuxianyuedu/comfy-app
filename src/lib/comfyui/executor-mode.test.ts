/**
 * `executor-mode.ts` 的判据契约（P3 §5 ADR §13-3B1）。
 *
 * 这个模块的返回值**同时**决定「行落什么 claimedBy」与「Next 进程内是否
 * enqueue」——两个动作共用一次解析，所以归一化规则必须钉死：大小写/空白宽容、
 * 空值即 inline、未知值 warn 后按 inline（不猜意图，与 launcher 的门控同形）。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock("~/lib/core/logger", () => ({
  logger: { warn: warnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveExecutorClaim } from "./executor-mode";

const original = process.env.COMFY_EXECUTOR;
beforeEach(() => {
  delete process.env.COMFY_EXECUTOR;
  warnMock.mockClear();
});
afterAll(() => {
  if (original === undefined) delete process.env.COMFY_EXECUTOR;
  else process.env.COMFY_EXECUTOR = original;
});

describe("resolveExecutorClaim", () => {
  it("未设 / 空串 → inline（现状默认）", () => {
    expect(resolveExecutorClaim()).toBe("inline");
    process.env.COMFY_EXECUTOR = "   ";
    expect(resolveExecutorClaim()).toBe("inline");
  });

  it("host / HOST / 带空白 → host（大小写与首尾空白宽容）", () => {
    process.env.COMFY_EXECUTOR = "host";
    expect(resolveExecutorClaim()).toBe("host");
    process.env.COMFY_EXECUTOR = " HOST ";
    expect(resolveExecutorClaim()).toBe("host");
  });

  it("非法值不猜意图：warn 一行后按 inline", () => {
    process.env.COMFY_EXECUTOR = "deamon";
    expect(resolveExecutorClaim()).toBe("inline");
    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});

if (original !== undefined) process.env.COMFY_EXECUTOR = original;
