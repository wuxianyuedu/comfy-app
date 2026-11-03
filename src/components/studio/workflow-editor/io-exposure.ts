/* IO 暴露条目的显示名派生 —— 纯函数，无 React、无副作用。名字只有一个来源、一条规则：
 * ① 作者重命名过（`WorkflowIOEntry.label`，**唯一**写入点 `setIOLabel`）；② 否则用富化链
 * （`ioLabel`：作者 label → 子图内部业务名 → localized → pin 名）；③ 否则真实 pin 名。
 * 勾选时画布透传的名字**不进库**（只记身份字段），抄一份只会在口径不一致时固化成陈旧
 * 名字（`value_1`）。ISSUE #349 的「机器名让位 / 清洗」链随此删除，带 `label` 一律直读。 */
import { ioLabel, type WorkflowIOEntry } from "~/components/studio/workflow-io";
import { sanitizeComboLabel } from "~/components/studio/workflow-utils";

/** 本地勾选态在显示名上真正携带的字段（作者的显式重命名 + 画布透传的类型，
 *  后者缺省时不该把富化类型盖掉）。 */
export type ExposedLabelSource = {
  label?: string;
  type?: string;
};

/** 一个已暴露条目的显示名：作者重命名 → 富化名 → 真实 pin 名。 */
export function resolveExposedLabel(
  local: ExposedLabelSource | undefined | null,
  enriched: WorkflowIOEntry | undefined | null,
  fallbackName: string,
): string {
  const localLabel = sanitizeComboLabel(local?.label);
  const enrichedLabel = enriched ? sanitizeComboLabel(ioLabel(enriched)) : "";
  return localLabel || enrichedLabel || sanitizeComboLabel(fallbackName);
}

/** 把本地勾选态与服务端富化条目合并成 IO 编辑面板用的条目：
 *  本地字段（label / required / seedMode / modes…）整体覆盖在富化结果之上
 *  ——本地才是作者编辑态的唯一事实源；只有 `label` 需要额外兜住「本地没重命名
 *  过」的情形（此时取富化名，没有富化名再回退原始 pin 名）。
 *  `type` 单独处理：本地缺省时保留富化类型，否则控件会从 select 退化成文本框。 */
export function mergeExposedEntry<T extends WorkflowIOEntry>(
  local: (ExposedLabelSource & Partial<WorkflowIOEntry>) | undefined | null,
  enriched: T,
): T {
  return {
    ...enriched,
    ...local,
    label: resolveExposedLabel(local, enriched, enriched.name),
    type: local?.type ?? enriched.type,
  };
}

/** 视图内节点元数据 → 可当「服务端富化」用的最小 IO 表（纯函数）。
 *  IO 预览的数据源是 `detail.workflowIO`；下钻子图后详情里没有这份富化（子图路由按整
 *  份工作流的下标打键，带进内层会误伤顶层未保存的编辑），面板只能回落到本地 label，
 *  未重命名过的条目会显示成原始槽位名。子图详情的 `nodes[].raw_inputs[]` 本就带真实
 *  label / localized / type，这里就地派生、只补查不到的字段，不覆盖已有值。 */
export function enrichFromViewNodes(
  nodes:
    | Array<{
        class_type?: string;
        id: string;
        raw_inputs?: Array<{
          defaultValue?: unknown;
          label?: string;
          localized?: string;
          multiline?: boolean;
          name: string;
          type?: string;
          widgetValue?: unknown;
        }>;
      }>
    | null
    | undefined,
): Record<string, WorkflowIOEntry> {
  const out: Record<string, WorkflowIOEntry> = {};
  for (const node of nodes ?? []) {
    // oxlint-disable-next-line no-unnecessary-condition -- nodes 来自子图详情响应（JSON.parse 断言），脏数据可能缺 id
    if (!node?.id) {
      continue;
    }
    for (const input of node.raw_inputs ?? []) {
      // oxlint-disable-next-line no-unnecessary-condition -- node.raw_inputs 是服务端原样负载，元素可能缺 name
      if (!input?.name) {
        continue;
      }
      const label =
        sanitizeComboLabel(input.label) || sanitizeComboLabel(input.localized) || input.name;
      const value = input.defaultValue ?? input.widgetValue;
      out[`${node.id}::widget::${input.name}`] = {
        direction: "input",
        kind: "widget",
        nodeId: node.id,
        name: input.name,
        label,
        type: input.type ?? "*",
        ...(input.multiline === undefined ? {} : { multiline: input.multiline }),
        ...(value === undefined ? {} : { defaultValue: value }),
      };
    }
  }
  return out;
}
