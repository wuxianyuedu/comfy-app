import { describe, expect, it } from "vitest";

import { rejectCrossOriginWrite } from "./same-origin";

/* 「只有闸会读的两件事实」的最小请求（路由里传的 NextRequest 是它的超集）。
 * Host 头用裸 Headers 造：undici 的 Request 构造器不透出 Host（发送时才由
 * 连接层计算），而判据 #4824 起正是要看 Host —— `request.url` 的 host 会被
 * Next 改写成与请求无关的内部值（dev 下 `127.0.0.1:<port>` 的请求，其
 * request.url 的 origin 是 `localhost:<port>`），挂在它上面壳的同源写请求
 * 就被自家闸 403（启动水合的尺寸表保存是第一个触发的现场）。 */
function req(url: string, headers: Record<string, string>): Pick<Request, "headers" | "url"> {
  return { headers: new Headers(headers), url };
}

describe("rejectCrossOriginWrite（#4723 写端点同源闸）", () => {
  it("缺 Origin（本机工具 / curl）放行", () => {
    expect(
      rejectCrossOriginWrite(
        req("http://127.0.0.1:3100/api/materials", { host: "127.0.0.1:3100" }),
      ),
    ).toBeNull();
  });

  it("本机界面同源 Origin 放行 —— 壳页面源 127.0.0.1，即便 request.url 的 host 被 Next 改写成 localhost（ISSUE #4824 回归主形状）", () => {
    expect(
      rejectCrossOriginWrite(
        req("http://localhost:3100/api/materials", {
          host: "127.0.0.1:3100",
          origin: "http://127.0.0.1:3100",
        }),
      ),
    ).toBeNull();
  });

  it("浏览器同源（页面源与 Host 一致）放行", () => {
    expect(
      rejectCrossOriginWrite(
        req("http://localhost:3100/api/materials", {
          host: "localhost:3100",
          origin: "http://localhost:3100",
        }),
      ),
    ).toBeNull();
  });

  it("启动页那一族 Origin（tauri 壳，分平台三种都在白名单）放行", () => {
    for (const origin of [
      "http://tauri.localhost",
      "https://tauri.localhost",
      "tauri://localhost",
    ]) {
      expect(
        rejectCrossOriginWrite(
          req("http://127.0.0.1:3100/api/materials", { host: "127.0.0.1:3100", origin }),
        ),
      ).toBeNull();
    }
  });

  it("跨站 Origin → 403（响应不可读也要挡住写副作用）", () => {
    const res = rejectCrossOriginWrite(
      req("http://127.0.0.1:3100/api/materials", {
        host: "127.0.0.1:3100",
        origin: "https://evil.example",
      }),
    );
    expect(res?.status).toBe(403);
  });

  it("带查询串的 DELETE 同样按 Origin 判（简单请求不经 preflight）", () => {
    const res = rejectCrossOriginWrite(
      req("http://127.0.0.1:3100/api/materials?id=scope/folder/name", {
        host: "127.0.0.1:3100",
        origin: "https://evil.example",
      }),
    );
    expect(res?.status).toBe(403);
  });

  it('Origin 为字符串 "null"（沙箱 / file:// / 跨源重定向）拒绝：不是 JS null，不吃「缺 Origin 放行」那一档', () => {
    const res = rejectCrossOriginWrite(
      req("http://127.0.0.1:3100/api/materials", { host: "127.0.0.1:3100", origin: "null" }),
    );
    expect(res?.status).toBe(403);
  });

  it("带 Origin 但缺 Host：无从对齐，默认拒绝", () => {
    const res = rejectCrossOriginWrite(
      req("http://127.0.0.1:3100/api/materials", { origin: "http://127.0.0.1:3100" }),
    );
    expect(res?.status).toBe(403);
  });
});
