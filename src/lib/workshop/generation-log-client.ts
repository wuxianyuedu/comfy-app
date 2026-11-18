// ── 工坊生成执行日志：浏览器侧落盘客户端（规范 17 §17.2 第②层网络部分）──
// 各生成会话（提取 / AI 拆镜 / 定妆照）的日志在追加进界面的同时异步发一份到
// /api/workshop/logs 落盘。失败静默——执行日志是辅助通道，绝不能影响生成本身。

import { withQuery } from "~/lib/query-string";

import { isRecord } from "~/lib/is-record";
import type { GenerationLogStage } from "./generation-log";
import { fetchWithTimeout } from "~/lib/network/fetch-with-timeout";

/** 一条待落盘的执行日志（与界面条目同形：ts / kind / summary / detail?）。 */
export type PersistableGenerationLog = {
  detail?: string;
  kind: string;
  summary: string;
  ts: number | string;
};

const LOGS_ENDPOINT = "/api/workshop/logs";

/** 异步落盘一批日志；不 await 也不抛错（fire-and-forget）。 */
export function persistGenerationLogs(
  stage: GenerationLogStage,
  entries: Array<PersistableGenerationLog>,
): void {
  if (entries.length === 0) {
    return;
  }
  const payload = JSON.stringify({ stage, entries });
  try {
    void fetchWithTimeout(LOGS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* 落盘失败不影响生成流程 */
    });
  } catch {
    /* 同上 */
  }
}

/** 拉取结果区分「空」与「失败」（#4242）：失败被折成空数组会让用户把
 *  「拉取失败」误读成「没有历史」。ok=false 时 entries 恒为空数组。 */
export type GenerationLogsResult =
  | { entries: Array<PersistableGenerationLog>; ok: true }
  | { entries: []; ok: false };

/** 拉取某环节的历史执行日志（时间正序，最多 limit 条）。 */
export async function fetchGenerationLogs(
  stage: GenerationLogStage,
  limit = 100,
): Promise<GenerationLogsResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(withQuery(LOGS_ENDPOINT, { stage, limit: limit || undefined }));
  } catch {
    return { entries: [], ok: false };
  }
  if (!res.ok) {
    return { entries: [], ok: false };
  }
  try {
    const data: unknown = await res.json();
    if (!isRecord(data) || !Array.isArray(data.entries)) {
      /* 对端可达但载荷不符合契约：也算失败（调用方给「拉取失败」，不是「没有历史」）。 */
      return { entries: [], ok: false };
    }
    return {
      entries: data.entries.filter(
        (e): e is PersistableGenerationLog =>
          isRecord(e) && typeof e.summary === "string" && e.summary !== "",
      ),
      ok: true,
    };
  } catch {
    return { entries: [], ok: false };
  }
}
