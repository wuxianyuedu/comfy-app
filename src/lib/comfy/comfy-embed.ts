// 「这个页面能不能被 iframe 内嵌」的判据（纯派生，无 IO / 无 React）。
//
// 背景（ISSUE #310 多次回归）：应用级页签把 ComfyUI 以内嵌 iframe 呈现，
// 而它与宿主页面**不同源**（宿主是应用自己的 http://127.0.0.1:3100，
// ComfyUI 是 http://127.0.0.1:<comfyuiPort>，端口不同即跨源）。
//
// **真正的拦路虎不是 `X-Frame-Options`**（此前记错的成因）：ComfyUI 在没有
// 开 CORS 时挂的是 `create_origin_only_middleware()`，它对跨源请求——
// `Sec-Fetch-Site: cross-site`，或回环地址下 `Host` 域名 ≠ `Origin` 域名
// ——直接返回 **HTTP 403**（反 CSRF：防随机网页 POST 127.0.0.1 排队）。
// iframe 内嵌正是跨源请求，于是页签打开了、地址也对，里面**一片空白**
// （403 响应体为空，被 WebView2 渲染成白页）。
//
// 好消息：这个开关握在**我们自己手里** —— ComfyUI 是本应用 spawn 的，
// 启动参数带上 `--enable-cors-header` 就会改挂 `create_cors_middleware()`，
// 跨源不再 403 并回 `Access-Control-Allow-Origin`（见 `lifecycle-derive.ts`
// 的 `withEmbedClearanceFlag`）。所以本模块的定位是**兜底 + 诊断**：
// 正常情况下 ComfyUI 已放行、这里判「可嵌」；只有用户手填的额外参数覆盖、
// 或实例是外部启动（不受本应用参数控制）时才会判不可嵌。
//
// 本模块把「能不能嵌」变成可测的判决：
//   - `judgeEmbeddable`：看探测到的**事实**（可嵌的明确证据：同源、
//     `Access-Control-Allow-Origin`、CSP `frame-ancestors` 命中宿主、
//     或无任何拒绝性 `X-Frame-Options`）；拿不到结论时**按不可嵌处理**，
//     并把「该开什么开关」写进 reason，而不是把空白页摆给用户。
//   - `decideComfyTabOpen(embed)`：由「可嵌性」推出去哪打开。

import { errorText } from "~/lib/error-message";
import { isHttpUrl } from "~/lib/url-scheme";

/** 探测结果：对端是否允许被 `hostOrigin` 内嵌。 */
export type EmbedVerdict = {
  /** 能否安全地放进 iframe。 */
  embeddable: boolean;
  /** 不可嵌的原因（可读、可直接展示给用户 / 落日志）。 */
  reason: string;
};

/** 跨源探测拿不到明确结论时的兜底：按不可嵌处理（退到确定可用的方式）。 */
const UNVERIFIED: EmbedVerdict = {
  embeddable: false,
  reason:
    "未探测到 ComfyUI 放行跨源内嵌（缺 Access-Control-Allow-Origin，且无 X-Frame-Options/CSP 明确放行）" +
    "——ComfyUI 需以 --enable-cors-header 启动（本应用拉起时会自动带上）；" +
    "若浏览器里手动打开同一地址正常，说明拦下内嵌的是应用外壳（WebView2 的跨源 frame 策略），" +
    "需用带 WebView2 放行参数的壳启动（见 docs/standards/12-代码组织与文件结构.md §12.8.4）",
};

/** `X-Frame-Options` 的取值语义：只有 DENY / SAMEORIGIN 是拒绝。 */
export function parseXFrameOptions(
  value: string | null,
): "deny" | "sameorigin" | "allow" {
  const token = (value ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (token.startsWith("deny")) return "deny";
  if (token.startsWith("sameorigin")) return "sameorigin";
  return "allow";
}

/**
 * `frame-ancestors` 源列表是否放行 `hostOrigin`。
 *
 * 只认三档：通配 `*`、显式列出宿主源、以及列表缺失（交给 XFO 判）。
 * 不做通配符子域/端口展开 —— 探测这一层宁可判「没放行」（回退独立窗口），
 * 也不要猜出一个错的允许。
 */
export function frameAncestorsAllows(
  csp: string | null,
  hostOrigin: string,
): boolean | null {
  if (!csp) return null;
  const directive = /frame-ancestors([^;]*)/i.exec(csp);
  if (!directive) return null;
  const sources = directive[1]!.trim().split(/\s+/).filter(Boolean);
  if (sources.length === 0) return null;
  if (sources.includes("*")) return true;
  const normalized = hostOrigin.replace(/\/$/, "").toLowerCase();
  return sources.some((s) => s.replace(/\/$/, "").toLowerCase() === normalized);
}

/** 两个 `http(s)://host:port` 地址是否同源（协议 + 主机 + 端口全等）。 */
export function isSameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.protocol === ub.protocol &&
      ua.hostname === ub.hostname &&
      ua.port === ub.port
    );
  } catch {
    return false;
  }
}

/** 地址是否为 http(s) 源（`about:blank` / `file:` / `tauri://` 一律不算）。
 *  判据本身在 `~/lib/url-scheme`（§12.12：同一句话不许有两份实现）——
 *  这里保留 `isHttpOrigin` 这个名字只为调用点读得顺（它手里的是 origin）。 */
export function isHttpOrigin(origin: string): boolean {
  return isHttpUrl(origin);
}

/**
 * 由响应头判「`base` 能不能被 `hostOrigin` 内嵌」。
 *
 * 判读顺序（每一档都对应一次真实事故，不要凭直觉调换）：
 *   0. 任一侧**不是 http(s)**（`about:blank` / `file:` / `tauri://`）→ 判不出：
 *      拿不到事实就不能报「可嵌」，否则页面会把用户丢进一个被拒绝的 iframe。
 *   1. 同源 → 必然可嵌（浏览器不做 XFO / frame-ancestors 校验）。
 *   2. 403 → ComfyUI 的 origin-only 中间件拦下了跨源（反 CSRF）。
 *   3. `Access-Control-Allow-Origin` 有值 → 跨源放行的确证。
 *   4. CSP `frame-ancestors` 明确放行 / 明确拒绝。
 *   5. `X-Frame-Options: DENY|SAMEORIGIN` → 拒绝。
 *   6. `frame-ancestors: *` → 放行（有的服务器只发通配，不发 CORS 头；
 *      判据要认它，否则会把「明确放行」误判成「没证据」）。
 *   7. 都没有 → 判不出：按不可嵌处理，并把「真正的原因很可能是被请求方
 *      自己拦下」写进 reason。
 */
export function judgeEmbeddable(input: {
  base: string;
  hostOrigin: string;
  xFrameOptions: string | null;
  contentSecurityPolicy: string | null;
  /** 探测响应的 HTTP 状态码：403 即 ComfyUI 的 origin-only 中间件拦下了跨源。 */
  status?: number;
  /** 探测响应的 `Access-Control-Allow-Origin`：有值即说明 CORS 已放行。 */
  allowOrigin?: string | null;
}): EmbedVerdict {
  /* 非 http(s) 的地址（壳里宿主页是 `about:blank`，见 lib.rs 的 main 窗初始
   * URL）既不是同源、也探不出跨源放行与否。**必须先于 isSameOrigin 处理**：
   * `URL` 对这两个「非特殊 scheme」会解析出两个空端口（都等于 0），
   * 同源比较会脱掉 scheme 直接判成「协议/主机/端口全等」→ 把
   * `about:blank` 与 `http://localhost:8080` 判成同源，进而报「可嵌」，
   * 页面于是无条件塞 iframe（ISSUE #310 的空白/被拒页签现场）。 */
  if (!isHttpOrigin(input.base) || !isHttpOrigin(input.hostOrigin)) {
    return { ...UNVERIFIED };
  }
  if (isSameOrigin(input.base, input.hostOrigin)) {
    return { embeddable: true, reason: "同源，浏览器不做内嵌校验" };
  }
  /* 403 是「跨源被 origin-only 中间件拦下」的确证（ISSUE #310 空白页签的现场）：
   * 直接给出可行动的成因，不去猜 XFO / CSP。 */
  if (input.status === 403) {
    return {
      embeddable: false,
      reason:
        "ComfyUI 对跨源请求返回 403（未开启 CORS 的 origin-only 中间件拦截）" +
        "——需以 --enable-cors-header 启动（本应用拉起时会自动带上；外部实例需自行加该参数）",
    };
  }
  /* 有 `Access-Control-Allow-Origin` 即 ComfyUI 已开 CORS：跨源放行的确证，
   * 优先于「头读不到」的判断。 */
  if (input.allowOrigin) {
    return {
      embeddable: true,
      reason: "ComfyUI 已开启 CORS（响应带 Access-Control-Allow-Origin）",
    };
  }
  const ancestors = frameAncestorsAllows(
    input.contentSecurityPolicy,
    input.hostOrigin,
  );
  if (ancestors === true) {
    return {
      embeddable: true,
      reason: "ComfyUI 的 CSP 已放行本应用作为内嵌方",
    };
  }
  if (ancestors === false) {
    return {
      embeddable: false,
      reason: "ComfyUI 的 CSP frame-ancestors 未放行本应用",
    };
  }
  const xfo = parseXFrameOptions(input.xFrameOptions);
  if (xfo === "deny" || xfo === "sameorigin") {
    return {
      embeddable: false,
      reason: `ComfyUI 返回 X-Frame-Options: ${input.xFrameOptions?.trim() ?? xfo}`,
    };
  }
  // 两个头都读不到：拿不到「放行」的明确证据，按不可嵌处理（不赌）。
  return { ...UNVERIFIED };
}

/** ComfyUI 页签该在哪里打开。 */
export type ComfyTabTarget = "embed" | "blocked";

/**
 * 打开 ComfyUI 的目标判决。
 *
 * **只有两档，且都留在应用内**（ISSUE #310 用户明确要求：「不要打开另一个
 * 窗口，我只要多页签的形式」）：
 *   - 可嵌 → 直接内嵌进页签；
 *   - 不可嵌 → 同样把页签打开，但里面渲染一张**应用内的可见说明**（给出
 *     成因与修复动作），而不是弹第二个窗口、也不是把浏览器的空白错误页
 *     摆给用户。
 *
 * 为什么删掉了「壳内独立窗口」这一档：那是绕开 ComfyUI 跨源 403 的兜底，
 * 而那个开关其实握在我们手里（启动时带 `--enable-cors-header`，见
 * `lifecycle-derive.ts` 的 `withEmbedClearanceFlag`）。绕道的代价是用户
 * 每点一次都多出一个窗口，体验与「像文件管理器那样多页签」的目标相悖。
 * 保留的 `blocked` 档只用于「外部实例不受本应用参数控制」这类边缘情形，
 * 且**仍在同一个窗口里**给出可读的下一步。
 *
 * 注：早先还有 `browser`（系统浏览器）一档。它作为**这条决策路径的自动回落**
 * 已被删除（「点打开查看就跳浏览器」同样把用户从多页签形态里踢出去），但
 * 「在浏览器打开」作为用户**主动点击**的并列出口保留在设置页
 * （`setting.comfyOpen`，见 `docs/standards/12-代码组织与文件结构.md` §12.8.3）。
 *
 * @param embeddable 探测结论：能否内嵌
 */
export function decideComfyTabOpen(embeddable: boolean): ComfyTabTarget {
  return embeddable ? "embed" : "blocked";
}

/**
 * 浏览器 / dev 形态下，「打开查看」是否该走**新浏览器页签**（而不是应用内页签）。
 *
 * 为什么浏览器里不内嵌进应用页签：应用内页签栏（`ShellTabs` 此前在浏览器形态
 * 画的兜底条）本质是「没有原生标题栏可让位」时的产物。但浏览器**自带页签栏**——再在应用
 * 里画一条假页签栏，既占纵向空间、又和浏览器原生页签重复。所以浏览器形态下
 * ComfyUI 直接交给新浏览器页签，应用内不再长出第二页签。
 *
 * 这与 ISSUE #310「点打开查看只出多页签、不弹第二个窗口」不冲突：#310 约束的是
 * **桌面壳**里不要弹独立窗口；浏览器里「新浏览器页签」正是该环境的原生多页签形态，
 * 不是「弹第二个窗口」。
 *
 * ⚠️ 调用约束：`window.open` 必须在**任何 await 之前**同步调用，否则脱离用户手势
 * 被浏览器弹窗拦截器拦下。所以本判据要在「打开查看」处理函数的最顶部、refetch
 * 之前消费（浏览器分支用状态轮询已缓存的 base 同步开窗）。
 */
export function shouldUseBrowserTab(isDesktop: boolean): boolean {
  return !isDesktop;
}

/* ── 探测（IO 薄层）────────────────────────────────────────────────
 * 判据在上面，这里只负责「取事实」：向 base 发一次 GET（**带 `Origin`**，
 * 模拟 iframe 的跨源请求），读回状态码与 Access-Control-Allow-Origin /
 * X-Frame-Options / Content-Security-Policy。
 *
 * 必须带 `Origin`：ComfyUI 的 origin-only 中间件只在「Origin 存在且与
 * Host 不同域」时才 403，裸探测（无 Origin）会拿到 200，从而误判成「可嵌」
 * —— 这正是上一轮把成因记成「X-Frame-Options DENY」的观测盲区。
 * 取不到事实一律按不可嵌处理，并把可行动的成因写进 reason。
 */

/** 探测用的超时：ComfyUI 在环回地址上应答是毫秒级，1.5s 足够。 */
export const EMBED_PROBE_TIMEOUT_MS = 1_500;

/**
 * 探一次 `base` 是否可以由 `hostOrigin` 内嵌。
 *
 * `hostOrigin` 传的是应用自身的源（壳内即 ComfyUI 页签宿主页的 origin），
 * 浏览器里传 `window.location.origin`。
 */
export async function probeComfyEmbeddable(
  base: string,
  hostOrigin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EmbedVerdict> {
  /* 非 http(s)（壳里宿主页的 origin 就是 "null" / `about:blank`）既不是同源、
   * 也没什么可探的：**先判掉，绝不在缺少事实时报「可嵌」**——否则页面会无条件
   * 塞 iframe，把用户丢进一个我们解释不了的空白页签。 */
  if (!isHttpOrigin(base) || !isHttpOrigin(hostOrigin)) {
    return { ...UNVERIFIED };
  }
  if (isSameOrigin(base, hostOrigin)) {
    return { embeddable: true, reason: "同源，浏览器不做内嵌校验" };
  }
  let res: Response;
  try {
    res = await fetchImpl(base, {
      method: "GET",
      redirect: "follow",
      // 带上 Origin 才是「iframe 视角」的真实探测（见本段开头说明）。
      headers: { Origin: hostOrigin },
      signal: AbortSignal.timeout(EMBED_PROBE_TIMEOUT_MS),
    });
  } catch (e) {
    return {
      embeddable: false,
      reason: errorText(e, "无法探测 ComfyUI 的内嵌策略"),
    };
  }
  return judgeEmbeddable({
    base,
    hostOrigin,
    xFrameOptions: res.headers.get("x-frame-options"),
    contentSecurityPolicy: res.headers.get("content-security-policy"),
    status: res.status,
    allowOrigin: res.headers.get("access-control-allow-origin"),
  });
}
