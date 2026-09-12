// 「这个页面能不能被 iframe 内嵌」的判据（纯派生，无 IO / 无 React）。
//
// 背景（ISSUE #310 三次回归）：应用级页签把 ComfyUI 以内嵌 iframe 呈现，
// 但 ComfyUI 自身会对响应加 `X-Frame-Options: DENY`（反 CSRF 的默认姿态），
// 且它与被内嵌的宿主页面**不同源**（宿主是应用自己的 http://127.0.0.1:3100，
// ComfyUI 是 http://127.0.0.1:<comfyuiPort>，端口不同即跨源）。
// 跨源 + DENY 的唯一结果就是 WebView2/Chromium 拒绝渲染，页签里留下一张
// 「已阻止此内容。请与网站所有者联系以解决此问题。」的错误页 ——
// 页签打开了、地址也对，但什么也看不见。
//
// 这一条此前没有任何判据：`ShellTabs` 无条件渲染 iframe，`tauri.conf.json`
// 的 CSP `frame-src` 也只管「允不允许加载」，管不到对端自己发的拒绝头。
// 于是断言只存在于人的脑子里，回归过一次，还会再来。
//
// 本模块把「能不能嵌」变成可测的判决：
//   - `isEmbeddableByHost(base, hostOrigin)`：同源必然可嵌；跨源必须探到
//     ComfyUI **显式**放行（CSP `frame-ancestors` 命中宿主，或没有任何
//     拒绝性 `X-Frame-Options`）—— 探测不到结论时按「不可嵌」处理，
//     因为不可嵌的兜底（壳内独立窗口）总是可用，而赌它能嵌会把错误页
//     摆在用户面前。
//   - `decideComfyTabOpen(embed)`：由「可嵌性」推出去哪打开（内嵌页签 /
//     壳内独立窗口 / 系统浏览器）。

/** 探测结果：对端是否允许被 `hostOrigin` 内嵌。 */
export type EmbedVerdict = {
  /** 能否安全地放进 iframe。 */
  embeddable: boolean;
  /** 不可嵌的原因（可读、可直接展示给用户 / 落日志）。 */
  reason: string;
};

/** 跨源探测拿不到明确结论时的兜底：按不可嵌处理（走壳内独立窗口）。 */
const UNVERIFIED: EmbedVerdict = {
  embeddable: false,
  reason: "未探测到 ComfyUI 放行内嵌（跨源 + X-Frame-Options/CSP 未明确允许）",
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

/**
 * 由响应头判「`base` 能不能被 `hostOrigin` 内嵌」。
 *
 * 同源：浏览器不做 XFO / frame-ancestors 校验，必然可嵌。
 * 跨源：`frame-ancestors` 优先（它明确放行时按放行，明确不放行时按拒绝），
 * 没有该指令时看 `X-Frame-Options`；两个头都没有则按不可信处理。
 */
export function judgeEmbeddable(input: {
  base: string;
  hostOrigin: string;
  xFrameOptions: string | null;
  contentSecurityPolicy: string | null;
}): EmbedVerdict {
  if (isSameOrigin(input.base, input.hostOrigin)) {
    return { embeddable: true, reason: "同源，浏览器不做内嵌校验" };
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
  if (xfo === "allow") return { ...UNVERIFIED };
  return {
    embeddable: false,
    reason: `ComfyUI 返回 X-Frame-Options: ${input.xFrameOptions?.trim() ?? xfo}`,
  };
}

/** ComfyUI 页签该在哪里打开。 */
export type ComfyTabTarget = "embed" | "shell-window" | "browser";

/**
 * 打开 ComfyUI 的目标判决。
 *
 * @param embeddable  探测结论：能否内嵌
 * @param inShell     是否在桌面壳里（浏览器里没有「壳内独立窗口」这一档）
 */
export function decideComfyTabOpen(
  embeddable: boolean,
  inShell: boolean,
): ComfyTabTarget {
  if (embeddable) return "embed";
  return inShell ? "shell-window" : "browser";
}

/* ── 探测（IO 薄层）────────────────────────────────────────────────
 * 判据在上面，这里只负责「取事实」：向 base 的发一次 HEAD/GET，读回
 * X-Frame-Options / Content-Security-Policy。取不到事实一律按不可嵌处理
 * （宁可退到壳内独立窗口，也不把错误页摆给用户）。
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
  if (isSameOrigin(base, hostOrigin)) {
    return { embeddable: true, reason: "同源，浏览器不做内嵌校验" };
  }
  let res: Response;
  try {
    res = await fetchImpl(base, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(EMBED_PROBE_TIMEOUT_MS),
    });
  } catch (e) {
    return {
      embeddable: false,
      reason: `无法探测 ComfyUI 的内嵌策略：${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return judgeEmbeddable({
    base,
    hostOrigin,
    xFrameOptions: res.headers.get("x-frame-options"),
    contentSecurityPolicy: res.headers.get("content-security-policy"),
  });
}
