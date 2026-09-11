// 工作流库「画布节点」预览的映射派生（纯配置 + 纯函数，规范 §17.2 第①层）。
//
// 库详情过去只渲染「一张宿主卡片」：对外参数在画布上完全看不到，也无从判断
// 「这个参数喂给了哪一行端口」。本文件把编辑器画布上的那套派生搬进库内预览，
// 使库详情与编辑器看同一件事：
//   · 每个对外参数是一张卡片（渲染由 WorkflowParamMapLayer 负责）；
//   · 自动探测出来的默认线开箱即连（虚线），作者改过的线画实线；
//   · 连线按模式存放（`paramMap.source.mode:<模式>`），与编辑器同一份事实源。
//
// 无 React、无副作用：只做数据派生（连线 / 条目的解析），视图层负责渲染与测量。

import {
  autoMapEntries,
  buildParamEntries,
  parseParamMapping,
  resolveMapping,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { buildParamEdges } from "../workflow-editor/workflow-param-edges";

export interface LibraryCanvas {
  /** 对外参数条目（稳定顺序）。 */
  entries: ParamEntry[];
  /** 当前模式下「条目 → 目标 ioKey」的生效表（作者线优先于默认线）。 */
  resolved: Record<string, string | null>;
}

/** 从 workflowIO + paramMap 派生库预览所需的参数条目与生效连线。
 *
 *  模式取工作流的 defaultMode —— 与编辑器画布同一份口径：只有归属某个模式的
 *  线才成立（`source.mode:<模式>`）。没有模式时带出的 resolved 仍是自动映射
 *  结果（供连线展示），但不会有任何「作者画过的线」。 */
export function deriveLibraryCanvas(args: {
  io: WorkflowIOMap | null | undefined;
  paramMap: Record<string, unknown> | null | undefined;
  mode: string | null | undefined;
}): LibraryCanvas {
  const { io, paramMap, mode } = args;
  const entries = buildParamEntries(io);
  const parsed = parseParamMapping(paramMap);
  /* paramMap 里没有 `auto` 字段（它不是持久化字段）——现算一份自动映射，
   * 与编辑器 useParamMapping 里的 auto 同源（autoMapEntries）。 */
  const auto = autoMapEntries(entries, io);
  const resolved = resolveMapping(entries, io, { ...parsed, auto }, mode ?? null);
  return { entries, resolved };
}

/** 从 paramMap 里取出「当前模式下被作者改过的条目 id」集合。
 *
 *  与 resolveMapping 同源：只有带 `mode:` 前缀、且属于当前模式的表才算作者的线
 *  （库内不需要 labels / auto）。连线据此决定线型：作者线实线、默认线虚线。 */
export function resolveManualEntryIds(
  paramMap: Record<string, unknown> | null | undefined,
  mode: string | null
): Set<string> {
  const out = new Set<string>();
  if (!mode) return out;
  const sourceNs: unknown = paramMap?.source;
  if (!sourceNs || typeof sourceNs !== "object" || Array.isArray(sourceNs)) return out;
  const byMode: unknown = (sourceNs as Record<string, unknown>)[`mode:${mode}`];
  if (!byMode || typeof byMode !== "object" || Array.isArray(byMode)) return out;
  for (const key of Object.keys(byMode)) out.add(key);
  return out;
}

/** 库预览的连线（对外参数卡片 → 宿主卡片端口）。
 *
 *  与编辑器同源：自动线虚线、作者线实线、显式断开不画线。库内连线**只读**
 *  （selectable/deletable 关掉），拉线与删除仍是编辑器画布的手势。 */
export function buildLibraryParamEdges(args: {
  entries: readonly ParamEntry[];
  resolved: Record<string, string | null>;
  /** 某个条目在当前模式下是否作者画过线（决定线型）。 */
  isManual: (entryId: string) => boolean;
}): ReturnType<typeof buildParamEdges> {
  const { entries, resolved, isManual } = args;
  const renderedCardIds = new Set(entries.map((entry) => `pio:${entry.id}`));
  return buildParamEdges({ entries, resolved, isManual, renderedCardIds }).map(
    (edge) => ({
      ...edge,
      selectable: false,
      deletable: false,
      focusable: false,
    })
  );
}
