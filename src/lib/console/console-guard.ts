// ── 应用内控制台的**回环闸门**（纯函数：只看请求头，不看框架、不碰 IO）───────
//
// 控制台能执行任意本机命令，所以第一道闸是「这个请求是不是从本机来的」。
// 判据本身很小，但**它必须只有一处实现**：判反方向（把 `::ffff:127.0.0.1`
// 判成非回环）的后果是「本机用不了」，而判宽的后果是「局域网能执行任意命令」
// ——两个方向都不可接受，所以列的形态要在同一处一次列全。
//
// ## 为什么用请求头而不是 `request.socket.remoteAddress`
//
// Next 的 Route Handler 拿不到原始 socket 上的对端地址（`NextRequest` 没有这个
// 字段，硬取要走 `(req as any)` 下的内部对象 —— 那会在 Next 升级时静默变成
// `undefined`，而 `undefined` 在「是不是回环」这个判据里**必须**判否，于是判据
// 无声地全拒或全放）。可用的、有稳定契约的是这两个头：
//   · `Host`：浏览器发给本服务的域名/IP（可能是 `localhost:3100`）；
//   · `Origin`：跨源请求的来源（无 Origin = 同源导航或非浏览器客户端）。
//
// ## 已知边界（写清楚，别当成漏洞来"修"）
//
// 反代场景下 `Host` 由反代改写、`X-Forwarded-For` 由反代注入，**都能被伪造成
// 回环**。所以这道闸的语义是「挡住从别的机器直接用 IP 访问本服务」，**不是**
// 「在已成反代的后端上仍然安全」。那需要反代层自己配鉴权 —— 本应用的分发形态
// 是「桌面壳 + 本机 server」，不预置反代，这条边界是刻意的取舍而不是遗漏。
// 真正的第二道闸（会话）与第三道（入参形态）在路由里，三者叠加才是边界。

/** 判定一个 host 串（可能带端口）是不是回环地址。 */
export function isLoopbackHost(value: string | null | undefined): boolean {
  if (!value) return false;
  const raw = value.trim().toLowerCase();
  if (!raw) return false;
  /* 逐条列全，不用「包含 127.」这种近似 —— `127.evil.com` 也会命中。 */
  const host = stripPort(raw);
  if (host === "localhost" || host === "127.0.0.1" || host === "::1")
    return true;
  if (host === "[::1]") return true;
  /* IPv6 映射的 IPv4 回环：`::ffff:127.0.0.1`（Node 在双栈监听下常见的形态）。 */
  if (
    host.startsWith("::ffff:") &&
    host.slice("::ffff:".length) === "127.0.0.1"
  ) {
    return true;
  }
  /* 整个 127.0.0.0/8 都是回环（不是只有 .0.1）。 */
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4?.[1] === "127") return true;
  return false;
}

/** 剥掉 host 串的端口部分（IPv6 的 `[::1]:3100` 与 IPv4 的 `127.0.0.1:3100` 两种形态）。 */
function stripPort(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 0 ? host.slice(0, end + 1) : host;
  }
  const colon = host.lastIndexOf(":");
  /* 多于一个冒号且不以 `[` 开头 —— 是未括起来的 IPv6 字面量，不能按端口切
   * （`::1` 会被切成 `:`，于是本机请求被判成非回环）。 */
  if (colon > 0 && host.indexOf(":") === colon) return host.slice(0, colon);
  return host;
}

/** 该请求是否来自本机（`Host` 与 `Origin` 两侧都必须是回环）。 */
export interface LoopbackHeadersLike {
  get(name: string): string | null;
}

/**
 * 判一条请求是不是从本机发起的。
 *
 * 两条**都**要满足，缺一判否：
 *   · `Origin` 存在（浏览器发起的跨源/同源 fetch 都会带）时它必须是回环；
 *     `Origin` 不存在（curl、同源导航、服务端调用）时略过这一条 —— 因为
 *     非浏览器客户端本来就不会带它，拿「缺 Origin」当拒绝理由会把 curl 与
 *     `fetch` 之外的正当调用一起挡掉，而它们带着合法会话（第二道闸）。
 *   · `Host` 必须是回环：这一条挡的是「别的机器用本机 IP 访问」——
 *     那种请求的 `Host` 是 `192.168.x.x:3100`，不是回环。
 */
export function isLoopbackRequest(headers: LoopbackHeadersLike): boolean {
  if (!isLoopbackHost(headers.get("host"))) return false;
  const origin = headers.get("origin");
  if (origin === null || origin.trim() === "") return true;
  return isLoopbackOrigin(origin);
}

/** `Origin` 串（`http://127.0.0.1:3100`）的 host 部分是不是回环。 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).host);
  } catch {
    /* 解析不了就不是一个合法来源 —— 判否（而不是「当作未知放行」）。 */
    return false;
  }
}
