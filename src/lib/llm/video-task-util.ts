/* ── 远端异步视频任务：轮询取回产物 + 本地落盘（服务端专用）──────────
 * 「测试生成」的视频接口多为任务制：提交返回任务 ID，产物在几秒~几分钟后才
 * 就绪。本模块把「轮询任务状态 → 读到的媒体 URL 落盘到本地 temp」收敛到一处，
 * 供提交路由（/api/llm/test-usage）与「继续等待」查询路由共用——保证两者用同
 * 一套轮询地址形状与超时口径，避免行为分叉。
 *
 * 本模块依赖 node fs/path 与 fetch，只允许在服务端（路由 / server）引入，
 * 不得被浏览器端组件 import（规范 §17 分层）。纯 URL 拼接见 config 的
 * buildVideoPollUrls，可单测。
 */

import "server-only";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { assertSafeOutboundUrl, safeFetch } from "~/lib/network/outbound-url.server";
import { lastSegments } from "~/lib/path-display";
import { formatCompactStamp } from "~/lib/time-format";
import { base64PayloadOf, isInlineMedia } from "~/lib/media/data-url";
import { extractMediaUrl } from "~/lib/workshop/api-channel-shared";
import { sleep } from "~/lib/with-timeout";
import {
  buildVideoPollUrls,
  mediaDefaultExt,
  mediaExtensionFromUrl,
} from "~/lib/llm/usage-test-config";

/** 单次「等待窗口」：提交后路由内置轮询这么久；若仍没就绪，返回 pending，
 *  前端据此提供「继续等待」入口再次发起一轮查询（不重复提交、不重复扣费）。 */
export const VIDEO_POLL_TOTAL_MS = 90_000;
/** 两轮状态查询之间的间隔。 */
export const VIDEO_POLL_INTERVAL_MS = 5000;

/** 本地 temp 产物根目录（process.cwd()/temp/usage-test，与 /log 同级）。 */
function localTempRoot(): string {
  return path.join(process.cwd(), "temp", "usage-test");
}

/** 模型名 → 目录名：剥分隔符 / .. 与文件系统特殊字符，避免路径穿越。 */
function safeModelDir(name: string): string {
  const s = lastSegments(name.trim(), 1);
  const cleaned = s.replaceAll(/[\u0000-\u001f<>:"|?*]/g, "_").slice(0, 80);
  return cleaned || "unnamed";
}

/** 把生成的图片 / 视频下载到本地 temp 子目录，返回绝对路径。
 *  产出的内容本地落盘一份（不是只给远端 URL）——桌面端用户能直接在本地
 *  temp 里找到 / 用系统打开。失败不抛错：本地保存只是增强，拿不到就忽略。 */
/** 单份媒体的大小上限（ISSUE #4285）：测试产物不是档案，超限中止下载、不留半成品。 */
const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
/** 测试产物的保留期：超过即清（目录有界，别把用户磁盘当仓库）。 */
const MEDIA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 清扫过期的测试媒体（ISSUE #4285）：temp/usage-test/<模型>/ 下的文件超过
 *  保留期即删。每次落盘前顺手跑一遍，目录有界；任何失败都只是「这条没清掉」，
 *  不影响本次落盘。 */
async function pruneExpiredMedia(): Promise<void> {
  const root = localTempRoot();
  let modelDirs: Array<string>;
  try {
    modelDirs = (await fs.readdir(root)).map((d) => path.join(root, d));
  } catch {
    /* 目录不存在 = 还没存过任何媒体，无事可清。 */
    return;
  }
  const cutoff = Date.now() - MEDIA_RETENTION_MS;
  await Promise.all(
    modelDirs.map(async (dir) => {
      let entries: Array<Dirent>;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; /* 目录读不到就跳过这一组（map 回调里没有 continue）。 */
      }
      await Promise.all(
        entries.map(async (entry) => {
          if (!entry.isFile()) {
            return;
          }
          const full = path.join(dir, entry.name);
          try {
            const stat = await fs.stat(full);
            if (stat.mtimeMs < cutoff) {
              await fs.rm(full, { force: true });
            }
          } catch {
            /* 单个文件清不掉不影响其余。 */
          }
        }),
      );
    }),
  );
}

export async function saveMediaToLocalTemp(
  kind: "image" | "video",
  modelName: string,
  url: string,
): Promise<string | null> {
  let dest: string | null = null;
  try {
    /* 落盘前顺手清扫过期产物（ISSUE #4285），目录有界。 */
    await pruneExpiredMedia();
    const dir = path.join(localTempRoot(), safeModelDir(modelName));
    await fs.mkdir(dir, { recursive: true });
    const fallback = mediaDefaultExt(kind);
    const ext = mediaExtensionFromUrl(url, fallback);
    // 文件名时间戳走统一入口（本地时刻 + 毫秒：一次生成的多份产物可能落在同
    // 一秒，只到秒会互相覆盖）。
    const stamp = formatCompactStamp(new Date(), { millis: true });
    const fileName = `usage-${kind}-${stamp}.${ext}`;
    dest = path.join(dir, fileName);
    if (isInlineMedia(url)) {
      /* 「怎么取 data URL 的 base64 载荷」只有一处定义
       *（`~/lib/media/data-url`，规范 16 §16.2.4.56）。
       * 收口前这里是 `url.split(",")[1] ?? ""` —— 缺逗号时写成**空串**，
       * 于是写一个 0 字节文件冒充产物（调用方拿到非 null 路径）。 */
      const base64 = base64PayloadOf(url);
      if (base64 === null) {
        throw new Error("data URL 格式无效");
      }
      await fs.writeFile(dest, Buffer.from(base64, "base64"));
    } else {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(120_000),
        headers: { Accept: "*/*" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      /* 流式落盘 + 大小上限（ISSUE #4285）：不再把远端媒体整体读进内存
       * （一个大视频会让进程 RSS 瞬时冲高），边读边写、超限即止。 */
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("响应没有可读正文");
      }
      const handle = await fs.open(dest, "wx");
      let total = 0;
      try {
        for (;;) {
          /* 流分块必须按序读写，无法并行（no-await-in-loop 豁免：顺序依赖）。 */
          // oxlint-disable-next-line no-await-in-loop -- 流分块必须按序读取
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          total += value.byteLength;
          if (total > MAX_MEDIA_BYTES) {
            throw new Error(
              `媒体超过 ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)}MB 上限，已中止下载`,
            );
          }
          // oxlint-disable-next-line no-await-in-loop -- 流分块必须按序写入
          await handle.write(value);
        }
        if (total === 0) {
          throw new Error("空文件");
        }
      } finally {
        await handle.close();
      }
    }
    return dest;
  } catch {
    /* 半成品清理（ISSUE #4285）：流式写盘中断（超限/网络断）不留半个文件。 */
    if (dest !== null) {
      await fs.rm(dest, { force: true }).catch(() => undefined);
    }
    return null;
  }
}

/** 在窗口内轮询候选查询地址，直到读到媒体 URL（视为产物就绪）。
 *  返回就绪的媒体 URL；窗口耗尽仍未就绪返回 null（调用方据此报 pending）。
 *  地址构造纯函数 buildVideoPollUrls 已内聚，此处只管「轮询」这一件事。 */
export async function pollRemoteVideoTask(
  baseUrl: string,
  path: string,
  model: string,
  taskId: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const { rest, agnes } = buildVideoPollUrls(baseUrl, path, model, taskId);
  const pollUrls = [rest, ...(agnes === null ? [] : [agnes])];
  const deadline = Date.now() + VIDEO_POLL_TOTAL_MS;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    await sleep(VIDEO_POLL_INTERVAL_MS);
    for (const pollUrl of pollUrls) {
      try {
        // 出网目标同样走统一约束（#3904/#4052）：轮询地址由可控 base 派生。
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await assertSafeOutboundUrl(pollUrl, "llm-upstream");
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        const pollRes = await safeFetch(pollUrl, {
          headers,
          signal: AbortSignal.timeout(30_000),
          scenario: "llm-upstream",
        });
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        const pollPayload: unknown = await pollRes.json().catch(() => null);
        if (pollRes.ok) {
          const url = extractMediaUrl(pollPayload);
          if (url !== null) {
            return url;
          }
        }
      } catch {
        // 单个地址 / 单次轮询失败不终止 —— 换下一个地址或等下一轮
      }
    }
  }
  return null;
}
