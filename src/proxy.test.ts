/**
 * `src/proxy.ts` —— 产物读取的「唯一入口」这条约束的判据（台账 A13 的最后一环）。
 *
 * 为什么单独测这一层：`route.ts` 上的会话与归属判定**只对它自己能赢**，而产物落在
 * `public/generated/` 下 —— `public/**` 由 Next 按静态文件直接发出，不经过任何 route
 * handler。把 URL 里的 `api/` 去掉就整条绕过，且绕得毫无动静。本机实测（同一份
 * 1154930 字节的图，`loginRequired` 打开、无会话）：
 *
 *   · 没有这一层时：`/generated/<taskId>/img_0.png` → **200**，`/api/generated/…` → 401；
 *   · 有这一层时：两种形状都 → 401。
 *
 * 所以这个文件测的从来不是「rewrite 写对没有」，而是**这条闸有没有真的被接到请求上**：
 * 判据的形状是「同一个文件，两个 URL 必须给同一个答案」。
 *
 * ⚠️ 本层不做鉴权，也不该做：这里只把路径折进 `/api/generated/**`，判决全在
 * `route.ts` 那一处。用例因此只断言「折到哪」，不去断言「谁能读」。
 */
import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

import { config, proxy } from "./proxy";

/** Next 传进来的 `nextUrl` 是 `NextURL`（比标准 `URL` 多一个 `clone()`）；
 *  被测代码只吃 `pathname` 与 `clone()`，所以按这两样造替身，不假造整个类型。 */
function reqFor(pathnameWithQuery: string): NextRequest {
  const url = new URL(`http://127.0.0.1:3996${pathnameWithQuery}`);
  const nextUrl = Object.assign(url, { clone: () => new URL(url.href) });
  return { nextUrl } as unknown as NextRequest;
}

/** rewrite 的落点（Next 把它写在 `x-middleware-rewrite` 上）；`next()` 时为空。 */
function rewrittenTo(res: Response): string | null {
  return res.headers.get("x-middleware-rewrite");
}

describe("产物前缀折进带闸门的读取口", () => {
  it("/generated/<taskId>/<file> → 改写到 /api/generated/ 同一位置", () => {
    const res = proxy(reqFor("/generated/t1/img_0.png"));
    expect(rewrittenTo(res)).toBe(
      "http://127.0.0.1:3996/api/generated/t1/img_0.png",
    );
  });

  it("多层产物路径原样折过去（素材格与项目格都比任务格深）", () => {
    const res = proxy(reqFor("/generated/materials/proj-a/ref/secret.png"));
    expect(rewrittenTo(res)).toBe(
      "http://127.0.0.1:3996/api/generated/materials/proj-a/ref/secret.png",
    );
  });

  it("查询串保留（改写只动 pathname，不该把 ?v= 丢掉）", () => {
    const res = proxy(reqFor("/generated/t1/a.png?v=2"));
    expect(rewrittenTo(res)).toBe(
      "http://127.0.0.1:3996/api/generated/t1/a.png?v=2",
    );
  });

  it("/generated 这一段本身也折过去（它会解析成产物根，交给 route 判 404）", () => {
    const res = proxy(reqFor("/generated"));
    expect(rewrittenTo(res)).toBe("http://127.0.0.1:3996/api/generated");
  });
});

describe("不该被折的都不能折", () => {
  it("已经带闸门的那个口不二次改写（否则会变成 /api/api/generated）", () => {
    const res = proxy(reqFor("/api/generated/t1/img_0.png"));
    expect(rewrittenTo(res)).toBeNull();
  });

  it("界面路径与其它 API 原样放行", () => {
    for (const p of ["/settings", "/workshop", "/api/health", "/login"]) {
      expect(rewrittenTo(proxy(reqFor(p)))).toBeNull();
    }
  });

  it("Next 内部资源不碰", () => {
    expect(
      rewrittenTo(proxy(reqFor("/_next/static/chunks/app.js"))),
    ).toBeNull();
  });
});

/**
 * 这两条是本次修复里**唯一会静默失效**的那一档，所以单独钉。
 *
 * `matcher` 的第一条（沿用自本文件原本的那份声明）把**带点的路径整个排除**了 ——
 * 那是为了不动静态资源，但它同时把 `/generated/<taskId>/img_0.png` 排除在外，
 * 而产物 URL 个个带扩展名。实测：只删 `matcher` 里产物前缀那两条、`proxy()`
 * 里一行代码都不动，`/generated/<taskId>/img_0.png` 立刻回到 **200**（`/api/…` 仍 401）。
 * 「规则写了」与「规则跑到了」是两件事，而漏掉时的表现是零报错。
 */
describe("matcher 必须真的覆盖到产物前缀", () => {
  it("产物前缀有显式条目（不能只指望那条通配 —— 它排除带点路径）", () => {
    expect(config.matcher).toContain("/generated/:path*");
    expect(config.matcher).toContain("/generated");
  });

  it("通配那条仍在（它匹配不到产物，但它是「将来哪些路径走代理」的声明）", () => {
    expect(config.matcher.some((p) => p.startsWith("/((?!_next"))).toBe(true);
  });
});
