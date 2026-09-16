// 契约口「负向提示词」的**落点解析**（纯函数，规范 §17.2 第①层）。
//
// 「负向提示词」是契约里的常驻口：页面上显示哪些对外参数只由契约决定，不由工作流
// 内部长什么样决定（`buildParamEntries` 不再按「工作流有没有对应端口」裁剪契约口）。
// 于是「这一口现在落到哪一行」只剩两种来源：
//
//   1. 作者在画布上画过的线（`paramMap.source.mode:<模式>`，含历史键
//      `<节点 id>|negative`）—— 人工落点永远优先，显式断开如实呈现为未配置；
//   2. 作者没画过线时，由端口**名**判出来的负向候选（`classifyPin`：`negative` /
//      负向 / 负面 / 反向），与其它契约口的自动落点同一套口径。
//
// 两种来源都落空时这一口就是「未配置」——**不推导、不猜**：显示成未配置，等作者
// 在库里把这一口连到工作流的哪一行上。此前这里会拿「图内文本编码节点的第二个」
// 做兜底推断，那是在替作者猜工作流的能力，已删除。
//
// 两个页签共读调用方（`deriveLibraryParamCards`）的同一份产物。

import {
  nodeIdOfIoKey,
  type ParamEntry,
  type ParamMapping,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";

/** 该口子上的手工线指到哪一行（`null` = 作者显式断开；`undefined` = 没画过）。
 *
 *  契约口的键空间是 `negative`，而历史落库的键是 `<节点 id>|<分类>`（按节点
 *  聚类时代）—— 两套都要认，否则「当年按旧键连好的负向口」会被当成没画过，
 *  自动落点随即把它挪回名字判据命中的那一行（用户表现是「改了落点自己变回去」）。
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

/** 给契约口补上历史键指向的那一行候选（宿主节点 id 一并补，卡片 / 连线要它）。 */
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

/** 让「负向提示词」这一口的候选里包含作者当年按**历史键**连过的那一行。
 *
 *  只做一件事：把落库的旧键翻译回候选端口，供 `resolveMapping` 解析落点用。
 *  不做任何「工作流能不能承接负向」的推导 —— 判不出来就保持零候选，页面上
 *  如实显示成未配置。 */
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
  if (manual === undefined || manual === null) return [...entries];
  if (!io?.[manual]) return [...entries];
  return [...entries, withTargetPin(negative, manual)];
}
