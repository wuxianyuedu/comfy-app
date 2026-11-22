// 同源闸的判据单测（ISSUE #4824）：「本机同源」看 Host 头而不是 `request.url` ——
// Next 会把 request.url 的 host 改写成内部值（dev 下 `127.0.0.1:<port>` 的请求，
// request.url 的 origin 是 `localhost:<port>`），判据挂在它上面，壳的同源写请求
// 就被自家闸 403。形状全集：壳同源 / 浏览器同源 / 跨站 / splash 名单 /
// Origin:"null" 字符串 / 缺 Origin / 带 Origin 但缺 Host。
import { describe, expect, it } from "vitest";

import { rejectCrossOriginWrite } from "~/server/lib/same-origin";

/** 造一个「只有闸会读的两件事实」的最小请求（路由里传的 NextRequest 是它的超集）。 */
function req(url: string, headers: Record<string, string>): Pick<Request, "headers" | "url"> {
  return { headers: new Headers(headers), url };
}

describe("rejectCrossOriginWrite（写端点同源闸，ISSUE #4824）", () => {
  it("壳同源：页面源 127.0.0.1、Origin 同值 —— 即使 request.url 的 host 被改写成 localhost 也放行（回归主形状）", () => {
    const own = req("http://localhost:3797/api/size-presets", {
      host: "127.0.0.1:3797",
      origin: "http://127.0.0.1:3797",
    });
    expect(rejectCrossOriginWrite(own)).toBeNull();
  });

  it("浏览器同源（localhost 页面）放行", () => {
    const own = req("http://localhost:3797/api/size-presets", {
      host: "localhost:3797",
      origin: "http://localhost:3797",
    });
    expect(rejectCrossOriginWrite(own)).toBeNull();
  });

  it("跨站 Origin 拒 403（攻击者的源不可能等于本机 Host）", () => {
    const cross = req("http://127.0.0.1:3797/api/size-presets", {
      host: "127.0.0.1:3797",
      origin: "https://evil.example",
    });
    expect(rejectCrossOriginWrite(cross)?.status).toBe(403);
  });

  it("启动页那一族放行（与 /api/health 的 CORS 白名单同一份事实源）", () => {
    const splash = req("http://127.0.0.1:3797/api/health", {
      host: "127.0.0.1:3797",
      origin: "http://tauri.localhost",
    });
    expect(rejectCrossOriginWrite(splash)).toBeNull();
  });

  it('Origin 为字符串 "null"（沙箱 / file:// / 跨源重定向）拒绝：不是 JS null，不吃「缺 Origin 放行」那一档', () => {
    const nulled = req("http://127.0.0.1:3797/api/size-presets", {
      host: "127.0.0.1:3797",
      origin: "null",
    });
    expect(rejectCrossOriginWrite(nulled)?.status).toBe(403);
  });

  it("缺 Origin（本机工具 / curl）放行", () => {
    const bare = req("http://127.0.0.1:3797/api/size-presets", { host: "127.0.0.1:3797" });
    expect(rejectCrossOriginWrite(bare)).toBeNull();
  });

  it("带 Origin 但缺 Host 是病态形状：无从对齐，默认拒绝", () => {
    const noHost = req("http://127.0.0.1:3797/api/size-presets", {
      origin: "http://127.0.0.1:3797",
    });
    expect(rejectCrossOriginWrite(noHost)?.status).toBe(403);
  });
});
