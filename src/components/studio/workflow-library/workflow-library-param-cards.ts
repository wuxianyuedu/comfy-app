// 工作流库「画布节点」的对外参数**归属派生**（纯配置 + 纯函数，规范 §17.2 第①层）。
//
// 库详情过去只渲染「一张宿主运行卡片」：对外参数在画布上完全看不到 —— 作者在
// 编辑器里勾出来的「提示词 = CLIPTextEncode 的这一行」这件事，库里无从判断。
// 本文件把这份归属关系派生成两层，供视图分别落在两处：
//
//   ① 卡片列：每个对外参数一张卡片（它由哪些端口组成）；
//   ② 行徽标：宿主卡片里「被落到的那一行参数」标出它属于哪个对外参数。
//
// 两处表达的是同一份事实的两端（卡片说「我由哪些端口组成」，徽标说「这一行属于
// 谁」），所以**同一句话只在一处出现**：哪个端口是落点在卡片上标名字（端口的
// 自有属性），而「这一行属于哪个对外参数」只在表单行尾标一次 —— 卡片与单行不
// 重复表达同一个落点。
//
// 数据源与编辑器同一份：`workflowIO` 聚类出条目，`paramMap.source.mode:<模式>`
// 给出当前模式生效的落点。库内是**只读消费视角**：拉线 / 断开 / 恢复默认都在
// 编辑器画布上做，这里只呈现。

import {
  autoMapEntries,
  buildParamEntries,
  parseParamMapping,
  resolveMapping,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";

export interface LibraryParamCards {
  /** 对外参数条目（稳定顺序）。 */
  entries: ParamEntry[];
  /** 当前模式下「条目 → 目标 ioKey」的生效落点（作者改过的优先于自动判定）。 */
  resolved: Record<string, string | null>;
  /** 每个被落到的一行（ioKey）→ 落到它的对外参数名，按条目顺序取第一个。
   *  宿主卡片的参数行据此在行尾标出「这一行属于哪个对外参数」。 */
  ownersByPin: Record<string, string>;
}

/** 从 workflowIO + paramMap 派生库内画布所需的归属数据。
 *
 *  模式取工作流的 defaultMode —— 与编辑器同一份口径：只有归属某个模式的落点
 *  才成立（`source.mode:<模式>`）。没有模式时带出的 resolved 仍是自动判定结果
 *  （供卡片与行标呈现），但没有任何「作者改过的落点」。 */
export function deriveLibraryParamCards(args: {
  io: WorkflowIOMap | null | undefined;
  paramMap: Record<string, unknown> | null | undefined;
  mode: string | null | undefined;
}): LibraryParamCards {
  const { io, paramMap, mode } = args;
  /* 契约驱动：卡片列 = 该模式统一对外暴露的参数（提示词 / 尺寸 / 首帧…），
   * 与具体工作流无关；工作流只决定每张卡落到哪一行端口。 */
  const entries = buildParamEntries(io, undefined, { mode: mode ?? null });
  /* paramMap 里没有 `auto` 字段（它不是持久化字段）——现算一份自动判定，
   * 与编辑器 useParamMapping 里的 auto 同源（autoMapEntries）。 */
  const parsed = parseParamMapping(paramMap);
  const resolved = resolveMapping(
    entries,
    io,
    { ...parsed, auto: autoMapEntries(entries, io) },
    mode ?? null,
  );

  const ownersByPin: Record<string, string> = {};
  for (const entry of entries) {
    const target = resolved[entry.id];
    if (!target || ownersByPin[target]) continue;
    ownersByPin[target] = entry.label;
  }

  return { entries, resolved, ownersByPin };
}

/** 某个对外参数当前落到的端口名（卡片行尾用它标出去向）。
 *
 *  落点存的是 ioKey，卡片要显示的是宿主卡片上那一行的**参数名** —— 两者经
 *  `io` 反查，不切分 ioKey（端口名本身可能含 `::`）。 */
export function resolveTargetName(
  io: WorkflowIOMap | null | undefined,
  ioKey: string | null | undefined,
): string | null {
  if (!ioKey) return null;
  const name = io?.[ioKey]?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}
