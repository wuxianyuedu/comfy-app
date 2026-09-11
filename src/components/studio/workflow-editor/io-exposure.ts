/* IO 暴露条目的显示名派生 —— 纯函数，无 React、无副作用。
 *
 * 工作流编辑器里同一个 pin 有三个层级的「名字」：
 *   ① 服务端富化 label（workflow-detail-io 的 label → localized → name 回退链）
 *   ② 画布勾选那一刻写进本地 workflowIO 的 label（IoCheckbox 的 ioRef.label）
 *   ③ 真正的 ComfyUI pin 名（entry.name）
 *
 * ① 只在「服务端能把这个 pin 解析回原始节点」时才等于 ③（例如普通节点的
 * `seed`）。带子工作流的封装节点（class_type 为 UUID）的暴露口是包装层
 * 自己的槽位名，子工作流内部节点拿不到对应字段，富化于是回退成 ③ 之外
 * 的姿势——画布上显示 `seed`（ioRef 传来的业务名），IO 面板里却变成
 * `value_1`，用户看到两处对不上、还改不动。
 *
 * 因此显示名以 ②（本地 label）为准：它就是画布上作者认得的那个名字，
 * 未被重命名时也是 IO 面板重命名框里显示的名字；缺失时才依次回退 ① → ③。 */
import { ioLabel, type WorkflowIOEntry } from "~/components/studio/shared/workflow-io";
import { sanitizeComboLabel } from "~/components/studio/workflow-utils";

/** 本地勾选态在显示名上真正携带的字段（`toggleIO` 写入的 label +
 *  画布勾选时透传的类型，后者缺省时不该把富化类型盖掉）。 */
export interface ExposedLabelSource {
  label?: string;
  type?: string;
}

/** 本地存的名字是不是「机器生成的原始槽位名」。
 *
 *  勾选那一刻会把画布上的显示名写进本地 `label`；修复前某些路径写进去的其实
 *  就是原始槽位名（封装节点的别名 `value_1`、普通节点的 pin 名 `image`）。
 *  它只是**显示名**，不是作者的命名 —— 作者手写一个与 pin 名逐字相同的名字
 *  几乎不可能，判定成本很低。
 *
 *  `aliasBase` 是同一份事实源（服务端富化 / 视图就地派生）下发的「该条目现在
 *  的原始槽位名」，只有它才是判定基准：本地条目的 `name` 在加载时已被解析成
 *  显示名，拿它比对会把真名字误判成别名、也会把别名漏判。基准缺失（富化还没到）
 *  时一律不判定，宁可留着旧值也不误删作者命名。
 *
 *  但基准**不能只是 pin 名**。判定要回答的问题是「作者到底有没有重命名过」，
 *  而同一个 pin 有三种可能的名字：
 *    ① 富化名（`enrichedLabel`，取自作者命名 → 子图内部业务名 → 本层
 *       label/localized → 别名）；
 *    ② 本层槽位上作者写的名字（`slotLabel`，仅当它与槽位名不同才算数）；
 *    ③ 别名本身（= 基准）。
 *  只看 ③ 会漏判 `value_1` 这类同名条目：判据是「本地存的就是别名本身」，
 *  不是「本地存的恰好等于某个别名」——把别名与 ③ 比对等于什么都没判，条目会
 *  被当成作者命名留下，写入时再把那串机器名固化回库（ISSUE #349 的复现路径）。
 *  所以判据收敛成：**本地存的这串，是富化能如实改写成另一个名字的名字**。 */
export function isStaleExposedAlias(
  label: string | undefined,
  aliasBase: string | undefined,
  enrichedLabel?: string,
  slotLabel?: string
): boolean {
  if (label === undefined || aliasBase === undefined) return false;
  const clean = (value: string | undefined) => sanitizeComboLabel(value);
  const local = clean(label);
  const base = clean(aliasBase);
  if (!local || !base) return false;
  const name = clean(enrichedLabel);
  const slot = clean(slotLabel);
  /* 富化名与别名不同 → 富化确实知道一个更好的名字。本地存的正是别名本身时让位；
   *  本地存的已经是那个更好的名字（富化名）时什么都不用动。 */
  if (name && name !== base) return local === base;
  /* 富化名仍是别名（本层确实没写作者名），但本层槽位给了另一个作者业务名
   *  （富化链把它排在 localized 之后，够不着）——本地存的是别名本身时同样让位。 */
  if (slot && slot !== base) return local === base;
  /* 两个来源都只有别名：本地这串与富化名一致，无从判定它不是作者命名，留着。 */
  return false;
}

/** 一个已暴露条目的显示名，与画布上该 pin 的标签逐字一致：
 *  本地 label（画布勾选时透传）→ 服务端富化名 → 原始 pin 名。
 *
 *  两处都过一遍 `sanitizeComboLabel`：画布（WorkflowNode /
 *  WorkflowSubgraphNode）渲染 pin 标签时就会剥掉 COMBO 候选串，IO 面板若
 *  用原文，同一个 pin 又会以两种写法出现——本次要消灭的正是这类「对不上」。 */
export function resolveExposedLabel(
  local: ExposedLabelSource | undefined | null,
  enriched: WorkflowIOEntry | undefined | null,
  fallbackName: string
): string {
  const localLabel = sanitizeComboLabel(local?.label);
  const enrichedLabel = enriched ? sanitizeComboLabel(ioLabel(enriched)) : "";
  /* 存量别名：勾选那一刻写进本地 label 的是「画布显示名」。修复前封装节点
   *  的显示名恰好是 ComfyUI 自动编号的槽位别名（`value_1`），于是本地 label
   *  里躺着一串机器生成的名字。它等于原始 pin 名、且与服务端富化名不同时，
   *  视为「没重命名过」——取富化名（作者 label → 内部字段 → 本层 label），
   *  否则用户重开工作流仍会看到旧的 `value_1` 把修复后的名字压回去
   *  （ISSUE #349）。作者手写的名字几乎不可能与机器别名逐字相同，不会误伤。 */
  if (localLabel) {
    const isStaleAlias = isStaleExposedAlias(localLabel, fallbackName, enrichedLabel);
    if (!isStaleAlias) return localLabel;
  }
  if (enrichedLabel) return enrichedLabel;
  return localLabel || fallbackName;
}

/** 把本地勾选态与服务端富化条目合并成 IO 编辑面板用的条目：
 *  本地字段（label / value / required / seedMode / modes…）整体覆盖在富化
 *  结果之上——本地才是作者编辑态的唯一事实源；只有 `label` 需要额外兜住
 *  「本地没重命名过」的情形（此时取富化名，没有富化名再回退原始 pin 名）。
 *  `type` 单独处理：本地缺省时保留富化类型，否则控件会从 select 退化成文本框。 */
export function mergeExposedEntry<T extends WorkflowIOEntry>(
  local: ExposedLabelSource & Partial<WorkflowIOEntry> | undefined | null,
  enriched: T
): T {
  return {
    ...enriched,
    ...local,
    label: resolveExposedLabel(local, enriched, enriched.name),
    type: local?.type ?? enriched.type,
  };
}

/** 本地条目的别名判定基准（ioKey → 该条目现在的原始槽位名 + 本层作者名）。
 *
 *  两个字段都来自富化（或视图就地派生的同一份事实源），缺一不可：
 *    · `name`      原始槽位名 —— 判定「本地存的是不是那串机器名」的基准；
 *    · `slotLabel` 本层槽位上作者写的名字（无则缺省）—— 富化链把它排在
 *      `localized` 之后，够不着，但它足以说明本层槽位确实有作者命名，
 *      是「本地这串要不要让位」的第二判据（见 isStaleExposedAlias）。 */
export interface ExposedAliasBase {
  name: string;
  /** 富化链现在给这个条目的显示名（作者命名 → 子图内部业务名 → 本层
   *  label/localized → 别名）。与 `name` 不同 = 富化确实知道一个更好的名字，
   *  本地存着那串机器名时应当让位。 */
  enrichedLabel?: string;
  /** 本层槽位上作者写的名字（与槽位名不同才有值）。富化链把它排在
   *  `localized` 之后够不着，但它足以说明本层确实有作者命名。 */
  slotLabel?: string;
}

/** 视图内节点元数据 → 可当「服务端富化」用的最小 IO 表（纯函数）。
 *
 *  IO 预览面板的数据源是服务端富化的 `detail.workflowIO`。下钻到子工作流
 *  后，详情响应里没有这份富化（子图路由不产出 workflowIO：它按整份工作流
 *  的下标打键，带进内层视图会误伤顶层未保存的编辑）——面板只能回落到本地
 *  存的 label，于是修复前落库的槽位名/别名（`value_1`）会一直显示（ISSUE #349）。
 *
 *  子图详情的 `nodes[].raw_inputs[]` 里本来就带着内部节点的真实 label /
 *  localized / type，这里就地派生一份，让内层视图与顶层视图的取名口径一致。
 *  只补「服务端富化查不到」的字段，不覆盖已有值。 */
export function enrichFromViewNodes(
  nodes:
    | {
        id: string;
        class_type?: string;
        raw_inputs?: {
          name: string;
          label?: string;
          localized?: string;
          type?: string;
          defaultValue?: unknown;
          multiline?: boolean;
          widgetValue?: unknown;
        }[];
      }[]
    | null
    | undefined
): Record<string, WorkflowIOEntry> {
  const out: Record<string, WorkflowIOEntry> = {};
  for (const node of nodes ?? []) {
    if (!node?.id) continue;
    for (const input of node.raw_inputs ?? []) {
      if (!input?.name) continue;
      const label =
        sanitizeComboLabel(input.label) ||
        sanitizeComboLabel(input.localized) ||
        input.name;
      const value = input.defaultValue ?? input.widgetValue;
      out[`${node.id}::widget::${input.name}`] = {
        direction: "input",
        kind: "widget",
        nodeId: node.id,
        name: input.name,
        label,
        type: input.type ?? "*",
        ...(input.multiline !== undefined ? { multiline: input.multiline } : {}),
        ...(value !== undefined ? { defaultValue: value } : {}),
        ...(node.class_type ? { classType: node.class_type } : {}),
      };
    }
  }
  return out;
}
