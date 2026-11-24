// ── 编辑对外参数：参考图「一张卡多端点」的纯派生（规范 §17.2 ①层）────────
// 参考图在运行时本来就是数组（reference-image / -2 / -3 各是一张图的槽位），
// 但编辑页过去「一卡一端点」，用户要连多张图只能到模式契约页手动加槽。
// 本文件只做派生：哪些 id 是参考图槽、哪些槽已连过线、连上之后该长出的下一个槽。
// 视图层不在这里碰 React / 网络；落点写入仍走 useParamWiring 的既有通道。

import { isPlainRecord } from "~/lib/is-record";
import { exposedClassOf, referenceImageSlotIndex } from "~/lib/workflow/workflow-exposed-params";
import { MODE_KEY_PREFIX } from "~/lib/workflow/workflow-param-mapping";
import {
  isModeContractInputId,
  nextReferenceImageId,
  type ModeContract,
} from "~/lib/workshop/model-mode-contract";
import { REFERENCE_IMAGE_MAX } from "~/components/workshop/hooks/use-reference-image-group";

/** 槽位序号：第一张不带序号，按 1 算（与 -2 / -3 连续）。 */
function slotOf(id: string): number {
  const slot = referenceImageSlotIndex(id);
  return slot === 0 ? 1 : slot;
}

/** 一串契约 id 里所有参考图槽位，按槽位序号升序（第一张在前）。 */
export function referenceImageSlotIds(ids: ReadonlyArray<string>): Array<string> {
  /* filter 已经返回新数组，不再 slice（unicorn/prefer-spread 清零规则）。 */
  return ids
    .filter((id) => exposedClassOf(id) === "reference-image")
    .sort((a, b) => slotOf(a) - slotOf(b));
}

/** 当前模式下**连过线**的参考图槽位 id（从 paramMap 的 source 命名空间读）。
 *
 *  已连过的槽即使在契约里被删掉也要继续显示：否则画布上那条线指向一个不存在的
 *  卡片端点，用户既看不到也断不掉。 */
export function wiredReferenceSlotIds(
  paramMap: Record<string, unknown> | null | undefined,
  mode: string | null | undefined,
): Array<string> {
  if (mode === null || mode === undefined || mode === "" || !isPlainRecord(paramMap)) {
    return [];
  }
  const source = paramMap.source;
  if (!isPlainRecord(source)) {
    return [];
  }
  const bucket = source[`${MODE_KEY_PREFIX}${mode}`];
  if (!isPlainRecord(bucket)) {
    return [];
  }
  return referenceImageSlotIds(Object.keys(bucket));
}

/** 连上一条参考图线之后该长出的下一个端点 id；非参考图 / 已到上限返回 null。 */
export function nextReferenceSlotAfterConnect(args: {
  entryId: string;
  /** 当前已知的全部契约 id（含本地刚追加、尚未落契约的槽）。 */
  knownIds: ReadonlyArray<string>;
}): string | null {
  if (exposedClassOf(args.entryId) !== "reference-image") {
    return null;
  }
  /* 这些 id 本来就来自契约清单（modeContractEntries），用契约自己的守卫收窄，
   * 不做「字符串断言成 ModeContractInputId」那种跳过校验的强转。 */
  const known = referenceImageSlotIds(args.knownIds).filter(isModeContractInputId);
  const next = nextReferenceImageId(known);
  return slotOf(next) <= REFERENCE_IMAGE_MAX ? next : null;
}

/** 把新槽位写进该模式的契约（返回**整份**契约表供 `modeContractsSave` 落差集）。
 *
 *  自动长出的端点不能只活在编辑页：运行期按契约口建值、按契约 id 解析落点，
 *  契约里没有这个槽，画出来的线就不会带值。返回 null = 已存在 / 槽位不合法，
 *  调用方据此跳过写入，避免每连一次线都白存一遍。 */
export function withReferenceSlotInContracts(args: {
  contracts: ReadonlyArray<ModeContract>;
  /** 该模式当前生效的全部口（没有本机覆盖时用它构造一条完整覆盖）。 */
  fallbackInputs: ReadonlyArray<string>;
  mode: string;
  slot: string;
}): Array<ModeContract> | null {
  const slot = args.slot;
  if (!isModeContractInputId(slot)) {
    return null;
  }
  const existing = args.contracts.find((item) => item.mode === args.mode);
  const inputs = existing?.inputs ?? args.fallbackInputs.filter(isModeContractInputId);
  if (inputs.includes(slot)) {
    return null;
  }
  if (existing !== undefined) {
    return args.contracts.map((item) =>
      item.mode === args.mode ? { ...item, inputs: [...item.inputs, slot] } : item,
    );
  }
  return [...args.contracts, { mode: args.mode, inputs: [...inputs, slot] }];
}
