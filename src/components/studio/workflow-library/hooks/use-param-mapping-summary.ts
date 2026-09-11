"use client";

/* ── 工作流库画布节点上的「参数映射」派生（规范 §17.2 第②层）──
 *
 * 工作流编辑器把「对外参数 → 节点端口」的连线模型落库在 `paramMap.source`
 * （见 `~/lib/workflow-param-mapping`）。库里要展示同一份事实，但只需读：
 * 把 workflowIO 聚成对外参数条目、解析自动映射 + 作者手工线，再把目标端口
 * 翻译成「节点标题.端口名」这种作者看得懂的名字。
 *
 * 与编辑器侧 `use-param-mapping` 同一模型、同一优先级，两处展示必然一致。 */

import { useMemo } from "react";

import {
  buildParamEntries,
  manualTargetFor,
  parseParamMapping,
  resolveMapping,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import type { MappingSummaryRow } from "../WorkflowParamMappingSummary";
import { buildPortOwners } from "../workflow-param-mapping-ui";

export interface ParamMappingSummary {
  rows: MappingSummaryRow[];
  /** 端口 ioKey → 行内容（供表单行尾徽标按行渲染映射状态）。 */
  byPort: Record<string, { entry: ParamEntry; targetName: string | null; manual: boolean }>;
}

export function useParamMappingSummary(args: {
  io: WorkflowIOMap | null | undefined;
  paramMap: Record<string, unknown> | null | undefined;
  mode: string | null | undefined;
}): ParamMappingSummary {
  const { io, paramMap, mode } = args;

  return useMemo<ParamMappingSummary>(() => {
    const entries = buildParamEntries(io);
    if (entries.length === 0) {
      return { rows: [], byPort: {} };
    }
    const persisted = parseParamMapping(paramMap);
    const resolved = resolveMapping(entries, io, persisted, mode ?? null);
    /* 手工线只认「当前模式」这一层 + 通用层，与编辑器同口径
     *  （manualTargetFor：模式线优先，返回 undefined 表示没改过）。 */
    const isManual = (id: string) => manualTargetFor(persisted, id, mode ?? null) !== undefined;

    /* 端口名优先取作者命名的 label，其次 pin 名——与表单里那一行的显示名一致，
     * 用户才能把「提示词 → Text to Image....text」对到卡片上的同一行。 */
    const nameOf = (ioKey: string) => {
      const raw = io?.[ioKey];
      if (!raw) return null;
      return raw.label ?? raw.name ?? null;
    };

    const rows: MappingSummaryRow[] = entries.map((entry) => {
      const target = resolved[entry.id];
      return {
        entry,
        targetName: target ? nameOf(target) : null,
        manual: isManual(entry.id),
      };
    });

    const rowById = new Map(rows.map((row) => [row.entry.id, row]));
    const owners = buildPortOwners(entries, resolved);
    const byPort: ParamMappingSummary["byPort"] = {};
    for (const [ioKey, id] of Object.entries(owners)) {
      const row = rowById.get(id);
      if (row) byPort[ioKey] = { entry: row.entry, targetName: row.targetName, manual: row.manual };
    }

    /* 未连线的对外参数排在后面：作者最关心的「有没有连上」一眼可见。 */
    const sorted = [...rows].sort(
      (a, b) => Number(a.targetName === null) - Number(b.targetName === null)
    );

    return { rows: sorted, byPort };
  }, [io, paramMap, mode]);
}
