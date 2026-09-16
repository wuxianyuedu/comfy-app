// 契约口「负向提示词」的候选兜底（纯函数，规范 §17.2 第①层 / ISSUE #620）。
//
// 契约里「负向提示词」是**可选口**：工作流没有对应端口时 `buildParamEntries` 会
// 整口省略。而 `classifyPin` 判负向只有两条判据 —— 名字里有 negative / 负向，
// 或图内角色 `role = negative`。两条都落空、但工作流**确实能承接**负向提示词的
// 情形很常见：正向写死在作者自己的 `CLIPTextEncode`、负向接在第三方节点（提示词
// 润色 / 翻译 / 模型自带负向）上。承载它的那一行既没有负向的名字、也拿不到
// `role`，于是「工坊封装」页签少一口 —— 而负向提示词是工坊的**统一配置口**，
// 显示与否不该跟工作流内部长什么样挂钩。
//
// 本模块把这条兜底收成一份纯派生：判据只走「图内文本编码节点」这一封闭池
// （`isTextNode`）+ 正 / 负序号，落在哪一行由 `~/lib/workflow-text-role` 给出。
// 两个页签共读调用方（`deriveLibraryParamCards`）的同一份产物，因此不会一边有
// 一边没有。

import { inferNegativeSlot } from "~/lib/workflow-text-role";
import {
  nodeIdOfIoKey,
  type ParamEntry,
  type ParamMapping,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";

/** 该口子上的手工线指到哪一行（`null` = 作者显式断开；`undefined` = 没画过）。
 *
 *  契约口的键空间是 `negative`，而历史落库的键是 `<节点 id>|<分类>`（按节点
 *  聚类时代）—— 两套都要认，否则「当年按旧键连好的负向口」会在候选兜底这一步
 *  被当成「没画过」，再被图内顺序覆盖掉（用户表现是「改了落点自己变回去」）。
 *  兼容读取与 `manualTargetForEntry` 同一口径：枚举候选行的节点 id × 负向分类。 */
function manualNegativeHit(
  parsed: ParamMapping,
  io: WorkflowIOMap | null | undefined,
  mode: string | null,
): string | null | undefined {
  const byEntry = mode ? parsed.manualByMode?.[mode] : undefined;
  if (!byEntry) return undefined;
  if (Object.prototype.hasOwnProperty.call(byEntry, "negative"))
    return byEntry.negative ?? null;
  const nodeIds = new Set<string>();
  for (const ioKey of Object.keys(io ?? {})) nodeIds.add(nodeIdOfIoKey(ioKey));
  for (const nodeId of nodeIds) {
    const legacy = `${nodeId}|negative`;
    if (Object.prototype.hasOwnProperty.call(byEntry, legacy))
      return byEntry[legacy] ?? null;
  }
  return undefined;
}

/** 给契约口补上兜底找出来的那一行候选（宿主节点 id 一并补，卡片 / 连线要它）。 */
function withTargetPin(entry: ParamEntry, ioKey: string): ParamEntry {
  return {
    ...entry,
    hostNodeId: entry.hostNodeId || nodeIdOfIoKey(ioKey),
    pins: [
      {
        ioKey,
        name: entry.pins[0]?.name ?? "",
        type: entry.pins[0]?.type ?? "*",
        defaultValue: entry.pins[0]?.defaultValue,
      },
    ],
  };
}

/** 把「负向提示词」这一口补到它该落的那一行上（ISSUE #620）。
 *
 *  入参 `entries` 必须是**带上了零候选可选口**的那一份（
 *  `buildParamEntries(..., { keepOptional: true })`）——没有它，这一口在
 *  「工作流判不出负向」时根本不在清单里，也就无从补候选。
 *
 *  四种情形如实区分：
 *   · 判得出负向（已有候选）→ 原样（`classifyPin` 的结论优先）；
 *   · 作者画过线 → 尊重人工落点，不拿图内顺序覆盖（显式断开如实呈现为未配置，
 *     绝不被兜底复活）；
 *   · 兜底判不出来（工作流只有一个文本编码节点 / 一个都没有）→ 把这张「零候选」
 *     的占位卡片摘掉：可选口「不显示」正是它的合法状态；
 *   · 兜底判得出来 → 补上候选，后续 `resolveMapping` 才会把自动连线状态落到那一行。 */
export function applyNegativeSlotFallback(args: {
  entries: readonly ParamEntry[];
  io: WorkflowIOMap | null | undefined;
  parsed: ParamMapping;
  mode: string | null;
}): ParamEntry[] {
  const { entries, io, parsed, mode } = args;
  const negative = entries.find((entry) => entry.id === "negative");
  /* 契约里本来就没有这一口（用户改过的契约删了它）→ 不凭空补一个。 */
  if (!negative) return [...entries];
  if (negative.pins.length > 0) return [...entries];

  const manual = manualNegativeHit(parsed, io, mode);
  if (manual !== undefined)
    return manual === null
      ? [...entries]
      : [...entries, withTargetPin(negative, manual)];

  const ioKey = inferNegativeSlot(
    Object.entries(io ?? {}).map(([key, entry]) => ({
      ioKey: key,
      name: entry?.name,
      label: entry?.label,
      role: entry?.role,
      isTextNode: entry?.isTextNode,
    })),
  );
  if (!ioKey) return entries.filter((entry) => entry.id !== "negative");
  if (!io?.[ioKey]) return [...entries];
  return [...entries, withTargetPin(negative, ioKey)];
}
