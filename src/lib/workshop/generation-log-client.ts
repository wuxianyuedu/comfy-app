// ── 工坊生成执行日志：浏览器侧落盘客户端（规范 17 §17.2 第②层网络部分）──
// 各生成会话（提取 / AI 拆镜 / 定妆照）的日志在追加进界面的同时异步发一份到
// /api/workshop/logs 落盘。失败静默——执行日志是辅助通道，绝不能影响生成本身。

import { withQuery } from "~/lib/query-string";

import { isRecord } from "~/lib/is-record";
import type { GenerationLogStage } from "./generation-log";

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
  const payload = JSON.stringify({ entries, stage });
  try {
    void fetch(LOGS_ENDPOINT, {
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => {
      /* 落盘失败不影响生成流程 */
    });
  } catch {
    /* 同上 */
  }
}

/** 拉取某环节的历史执行日志（时间正序，最多 limit 条）。失败返回空数组。 */
export async function fetchGenerationLogs(
  stage: GenerationLogStage,
  limit = 100,
): Promise<Array<PersistableGenerationLog>> {
  let res: Response;
  try {
    res = await fetch(withQuery(LOGS_ENDPOINT, { limit: limit || undefined, stage }));
  } catch {
    return [];
  }
  if (!res.ok) {
    return [];
  }
  try {
    const data: unknown = await res.json();
    if (!isRecord(data) || !Array.isArray(data.entries)) {
      return [];
    }
    return data.entries.filter(
      (e): e is PersistableGenerationLog =>
        isRecord(e) && typeof e.summary === "string" && e.summary !== "",
    );
  } catch {
    return [];
  }
}
