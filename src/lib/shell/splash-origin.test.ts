import { describe, expect, it } from "vitest";

import { SPLASH_ORIGINS, corsHeadersFor, isSplashOrigin } from "./splash-origin";

describe("isSplashOrigin / corsHeadersFor（/api/health 的跨域白名单）", () => {
  it("三个壳内源都算启动页（分平台，不分叉）", () => {
    for (const origin of SPLASH_ORIGINS) {
      expect(isSplashOrigin(origin), origin).toBe(true);
    }
  });

  it("清单恰好是那三个（增删都要同批想清「谁在读这个端点」）", () => {
    expect([...SPLASH_ORIGINS].sort()).toEqual([
      "http://tauri.localhost",
      "https://tauri.localhost",
      "tauri://localhost",
    ]);
  });

  it("别的源一律不放行（含缺头与字面 null）", () => {
    /* `null` 这个源是浏览器在 file:// / 沙箱 iframe / 跨源重定向里真的会发出来的
     * 值 —— 它**不是**「没有源」，别把它当成缺头一起放行。 */
    for (const origin of [
      "https://evil.example",
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "null",
      null,
      "",
    ]) {
      expect(isSplashOrigin(origin), String(origin)).toBe(false);
      expect(corsHeadersFor(origin)).toEqual({});
    }
  });

  it("**收紧的是「不给」，不是「给一个别的值」**", () => {
    /* 回一个固定的别的源（或 `*`）与回原来的 `*` 是同一件事 —— 浏览器只认
     * 「有没有放行我」，不看这个值是不是「看起来更严格」。 */
    const headers = corsHeadersFor("https://evil.example");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["*"]).toBeUndefined();
  });

  it("放行时回显请求的源，并带 Vary: Origin", () => {
    for (const origin of SPLASH_ORIGINS) {
      expect(corsHeadersFor(origin)).toEqual({
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
      });
    }
  });

  it("白名单是**逐字**比较，不做前缀 / 后缀宽容", () => {
    /* 前缀匹配会把 `https://tauri.localhost.evil.example` 一起放行 —— 那是这类
     * 白名单最经典的失效形态，而它看起来完全正常。 */
    for (const near of [
      "tauri://localhost.evil.example",
      "http://tauri.localhost.evil.example",
      "https://evil.example/?u=https://tauri.localhost",
      "tauri://LOCALHOST",
    ]) {
      expect(isSplashOrigin(near), near).toBe(false);
    }
  });
});
