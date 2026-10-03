/**
 * tRPC 客户端自调用用的 app 自身 origin（唯一出处）。
 *
 * `vanilla.ts` 与 `react.tsx` 此前各写一份**逐字相同**的 `getBaseUrl`（都 <60 行，
 * §12.12 的字面孪生判据抓不到），按 §12.18「复用优先」收口到这里一份。
 *
 * 回环主机写 `127.0.0.1` 不写 `localhost`：dev server 以 `-H 127.0.0.1` 绑定，
 * 而 SSR 侧 Node fetch 会把 `localhost` 先解析成 IPv6 `::1` → ECONNREFUSED
 * （与 §12.14「本机服务端点收口」同一判据）。`3100` 是静态链兜底端口（解析链见
 * launch-and-build §1.1），此处只在缺省命中，收一处即可。
 */
export function getBaseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://127.0.0.1:${process.env.COMFYAPP_PORT ?? process.env.PORT ?? 3100}`;
}

/**
 * tRPC 的 HTTP 端点（`vanilla.ts` 与 `react.tsx` 共用）。
 *
 * 收口前两处各写一遍 `getBaseUrl() + "/api/trpc"` —— 路径段是**协议的一部分**
 * （改了它就没有客户端能连上），却散在两个文件里，任一处漏改都是静默 404。
 */
export function getTrpcEndpoint(): string {
  return getBaseUrl() + "/api/trpc";
}

/**
 * 显式指定 origin 的 tRPC 端点：给「进程外的消费者」用。
 *
 * 目前唯一消费方是组件工作台 Storybook（`.storybook/data-sources.tsx`）——
 * 它跑在**另一个端口**上（工作台自己的 origin 不是应用），而组件 import 的
 * `~/trpc/vanilla` / `~/trpc/react` 都按 `getBaseUrl()` 取 origin，于是请求会
 * 打到工作台自己身上。把 origin 显式传进来，是让 story 走**真链路**（真应用、
 * 真数据）而不必给组件打桩的唯一方式。
 *
 * **不要**拿它去拼别的端点：路径段仍然只有 `getTrpcEndpoint()` 里的那一份。
 */
export function getTrpcEndpointFor(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/trpc`;
}
