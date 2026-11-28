/**
 * 工作流选型的只读决策日志（ISSUE #5278，借鉴 OpenMontage 的 provider 评分决策日志与成本快照）：
 * 记录「用了哪个工作流、当时还有哪些候选、从哪来、大概花了多少算力」，供失败复盘。
 * 不替用户自动切换工作流、不恢复内置模板——工作流库仍是唯一来源。
 * 纯函数，不碰 IO/DB/时钟。
 */
import { asRecord } from "~/lib/is-record";

export type SelectionSource = "pack" | "user";

export type SelectionCandidate = {
  id: string;
  name: string;
};

export type SelectionCost = {
  fps: number;
  frames: number;
  size: string;
};

export type SelectionLog = {
  candidates: Array<SelectionCandidate>;
  cost: SelectionCost;
  source: SelectionSource;
  workflowId: string;
};

/** 外来 `library` 行 → 受控候选；只认 id/name 字符串，脏行跳过。 */
export function selectionCandidatesOf(library: unknown, limit = 8): Array<SelectionCandidate> {
  if (!Array.isArray(library)) {
    return [];
  }
  const candidates: Array<SelectionCandidate> = [];
  for (const item of library) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const rec = asRecord(item);
    if (
      rec !== null &&
      typeof rec.id === "string" &&
      rec.id !== "" &&
      typeof rec.name === "string"
    ) {
      candidates.push({ id: rec.id, name: rec.name });
      if (candidates.length >= limit) {
        break;
      }
    }
  }
  return candidates;
}

/** 选中的工作流一定排第一，其余候选去重后跟上（只读快照，不改变实际选择）。 */
export function buildSelectionLog(opts: {
  candidates: Array<SelectionCandidate>;
  cost: SelectionCost;
  source: SelectionSource;
  workflowId: string;
}): SelectionLog | null {
  if (opts.workflowId === "") {
    return null;
  }
  const seen = new Set<string>([opts.workflowId]);
  const candidates: Array<SelectionCandidate> = [{ id: opts.workflowId, name: opts.workflowId }];
  for (const candidate of opts.candidates) {
    if (candidate.id !== opts.workflowId && !seen.has(candidate.id)) {
      seen.add(candidate.id);
      candidates.push(candidate);
    }
  }
  return {
    candidates,
    cost: opts.cost,
    source: opts.source,
    workflowId: opts.workflowId,
  };
}

/** 写进影片日志的一句话复盘（人读，含成本口径）。 */
export function selectionSummary(log: SelectionLog): string {
  const origin = log.source === "pack" ? "推荐包导入" : "用户指定";
  const names = log.candidates.map((candidate) => candidate.name).join("、");
  return (
    `选型决策：${origin} ${log.workflowId}（当时候选 ${names}；` +
    `成本快照 ${log.cost.frames} 帧 / ${log.cost.fps} fps / ${log.cost.size}）`
  );
}
