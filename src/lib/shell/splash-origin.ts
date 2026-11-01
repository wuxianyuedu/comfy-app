/* ── 启动页（splash）在壳里的**源**：`/api/health` 跨域放行的白名单 ────────
 *
 * 启动页要读 `/api/health` 的**真实状态码**才能判就绪：`mode: "no-cors"` 的响应是
 * opaque、读不到状态码（「端口一应答就算就绪」正是历史过早导航的根因），所以只能走
 * `mode: "cors"`。而启动页与应用服务**不同源**，同源策略因此要求端点回一个
 * `Access-Control-Allow-Origin`。
 *
 * ## 为什么不能继续 `*`
 *
 * 端点此前回的是 `*`（任意源只读）。而它的 503 响应体里带着运维提示，提示里写着
 * **本仓库的内部文档路径** —— 那是给维护者看的，不该经一个对任意源开放的头出到
 * 任何网页。收窄成「启动页那几个源」之后，这条泄漏面自然消失，而启动页照常工作。
 *
 * ## 这个源到底是什么
 *
 * 由**资源协议**决定，且分平台（规范 launch-and-build §「窗口黑屏」那一行是同一
 * 回事的另一种表现）：
 *   · Windows（WebView2）：`http://tauri.localhost` 与 `https://tauri.localhost`；
 *   · macOS / Linux：`tauri://localhost`。
 *
 * 三个都列上（而不是按平台分叉）：壳是**同一次构建跨平台分发**的产物，
 * 而这个模块跑在**应用服务**那一侧 —— 它不知道（也不该知道）此刻是哪个平台的壳在
 * 问它。多列一个的来源只是「另一个平台上的启动页」，不是任意源。
 *
 * ## 与 §18.4 的关系
 *
 * 纯判据：没有 Node 内建、没有 server-only。应用服务的路由与用例共用同一份清单，
 * 各写一遍必然漂 —— 漂开的表现是**启动页卡在 0%**（预检通过、CORS 被拒），
 * 而服务端一切正常。
 */

/** 壳里启动页可能出现的源（见文件头注：分平台，不分叉）。 */
export const SPLASH_ORIGINS: ReadonlyArray<string> = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

/**
 * 请求的 `Origin` 是不是启动页那一族；不是（含缺头、`null`、别的网站）回 false。
 *
 * **不匹配就一个 CORS 头都不回**（而不是回一个别的值）：浏览器于是按同源策略拒绝，
 * 这正是我们要的结果 —— 恶意网页读不到响应体，而启动页在白名单里照常读得到。
 *
 * 写成**类型谓词**（而不是 `boolean`）是为了让调用点少一次断言：断言形态是
 * 「同一件事用两次」（判过一遍，再告诉类型系统「我判过了」），而两次之间任何改动
 * 都可能让它们分叉 —— 收在本仓库的门禁 `check-non-null-assertions.cjs` 里。
 */
export function isSplashOrigin(origin: string | null): origin is string {
  if (!origin) {
    return false;
  }
  return SPLASH_ORIGINS.includes(origin);
}

/**
 * 由请求头算出该回给它的 CORS 头。
 *
 * 回**回显那个源**而不是回一个通配/固定值：白名单已经保证了「回的只可能是白名单里
 * 的源」，而回显让「多来源白名单」这件事天然正确 —— 不必再维护「哪个源该配哪个头」
 * 的第二张表（那张表迟早与 {@link SPLASH_ORIGINS} 漂开）。
 *
 * 不给 `Vary` 的后果要说清：响应被 CDN / 代理缓存后，**第一个**访问者拿到的头会被
 * 复用给所有源 —— 白名单里的启动页可能因此拿到「没给它」的头而判不就绪，或者反过来
 * 拿到别的源的头。本端点是 `force-dynamic`（不缓存），但那是应用层的声明；`Vary`
 * 是给链路上每一个中间层的机器判据。两个都给，缺一个都是静默失效。
 */
export function corsHeadersFor(origin: string | null): Record<string, string> {
  /* 类型谓词在这里收窄：`origin` 过了这一关就必然是 `string`，调用点因此不需要
   * 再断言一次（那种写法就是「同一件事用两次」）。 */
  if (!isSplashOrigin(origin)) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}
