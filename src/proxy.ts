import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy（Next 16 的 `middleware` 新名字）：本机单用户桌面应用，不做登录墙。
 *
 * - 本应用为本地 ComfyUI 桌面壳，所有 tRPC 过程（authedProcedure）在无会话时
 *   自动回退到 demo 用户（见 src/server/api/trpc.ts），REST 路由由
 *   getServerUser() 兜底，无需登录即可使用全部界面功能。
 * - 原先这里会把 /settings、/workshop 等界面路由在缺少会话 cookie 时重定向到
 *   /login；现已移除该限制，点击左下角「设置」等入口可直接进入，无需登录。
 * - /api/* 不在此拦截：鉴权由 tRPC protected/authed 过程与服务端
 *   getServerUser() / requireServerUser() 在各自路由内处理。
 *
 * **但它现在有一件真活**：把 `/generated/**` 折进带闸门的 `/api/generated/**`
 * （台账 A13 的实际闭环），见下面 `proxy()` 里那段注释。
 *
 * 为什么文件叫 proxy 而不是 middleware：Next 16 起 `middleware` 约定名已废弃
 * （构建期固定打一条 deprecation 警告），`proxy.ts` 是它的继任约定，语义等价。
 * ⚠️ 而且**两个文件不能同时存在**：实测 Next 16.3.5 在 `next dev` 期抛
 * `Both middleware file and proxy file are detected` 的 unhandledRejection，
 * 结果是新加的那条**一个字都没生效**（静态文件照发）。加规则改这里，别再建
 * `src/middleware.ts`。
 *
 * 文件位置：必须在 `src/` 下与 `app/` 同级。放到 `app/` 里 Next 不会当成 proxy
 * 加载，只会静默失效——构建期不报错，真到要拦请求时才发现「根本没跑」。
 *
 * `sentry.edge.config.ts` 注释里写的「middleware 等 Edge 环境」即指本文件：
 * proxy 是 Edge runtime 的入口（`src/instrumentation.ts` 按 NEXT_RUNTIME 动态引入）。
 */

/** 产物前缀：`public/generated/**` 在 URL 上的公开形状。 */
const ARTIFACT_STATIC_PREFIX = "/generated";

export function proxy(req: NextRequest) {
  /* 产物读取只有一个入口。产物落在 `public/generated/` 下（`generatedRoot()`），
   * 而 `public/**` 由 Next **按静态文件直接发出**、不经过任何 route handler ——
   * 于是 `/api/generated/[...path]` 上的会话与归属判定，把 URL 里的 `api/` 去掉
   * 就整条绕过。实测（dev 与桌包 standalone 两处一致，同一份 1154930 字节的图）：
   *   GET /generated/<taskId>/img_0.png      → 200、`Cache-Control: public, max-age=0`
   *   GET /api/generated/<taskId>/img_0.png  → 200、`private, …, immutable`
   * 同一份数据、两个答案，差别就是那两个字面量。
   * 折进来之后桌包 standalone 上两种形状逐档同答案（`loginRequired` 打开、隔离库）：
   * 无会话 401 / 会话有效但任务属于别人 404 / 自己的产物 200 / 库里没有这一行 200。
   *
   * 顺序上只有这一层在「文件系统（含 public）」之前：`next.config.js` 的
   * `rewrites()` 返回扁平数组时属于 `afterFiles`，实测压不过 `public/` 里的真文件
   * （`/generated/hello.txt` 仍回静态字节）—— 那是个「看起来已经修好、实际一个字
   * 都没挡」的形态，所以这条不能用配置层改写来做。
   *
   * 这里只做 rewrite，不做鉴权：判决全在 `route.ts` 那一处（会话 + 归属 + 路径包含），
   * 在这一层再判一次就是 §12.12 说的第二份实现，而且 Edge 侧读不到 Node 侧的库。
   * 旧数据里 `/generated/...` 形状的 URL 因此继续可用（`workshop/media-source.server.ts`
   * 历史上两种形状都收），只是从这一刻起它也得过闸。 */
  if (
    req.nextUrl.pathname === ARTIFACT_STATIC_PREFIX ||
    req.nextUrl.pathname.startsWith(`${ARTIFACT_STATIC_PREFIX}/`)
  ) {
    const url = req.nextUrl.clone();
    url.pathname = `/api${req.nextUrl.pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  /* 第一条是原来那份「除内部资源与带点路径」的声明，保留它 = 保留「将来哪些路径
   * 要走代理」这个落点。第二、三条是产物前缀：注意**第一条匹配不到它们** ——
   * 它把带 `.` 的路径整个排除掉了（为了不动静态资源），而产物 URL 个个带扩展名。
   * 也就是说「proxy 里加了规则」与「规则真的跑到了」是两件事：漏掉后两条时
   * `proxy()` 里的判据一次都不会执行，而且不报错。
   * `/generated` 不带斜杠那条也要匹配：它会解析成产物根目录本身，交给 route 回 404，
   * 而不是在这里替它决定。 */
  matcher: ["/((?!_next|.*\\..*).*)", "/generated", "/generated/:path*"],
};
