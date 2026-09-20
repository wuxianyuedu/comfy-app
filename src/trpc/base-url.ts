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
