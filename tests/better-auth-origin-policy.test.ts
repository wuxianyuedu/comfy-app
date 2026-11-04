/**
 * 认证 origin 策略判据（ISSUE #2158 第 4 条）：① 允许名单形状 —— better-auth `getHost()` 取带端口的 host，裸
 * `127.0.0.1` 与 `127.0.0.1:*` 一个是「不匹配且不报错」；② 动态解析按请求 Host 头走（桌面端口运行期才定）。
 * ③ 外来 host 必须落兜底，否则 `Host: evil.example.com` 被当合法 origin（DNS rebinding）；负控制：baseURL 不许退回字符串形态。
 */
import { describe, expect, it, vi } from "vitest";
import { matchesHostPattern, resolveBaseURL } from "better-auth";

// 配置模块的接线判据要真的把它加载起来 ⇒ 把它依赖的两样替身掉：
// `~/env`（缺 `.env` 时会抛）与 `~/server/db`（真库）。
vi.mock("~/env", () => ({
  env: {
    BETTER_AUTH_SECRET: "s".repeat(32),
    BETTER_AUTH_URL: undefined,
    BETTER_AUTH_GITHUB_CLIENT_ID: "test-client-id",
    BETTER_AUTH_GITHUB_CLIENT_SECRET: "test-client-secret",
    DATABASE_URL: "file:test.sqlite",
  },
}));
vi.mock("~/server/db", () => ({ db: {} }));

import { getBaseUrl } from "~/trpc/base-url";
import {
  AUTH_LOOPBACK_HOST_PATTERNS,
  authBaseUrlConfig,
  authTrustedOrigins,
} from "~/server/better-auth/origin-policy";

/** 桌面形态的运行期端口（壳挑的空闲端口，形态上就是这个区间）。 */
const RUNTIME_PORT = 3823;

describe("认证 origin 策略：允许名单的形状", () => {
  it("两种回环 host（都带端口）各自被名单覆盖", () => {
    // 名单是「每个 host 形状一条」，不是「一条通吃」：断言的是**覆盖**，
    // 不是每条 pattern 都匹配两个 host（`127.0.0.1:*` 本来就不匹配 localhost）。
    for (const host of [`127.0.0.1:${RUNTIME_PORT}`, `localhost:${RUNTIME_PORT}`]) {
      expect(AUTH_LOOPBACK_HOST_PATTERNS.some((pattern) => matchesHostPattern(host, pattern))).toBe(
        true,
      );
    }
  });

  it("名单里不许出现裸 host 形状（它与带端口的 host 不匹配）", () => {
    for (const pattern of AUTH_LOOPBACK_HOST_PATTERNS) {
      expect(pattern).toContain(":*");
    }
    // 反证：裸 host 形状确实不匹配带端口的 host（所以不能写进名单）。
    expect(matchesHostPattern(`127.0.0.1:${RUNTIME_PORT}`, "127.0.0.1")).toBe(false);
  });

  it("不放行非回环 host（DNS rebinding 那一族）", () => {
    for (const pattern of AUTH_LOOPBACK_HOST_PATTERNS) {
      expect(matchesHostPattern("evil.example.com:443", pattern)).toBe(false);
    }
  });
});

describe("认证 origin 策略：动态解析", () => {
  it("请求的 host 就是解析出来的 origin（桌面端口运行期才定也照样对）", () => {
    const config = authBaseUrlConfig(undefined);
    const request = new Request(`http://127.0.0.1:${RUNTIME_PORT}/api/auth/sign-in/email`, {
      headers: { host: `127.0.0.1:${RUNTIME_PORT}` },
    });
    expect(resolveBaseURL(config, "/api/auth", request, false, false)).toBe(
      `http://127.0.0.1:${RUNTIME_PORT}/api/auth`,
    );
  });

  it("localhost 形态同样按请求解析（裸 next dev 那条链路的 origin）", () => {
    const config = authBaseUrlConfig(undefined);
    const request = new Request("http://localhost:3100/api/auth/sign-in/email", {
      headers: { host: "localhost:3100" },
    });
    expect(resolveBaseURL(config, "/api/auth", request, false, false)).toBe(
      "http://localhost:3100/api/auth",
    );
  });

  it("不在名单里的 host 落兜底（不是解析成它）", () => {
    const config = authBaseUrlConfig(undefined);
    const request = new Request("http://evil.example.com/api/auth/sign-in/email", {
      headers: { host: "evil.example.com" },
    });
    const resolved = resolveBaseURL(config, "/api/auth", request, false, false);
    expect(String(resolved)).not.toContain("evil.example.com");
    expect(resolved).toBe(`${getBaseUrl()}/api/auth`);
  });

  it("没有请求（构建期那条路）落兜底，不抛", () => {
    const config = authBaseUrlConfig(undefined);
    expect(resolveBaseURL(config, "/api/auth", undefined, false, false)).toBe(
      `${getBaseUrl()}/api/auth`,
    );
  });
});

describe("认证 origin 策略：配置形状与可信 origin 名单", () => {
  it("baseURL 是动态形态，不许退回字符串（字符串 = 编译期写死 = 桌面必错）", () => {
    const config = authBaseUrlConfig(undefined);
    expect(typeof config).toBe("object");
    expect(Array.isArray(config.allowedHosts)).toBe(true);
    expect(config.allowedHosts.length).toBeGreaterThan(0);
  });

  it("没给配置项时兜底与应用自身 origin 同口径（不另写一份拼法）", () => {
    const config = authBaseUrlConfig(undefined);
    expect(config.fallback).toBe(getBaseUrl());
  });

  it("给了配置项时：兜底用它，且它的 host 进允许名单、origin 进可信名单", () => {
    const configured = "https://app.example.com";
    const config = authBaseUrlConfig(configured);
    expect(config.fallback).toBe(configured);
    expect(config.allowedHosts).toContain("app.example.com");
    expect(authTrustedOrigins(configured)).toContain("https://app.example.com");
  });

  it("可信 origin 名单覆盖两个回环形状，且每条都命中带端口的 host", () => {
    const origins = authTrustedOrigins(undefined);
    for (const pattern of AUTH_LOOPBACK_HOST_PATTERNS) {
      expect(origins).toContain(pattern);
    }
    expect(matchesHostPattern(`http://127.0.0.1:${RUNTIME_PORT}`, origins[0] ?? "")).toBe(true);
    expect(matchesHostPattern(`http://localhost:${RUNTIME_PORT}`, origins[1] ?? "")).toBe(true);
  });
});

describe("认证 origin 策略：接线", () => {
  it("配置模块的 baseURL 就是这份策略给的动态形态（不是各写一份）", async () => {
    const { auth } = await import("~/server/better-auth/config");
    expect(auth.options.baseURL).toEqual(authBaseUrlConfig(undefined));
  });

  it("配置模块的可信 origin 名单就是这份策略给的那份", async () => {
    const { auth } = await import("~/server/better-auth/config");
    expect(auth.options.trustedOrigins).toEqual(authTrustedOrigins(undefined));
  });
});
