import { beforeEach, describe, expect, it } from "vitest";

import { resetRateLimitBuckets } from "~/server/api/middleware/rate-limit";
import { rejectOverRateLimit } from "./rest-rate-limit";

const ENDPOINT = "http://127.0.0.1:3100/api/llm/test";

function requestFor(ip = "203.0.113.9"): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("rejectOverRateLimit（#4725 REST 端点限流）", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
  });

  it("窗口内前 20 次放行，第 21 次 → 429", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(rejectOverRateLimit(requestFor(), "llm-test")).toBeNull();
    }
    expect(rejectOverRateLimit(requestFor(), "llm-test")?.status).toBe(429);
  });

  it("不同端点各自一桶：A 端点打满不影响 B 端点", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(rejectOverRateLimit(requestFor(), "llm-test")).toBeNull();
    }
    expect(rejectOverRateLimit(requestFor(), "comfy-ensure")).toBeNull();
  });

  it("不同来源 IP 各自一桶（x-forwarded-for 首段）", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(rejectOverRateLimit(requestFor("203.0.113.9"), "llm-test")).toBeNull();
    }
    expect(rejectOverRateLimit(requestFor("203.0.113.10"), "llm-test")).toBeNull();
  });

  it("不带 x-forwarded-for（本机直连）回落 local 桶，不抛错", () => {
    const req = new Request(ENDPOINT, { method: "POST" });
    expect(rejectOverRateLimit(req, "llm-test")).toBeNull();
  });
});
