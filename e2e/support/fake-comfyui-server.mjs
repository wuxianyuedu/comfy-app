/**
 * 假 ComfyUI —— E2E 的「被内嵌页面」+「执行下游」替身。
 *
 * ## 它要答的两件事
 *
 * ① **内嵌能不能成**（ISSUE #310，原本唯一用途）：取决于**它自己**的响应头
 *    （未开 CORS 时对跨源请求返 403，开了才回 `Access-Control-Allow-Origin`）。
 *    这条行为无法在浏览器侧用 `route.fulfill` 伪造 —— 本应用是**服务端**探测的
 *    （`setting.comfyEmbeddable`，见 `src/lib/comfy/comfy-embed.ts`），必须真有一个
 *    「长得像 ComfyUI」的 HTTP 服务。
 * ② **出图能不能走完**（ISSUE #1621）：本应用的任务**只经 comfy-cli 执行**
 *    （`executor-cli.ts` 调 `python -m comfy_cli run …`），而收口那一刻会回来
 *    轮询 `GET /history/{prompt_id}` 找产物、再 `GET /api/view` 下载字节。
 *    这两条口没有任何替身能绕过（服务端 fetch，不经浏览器），所以「登录 → 建项目
 *    → 出图」这条链路要真跑通，它们必须有人应答。
 *
 * ## 与真件的边界
 *
 * 复刻的是 ComfyUI `server.py` 的**中间件语义**（`--enable-cors-header` 缺席 →
 * `create_origin_only_middleware` 跨源 403；带上该参数 → 放行并回 ACAO），
 * 以及那几条口的响应形状。**不复刻**本仓库的任何执行器逻辑 —— 那不在这条
 * 边界的哪一侧（§12.12 判的是仓库内两份同样实现，不是被替身掉的外部程序）。
 *
 * 默认按「本应用拉起 ComfyUI 时会带 `--enable-cors-header`」启动，也就是
 * **用户实际会遇到的正常路径**；设 `E2E_FAKE_COMFY_CORS=0` 可切到 403 场景。
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { WebSocketServer } from "ws";

import {
  resolveFakeComfyuiHost,
  resolveFakeComfyuiPort,
} from "./fake-comfyui-endpoint.mjs";

/* 端口 / 地址由端点模块给（**默认不是 8188**，见该文件头的 ISSUE #1756 取向）：
 * 替身与真件分居两个端口，本机开着真 ComfyUI 也能跑 e2e。 */
const HOST = resolveFakeComfyuiHost();
const PORT = resolveFakeComfyuiPort();
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
 * → 403**（替身自己的端口见 `fake-comfyui-endpoint.mjs`）。只在某一侧没有端口时才退化成比较主机名（ComfyUI 原文行为）。
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

/**
 * prompt_id → history 条目。
 *
 * 由假 comfy-cli（`e2e/support/fake-comfyui/comfy_cli`）在首个节点跑完时经
 * `POST /e2e/record-history` 登记。**为什么不是「拿到 /prompt 就预置」**：
 * 本应用是「收到 envelope 后立刻轮询 /history」，history 比收口信号早到才能
 * 一轮命中；预置会让「先广播完成、后写产物」那个真现象在替身里消失，而它正是
 * `fetchHistoryEntry` 存在的原因（HISTORY_RETRIES 轮询）—— 替身把它抹平，
 * 就再也测不出那一段退化了。
 */
const history = new Map();

/** `/api/view` 回的 PNG 字节。真图不需要 —— 用例断言的是「文件落盘且在库里有行」，
 *  字节内容只要是一个**合法 PNG 头**（`src/lib/media/*` 的探测按魔数走）。 */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(
    `e2e-fake-png:${createHash("sha1").update("fake-comfyui").digest("hex")}`,
  ),
]);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function sendJson(res, headers, status, payload) {
  res.writeHead(status, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

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
      const {
        prompt_id: promptId,
        node_id: nodeId,
        filename,
      } = JSON.parse(body);
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
    const entry = history.get(decodeURIComponent(historyMatch[1]));
    sendJson(res, headers, 200, entry ? { [historyMatch[1]]: entry } : {});
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

  const headers = { "content-type": "application/json; charset=utf-8" };
  if (CORS) headers["access-control-allow-origin"] = "*";

  const path = (req.url ?? "/").split("?")[0];
  void handle(req, res, headers, path).catch(() => {
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
 * 本应用起来时会连这条通道（`executor-ws.ts`，WS_PATHS 两条都试），用来接
 * ComfyUI 的实时帧。它**不是**这条链路的收口依据（拓扑见 ADR §28：执行帧发
 * 给 comfy-cli 那条连接，本应用只收 status 与遥测广播），所以这里只要「有人
 * 应答、连上不掉」即可 —— 不主动发帧，也不必发。没有它的话，客户端会一直
 * 重连、把日志面板刷成重连流水，用例里全是噪声。 */
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
  process.stdout.write(
    `[fake-comfyui] listening on http://${HOST}:${PORT} cors=${CORS}\n`,
  );
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
