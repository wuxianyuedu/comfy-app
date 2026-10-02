/**
 * `src/proxy.ts` —— 产物读取「只有一个入口」这条约束的判据（台账 A13）。
 *
 * 这一层的**职责已经变了**，说清以免后来人按旧理由理解它：
 * 产物根以前在 `public/generated/`，而 `public/**` 由 Next 按静态文件直接发出、
 * 不经过任何 route handler —— 把 URL 里的 `api/` 去掉就整条绕过，实测过：
 * `loginRequired` 开着、无会话时同一份图 `/generated/<tid>/img_0.png` → **200**，
 * 而 `/api/generated/…` → 401。那时这条 rewrite 是安全上的必须。
 *
 * 现在根搬到了 `generated/`（`generatedRoot()`），静态通道不存在 ⇒
 * 这一层降级成**兼容层**：库里老行存的正是那种不带 `api/` 的形状，折进
 * `/api/generated/**` 之后它们仍然答得出，且与别的形状过同一道闸。
 * 漏掉 `matcher` 条目时的表现也随之从「绕过闸门拿到原图」变成「这条路 404」——
 * fail 的方向从泄漏变成读不到，这正是「先结构性关掉旁路、才允许这层只做兼容」的意思。
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
 * `matcher` 的第一条（沿用自本文件原本的那份声明）把**带点的路径整个排除**了 ——
 * 那是为了不动静态资源，但它同时把 `/generated/<taskId>/img_0.png` 排除在外，
 * 而产物 URL 个个带扩展名。所以「proxy 里加了规则」与「规则真的跑到了」是两件事：
 * 漏掉产物前缀那两条时 `proxy()` 里的判据一次都不会执行，而且不报错。
 *
 * 与根搬迁之前不同的只有一点（别按旧文案理解这条红）：当年漏掉的表现是
 * 「静态口把原图 200 发出去」（实测过，删两条、`proxy()` 一行不动），
 * 现在根不在 `public/` 下了，漏掉的表现是「老形状的 URL 404」——
 * 仍然是**必须钉住的缺陷**（历史产物读不到），只是不再是泄漏。
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
