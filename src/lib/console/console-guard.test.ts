import { describe, expect, it } from "vitest";

import {
  isLoopbackHost,
  isLoopbackOrigin,
  isLoopbackRequest,
} from "./console-guard";

/** 用普通 map 拼一个 `headers.get` 形状（本模块只看这两个键）。 */
function headers(init: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return init[name.toLowerCase()] ?? null;
    },
  };
}

describe("isLoopbackHost", () => {
  it("认回环的四种写法（含 IPv6 与带端口）", () => {
    for (const value of [
      "localhost",
      "localhost:3100",
      "127.0.0.1",
      "127.0.0.1:3100",
      "127.1.2.3",
      "::1",
      "[::1]:3100",
      "::ffff:127.0.0.1",
      "LOCALHOST:3100",
    ]) {
      expect(isLoopbackHost(value), value).toBe(true);
    }
  });

  it("不把近似串判成回环（`127.evil.com` 这类）", () => {
    for (const value of [
      "127.evil.com",
      "192.168.1.10",
      "10.0.0.1",
      "example.com",
      "notlocalhost",
      "::2",
      "",
      null,
      undefined,
      "   ",
    ]) {
      expect(isLoopbackHost(value), String(value)).toBe(false);
    }
  });
});

describe("isLoopbackOrigin", () => {
  it("合法回环来源", () => {
    expect(isLoopbackOrigin("http://127.0.0.1:3100")).toBe(true);
    expect(isLoopbackOrigin("http://localhost:3100")).toBe(true);
  });

  it("非回环与不可解析来源一律判否（不当未知放行）", () => {
    expect(isLoopbackOrigin("http://192.168.1.10:3100")).toBe(false);
    expect(isLoopbackOrigin("https://evil.com")).toBe(false);
    expect(isLoopbackOrigin("not a url")).toBe(false);
    expect(isLoopbackOrigin("")).toBe(false);
  });
});

describe("isLoopbackRequest", () => {
  it("同源（带回环 Origin）放行", () => {
    expect(
      isLoopbackRequest(
        headers({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }),
      ),
    ).toBe(true);
  });

  it("无 Origin（curl / 服务端调用）也放行 —— 它们带的是会话那道闸", () => {
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3100" }))).toBe(true);
    expect(
      isLoopbackRequest(headers({ host: "localhost:3100", origin: "" })),
    ).toBe(true);
  });

  it("Host 不是回环即拒（别的机器用本机 IP 访问）", () => {
    expect(
      isLoopbackRequest(
        headers({
          host: "192.168.1.10:3100",
          origin: "http://192.168.1.10:3100",
        }),
      ),
    ).toBe(false);
  });

  it("Host 缺失即拒（拿不到判据时判否，不判放行）", () => {
    expect(isLoopbackRequest(headers({}))).toBe(false);
  });

  it("Host 回环但 Origin 指向外部即拒（跨源脚本从别的站点打本机）", () => {
    expect(
      isLoopbackRequest(
        headers({ host: "127.0.0.1:3100", origin: "https://evil.com" }),
      ),
    ).toBe(false);
  });
});
