// ── 工坊生成执行日志：服务端落盘 / 读取（规范 17 §17.2 服务端网络层）──
// 条目形状与归一化在 ./generation-log（纯函数）；本文件只做 fs 编排：
//   · append：按天追加 JSONL（log/workshop/generation-YYYY-MM-DD.log，
//     自然按天轮转，避免单一固定名文件被长持句柄锁死——AGENTS 硬规则 4）；
//   · read：按文件名倒序回溯，收集指定环节最近 limit 条（时间正序返回）。
// 写入失败绝不抛给调用方——执行日志是辅助通道，不能把生成流程带崩。

import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { WORKSHOP_LOG_DIR } from "@/lib/log-paths";
import {
  generationLogFileName,
  normalizeGenerationLogEntry,
  type GenerationLogEntry,
  type GenerationLogStage,
} from "./generation-log";

/** 追加一批执行日志（调用方已按环节分组）；失败仅 warn，不抛出。 */
export async function appendGenerationLogs(
  stage: GenerationLogStage,
  entries: unknown[],
): Promise<number> {
  const lines: string[] = [];
  for (const raw of entries) {
    const entry = normalizeGenerationLogEntry(raw);
    if (entry) lines.push(JSON.stringify({ stage, ...entry }));
  }
  if (lines.length === 0) return 0;
  try {
    const file = path.join(WORKSHOP_LOG_DIR, generationLogFileName(new Date()));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${lines.join("\n")}\n`, "utf8");
    return lines.length;
  } catch (e) {
    console.warn(
      `[workshop-logs] 执行日志落盘失败（不影响生成）：${e instanceof Error ? e.message : String(e)}`,
    );
    return 0;
  }
}

/** 读取指定环节最近的执行日志（跨天回溯，时间正序）。读取失败返回空数组。 */
export async function readGenerationLogs(
  stage: GenerationLogStage,
  limit: number,
): Promise<GenerationLogEntry[]> {
  const capped = Math.max(1, Math.min(500, Math.floor(limit) || 100));
  try {
    const names = (await fs.readdir(WORKSHOP_LOG_DIR))
      .filter((n) => /^generation-\d{4}-\d{2}-\d{2}\.log$/.test(n))
      .sort()
      .reverse();
    const collected: GenerationLogEntry[] = [];
    for (const name of names) {
      let text: string;
      try {
        text = await fs.readFile(path.join(WORKSHOP_LOG_DIR, name), "utf8");
      } catch {
        continue; // 文件恰被轮转/锁住：跳过该天，继续回溯
      }
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const raw = JSON.parse(trimmed) as Record<string, unknown>;
          // 行内 stage 由 append 写入；不匹配的环节直接跳过
          if (raw.stage !== stage) continue;
          const entry = normalizeGenerationLogEntry(raw);
          if (entry) collected.push(entry);
        } catch {
          // 坏行跳过，不影响其余日志
        }
      }
      if (collected.length >= capped) break; // 已够最近 limit 条，不再回溯更早的天
    }
    // 文件按新→旧遍历，collected 前段是新条目：取末尾 capped 条即「最近 limit 条」，
    // 并保持时间正序返回
    return collected.slice(-capped);
  } catch {
    return [];
  }
}
