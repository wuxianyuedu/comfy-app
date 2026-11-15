// LLM 上游等待预算（#4003 / 可终止性审计 #3889）：外部取消与墙钟预算谁先到都算数，
// fetch 必须拿到合成后的 signal——没有这一格，一次挂起的上游会把 run 循环的当前步永久占住。
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completeLLM,
  composeUpstreamSignal,
  describeFetchFailure,
  LLM_STREAM_TIMEOUT_MS,
  LLM_UPSTREAM_TIMEOUT_MS,
} from "~/lib/llm/server";
import type { LLMConfig, LLMMessage } from "~/lib/llm/types";

// 被测模块沿 import 图会碰到真库（env 校验在 vitest 里必炸）：按本仓既有形状替成内存边界。
vi.mock("~/server/db", async () => {
  const { dbMockBoundary } = await import("./helpers/wire-mock-boundary");
  return dbMockBoundary();
});

const CFG: LLMConfig = {
  baseUrl: "http://127.0.0.1:11434/v1",
  maxTokens: 16,
  model: "test-model",
  provider: "local",
  temperature: 0,
};

const MESSAGES: Array<LLMMessage> = [{ role: "user", content: "hi" }];

/** 永不落定的假 fetch：只把收到的 init 记下来，signal 一 abort 就 reject（模拟真 fetch 对中止的响应）。 */
function neverResolvingFetch(): { calls: Array<RequestInit> } {
  const calls: Array<RequestInit> = [];
  vi.stubGlobal("fetch", (_url: string | URL, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    });
  });
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("composeUpstreamSignal", () => {
  it("预算到点自动中止（墙钟预算真的会响，不是摆设）", async () => {
    const signal = composeUpstreamSignal(undefined, 20);
    expect(signal.aborted).toBe(false);
    /* 等异步落定走 expect.poll（§11.14），不写裸 sleep。 */
    await expect.poll(() => signal.aborted, { timeout: 5000, interval: 10 }).toBe(true);
    // 用类型守卫取名字，不写 `as DOMException`（lint 判据：先收窄再取值）。
    const reasonName = (reason: unknown): string =>
      reason instanceof DOMException ? reason.name : "";
    expect(reasonName(signal.reason)).toBe("TimeoutError");
  });

  it("外部取消立即传导（AbortSignal.any 合流，不用等预算）", () => {
    const ctrl = new AbortController();
    const signal = composeUpstreamSignal(ctrl.signal, 60_000);
    expect(signal.aborted).toBe(false);
    ctrl.abort();
    expect(signal.aborted).toBe(true);
  });

  it("两条预算口径都在场且流式不比非流式窄", () => {
    expect(LLM_UPSTREAM_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LLM_STREAM_TIMEOUT_MS).toBeGreaterThanOrEqual(LLM_UPSTREAM_TIMEOUT_MS);
  });
});

describe("completeLLM 的取消接线", () => {
  it("fetch 收到合成 signal；外部先取消时整链立即失败并给出可读文案", async () => {
    const { calls } = neverResolvingFetch();
    const ctrl = new AbortController();
    const pending = completeLLM(CFG, MESSAGES, ctrl.signal);
    pending.catch(() => {
      // 挂起 promise 的收尾交给下方断言；这里只压掉悬空拒绝。
    });
    // 让微任务先走完（fetch 已被调用、signal 已挂上）
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.length).toBe(1);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    ctrl.abort();
    await expect(pending).rejects.toThrow("LLM 请求已中止");
  });

  it("不传外部信号时也自带墙钟预算（signal 仍然在场）", async () => {
    const { calls } = neverResolvingFetch();
    const pending = completeLLM(CFG, MESSAGES);
    pending.catch(() => {
      // 同上：只压悬空拒绝，不参与断言。
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("describeFetchFailure 的中止分支", () => {
  it("TimeoutError 给出「等待超时、已中止」的可读文案", () => {
    const msg = describeFetchFailure(new DOMException("timed out", "TimeoutError"), CFG);
    expect(msg).toContain("等待超时");
    expect(msg).toContain("已中止");
  });

  it("AbortError 给出「请求已中止」的可读文案", () => {
    const msg = describeFetchFailure(new DOMException("aborted", "AbortError"), CFG);
    expect(msg).toContain("已中止");
  });
});
