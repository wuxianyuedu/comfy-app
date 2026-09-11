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
  if (localLabel) return localLabel;
  if (enriched) return sanitizeComboLabel(ioLabel(enriched)) || fallbackName;
  return fallbackName;
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
