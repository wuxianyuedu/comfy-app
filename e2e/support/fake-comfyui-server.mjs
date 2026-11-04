/**
 * 假 ComfyUI —— E2E 的「被内嵌页面」+「执行下游」替身。① 内嵌（ISSUE #310）：取决于它自己的响应头
 * （未开 CORS 对跨源返 403），服务端探测 `setting.comfyEmbeddable` 无法用浏览器 route 伪造。
 * ② 出图（ISSUE #1621）：任务只经 comfy-cli 执行，收口时轮询 `GET /history/{prompt_id}` 与 `GET /api/view`。
 * 复刻 ComfyUI `server.py` 的中间件语义与响应形状（§12.12）；默认带 `--enable-cors-header`，`E2E_FAKE_COMFY_CORS=0` 切 403。 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { WebSocketServer } from "ws";

import { resolveFakeComfyuiHost, resolveFakeComfyuiPort } from "./fake-comfyui-endpoint.mjs";

/* 端口 / 地址由端点模块给（**默认不是 8188**，见该文件头的 ISSUE #1756 取向）：
 * 替身与真件分居两个端口，本机开着真 ComfyUI 也能跑 e2e。 */
const HOST = resolveFakeComfyuiHost();
const PORT = resolveFakeComfyuiPort();
const CORS = process.env.E2E_FAKE_COMFY_CORS !== "0";

/** 回环地址判定（对应 ComfyUI 的 `is_loopback`）。
 * @param {string} hostname @returns {boolean} */
function isLoopback(hostname) {
  if (!hostname) {
    return false;
  }
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.startsWith("127.")
  );
}

/**
 * 复刻 ComfyUI `create_origin_only_middleware` 的跨源判定：比的是 netloc（含端口）而非主机名 ——
 * 宿主 `127.0.0.1:3100` 与 ComfyUI `127.0.0.1:8188` 端口不同即 403（端口见 `fake-comfyui-endpoint.mjs`）；
 * 只在某侧无端口时才退化成比主机名。简化成只比主机名会永远放行，替身失真，测试失去意义。
 * @param {import("node:http").IncomingMessage} req @returns {boolean} */
function isCrossOriginRequest(req) {
  if (req.headers["sec-fetch-site"] === "cross-site") {
    return true;
  }
  const host = req.headers.host;
  const origin = req.headers.origin;
  if (!host || !origin) {
    return false;
  }

  let hostCompare = host.toLowerCase();
  const parsed = new URL(origin);
  let originCompare = parsed.host.toLowerCase();

  const [hostHostname = ""] = hostCompare.split(":");
  if (!isLoopback(hostHostname)) {
    return false;
  }

  if (!parsed.port) {
    hostCompare = hostHostname;
  }
  if (!hostCompare.includes(":")) {
    originCompare = parsed.hostname;
  }

  return hostCompare !== originCompare;
}

const INDEX = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>ComfyUI</title></head><body>
<h1 id="comfy-root">FAKE COMFYUI</h1>
</body></html>`;

/**
 * prompt_id → history 条目，由假 comfy-cli（`e2e/support/fake-comfyui/comfy_cli`）在首节点跑完时经
 * `POST /e2e/record-history` 登记。**不预置**：应用收到 envelope 后立刻轮询 `/history`，预置会抹掉
 * 「先广播完成、后写产物」的真现象，而那正是 `fetchHistoryEntry` 存在的原因（HISTORY_RETRIES）——
 * 替身抹平后这段退化就再也测不出来。 */
const history = new Map();

/** `/api/view` 回的 PNG 字节。真图不需要 —— 用例断言的是「文件落盘且在库里有行」，
 *  字节内容只要是一个**合法 PNG 头**（`src/lib/media/*` 的探测按魔数走）。 */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(`e2e-fake-png:${createHash("sha1").update("fake-comfyui").digest("hex")}`),
]);

/** 收完请求体（替身只看 JSON，不判长度上限）。
 * @param {import("node:http").IncomingMessage} req @returns {Promise<string>} */
function readBody(req) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (/** @type {Buffer} */ c) => chunks.push(c));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

/** @param {import("node:http").ServerResponse} res
 * @param {Record<string, string>} headers
 * @param {number} status
 * @param {unknown} payload */
function sendJson(res, headers, status, payload) {
  res.writeHead(status, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

/** 按路由回形；`headers` 由调用点按 CORS 档决定（开则带 `access-control-allow-origin`）。
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {Record<string, string>} headers @param {string} path 已剥 query 的请求路径
 * @returns {Promise<void>} */
async function handle(req, res, headers, path) {
  if (path === "/") {
    res.writeHead(200, {
      ...headers,
      "content-type": "text/html; charset=utf-8",
    });
    res.end(INDEX);
    return;
  }
  if (path === "/system_stats") {
    sendJson(res, headers, 200, {
      system: { os: "nt", ram_total: 1, ram_free: 1 },
      devices: [],
    });
    return;
  }
  /* 假 comfy-cli 的提交口（真件是 ComfyUI 的 prompt 入口）。回显 prompt_id，
   * 形状与 ComfyUI 一致（`{prompt_id, number, node_errors}`）。 */
  if (path === "/prompt") {
    const body = await readBody(req);
    let clientId = "e2e";
    try {
      clientId = JSON.parse(body).client_id ?? clientId;
    } catch {
      /* 体不是 JSON：不是本替身要判的事，按默认 client_id 回 */
    }
    sendJson(res, headers, 200, {
      prompt_id: `prompt-${clientId}-${history.size + 1}`,
      number: history.size + 1,
      node_errors: {},
    });
    return;
  }
  /* 假 comfy-cli 的产物登记口：**只服务 E2E**，不是 ComfyUI 的接口（真件没有
   * 这一条，`/e2e/` 前缀就是用来把它与真接口区分开的）。 */
  if (path === "/e2e/record-history" && req.method === "POST") {
    const body = await readBody(req);
    try {
      const { prompt_id: promptId, node_id: nodeId, filename } = JSON.parse(body);
      history.set(promptId, {
        status: { status_str: "success", completed: true, messages: [] },
        outputs: {
          [nodeId]: { images: [{ filename, subfolder: "", type: "output" }] },
        },
      });
      sendJson(res, headers, 200, { ok: true });
    } catch {
      sendJson(res, headers, 400, { ok: false });
    }
    return;
  }
  /* history：`/history/{id}`（本应用 client.ts 的口）。未登记的 prompt_id 回 `{}`
   * ——与真件同形，也是 `fetchHistoryEntry` 轮询等待的那一段。 */
  const historyMatch = /^\/api\/history\/([^/]+)$/.exec(path);
  if (historyMatch) {
    /* 解构一次而不是两处各按 `[1]` 取：那是同一个值被读两遍，而它在下标读法上是
     * `string | undefined` —— 一处报 `TS2345`（进不了 `decodeURIComponent`）、
     * 另一处报 `TS2464`（**全账唯一一格**：计算属性名要的是 string）。
     * 两个红同一个根因，收在取出的那一句里就同时消失。 */
    const [, historyId = ""] = historyMatch;
    const entry = history.get(decodeURIComponent(historyId));
    sendJson(res, headers, 200, entry ? { [historyId]: entry } : {});
    return;
  }
  /* 产物下载：本应用拿 history 里的 filename 回来取字节（`client.getView`）。 */
  if (path === "/api/view") {
    res.writeHead(200, {
      ...headers,
      "content-type": "image/png",
      "content-length": String(PNG_BYTES.length),
    });
    res.end(PNG_BYTES);
    return;
  }
  if (path === "/queue") {
    sendJson(res, headers, 200, { queue_running: [], queue_pending: [] });
    return;
  }
  sendJson(res, headers, 200, {});
}

const server = createServer((req, res) => {
  // 未开 CORS：复刻 origin-only 中间件，跨源请求直接 403（响应体为空）。
  if (!CORS && isCrossOriginRequest(req)) {
    res.writeHead(403).end();
    return;
  }

  /** 头上先给一份，CORS 那一档再往里加键 —— 所以它必须是「串到串」的表，
   *  而不是被字面量推出来的 `{ "content-type": string }`（那个形状再加键就报 TS7053）。
   * @type {Record<string, string>} */
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (CORS) {
    headers["access-control-allow-origin"] = "*";
  }

  /* 解构给默认值而不是按下标取：`split("?")[0]` 在 `noUncheckedIndexedAccess` 下是
   * `string | undefined`，而 `handle(…)` 的形参已是 `string`（这一格是补完形参之后**新冒出来的**，
   * 与批 1 / 6 / 8 那三次同族：把类型指对之后，原来被隐式 any 吞掉的读取才现形）。 */
  const [urlPath = "/"] = (req.url ?? "/").split("?");
  void handle(req, res, headers, urlPath).catch(() => {
    /* 替身自身的异常不许把链路判成「ComfyUI 有问题」：回 500 让本应用按
     * 「接口异常」处理，比让连接悬空（表现为超时）可读得多。 */
    try {
      res.writeHead(500).end();
    } catch {
      /* 响应头已发出：无法补救，交给连接层 */
    }
  });
});

/* ── WebSocket（`/ws` 与 `/api/ws`）──────────────────────────────────────
 * 应用起来时会连这条通道（`executor-ws.ts`，两条都试）接实时帧；它**不是**收口依据（ADR §28：执行帧走
 * comfy-cli 那条连接，本应用只收 status 与遥测），所以只要有人应答、连上不掉即可 —— 不主动发帧。
 * 没有它客户端会一直重连，日志面板被刷成重连流水。 */
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path !== "/ws" && path !== "/api/ws") {
    socket.destroy();
    return;
  }
  if (!CORS && isCrossOriginRequest(req)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on("message", (raw) => {
      /* ComfyUI 的 WS 是双向的（本应用发 `{"type":"feature_flags",…}` 之类的
       * 握手）。回一条 `status` 帧让对端知道连接是活的，形状取真件的最小集。 */
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === "feature_flags") {
          ws.send(
            JSON.stringify({
              type: "status",
              data: { status: { exec_info: { queue_remaining: 0 } } },
            }),
          );
        }
      } catch {
        /* 非 JSON：忽略 */
      }
    });
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`[fake-comfyui] listening on http://${HOST}:${PORT} cors=${CORS}\n`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
