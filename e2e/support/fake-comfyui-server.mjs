/**
 * 假 ComfyUI —— E2E 的「被内嵌页面」替身。
 *
 * 为什么需要它：ComfyUI 能不能被内嵌，取决于**它自己**的响应（未开 CORS 时
 * 对跨源请求返 403，开了才回 `Access-Control-Allow-Origin`）。这条行为无法
 * 在浏览器侧用 `route.fulfill` 伪造 —— 本应用是**服务端**探测的
 * （`setting.comfyEmbeddable`，见 `src/lib/comfy-embed.ts`），必须真有一个
 * 「长得像 ComfyUI」的 HTTP 服务，才能覆盖到真实链路（ISSUE #310）。
 *
 * 本服务复刻 ComfyUI `server.py` 的两个中间件语义：
 *   - `--enable-cors-header` 缺席 → `create_origin_only_middleware`：跨源请求 403；
 *   - 带上该参数 → `create_cors_middleware`：放行并回 `Access-Control-Allow-Origin`。
 * 默认按「本应用拉起 ComfyUI 时会带 `--enable-cors-header`」启动，也就是
 * **用户实际会遇到的正常路径**；设 `E2E_FAKE_COMFY_CORS=0` 可切到 403 场景。
 *
 * 端点只需覆盖本应用探测/连通性用到的：`/`、`/system_stats`、`/object_info`、
 * `/queue`。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.E2E_FAKE_COMFY_PORT ?? 8188);
const CORS = process.env.E2E_FAKE_COMFY_CORS !== "0";

/** 回环地址判定（对应 ComfyUI 的 `is_loopback`）。 */
function isLoopback(hostname) {
  if (!hostname) return false;
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.startsWith("127.")
  );
}

/**
 * 复刻 ComfyUI `create_origin_only_middleware` 的跨源判定。
 *
 * 关键：比较的是 **netloc（含端口）**，不是主机名。宿主是
 * `127.0.0.1:3100`、ComfyUI 是 `127.0.0.1:8188`，**端口不同 → netloc 不同
 * → 403**。只在某一侧没有端口时才退化成比较主机名（ComfyUI 原文行为）。
 * 简化成「只比主机名」会两边都是 127.0.0.1 而永远放行，假服务就与真实
 * ComfyUI 不一致，测试随之失去意义。
 */
function isCrossOriginRequest(req) {
  if (req.headers["sec-fetch-site"] === "cross-site") return true;
  const host = req.headers.host;
  const origin = req.headers.origin;
  if (!host || !origin) return false;

  let hostCompare = host.toLowerCase();
  const parsed = new URL(origin);
  let originCompare = parsed.host.toLowerCase();

  const hostHostname = hostCompare.split(":")[0];
  if (!isLoopback(hostHostname)) return false;

  if (!parsed.port) hostCompare = hostHostname;
  if (!hostCompare.includes(":")) originCompare = parsed.hostname;

  return hostCompare !== originCompare;
}

const INDEX = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>ComfyUI</title></head><body>
<h1 id="comfy-root">FAKE COMFYUI</h1>
</body></html>`;

const server = createServer((req, res) => {
  // 未开 CORS：复刻 origin-only 中间件，跨源请求直接 403（响应体为空）。
  if (!CORS && isCrossOriginRequest(req)) {
    res.writeHead(403).end();
    return;
  }

  const headers = { "content-type": "application/json; charset=utf-8" };
  if (CORS) headers["access-control-allow-origin"] = "*";

  const path = (req.url ?? "/").split("?")[0];
  if (path === "/") {
    res.writeHead(200, {
      ...headers,
      "content-type": "text/html; charset=utf-8",
    });
    res.end(INDEX);
    return;
  }
  if (path === "/system_stats") {
    res.writeHead(200, headers);
    res.end(
      JSON.stringify({
        system: { os: "nt", ram_total: 1, ram_free: 1 },
        devices: [],
      }),
    );
    return;
  }
  res.writeHead(200, headers);
  res.end(JSON.stringify({}));
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(
    `[fake-comfyui] listening on http://127.0.0.1:${PORT} cors=${CORS}\n`,
  );
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
