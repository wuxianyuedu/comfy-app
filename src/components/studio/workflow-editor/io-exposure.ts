/* IO 暴露条目的显示名派生 —— 纯函数，无 React、无副作用。
 *
 * 名字只有一个来源、一条规则：
 *   ① 作者在 IO 面板里重命名过（`WorkflowIOEntry.label`，**唯一**写入点是
 *      `setIOLabel`）—— 这是唯一的「作者命名」，最高优先；
 *   ② 否则用富化链给出的名字（`ioLabel`：作者 label → 子图内部业务名 →
 *      localized → pin 名），由服务端按 raw 图解析；
 *   ③ 富化也没有时退到真实 pin 名。
 *
 * 勾选那一刻画布透传的名字**不进库**（`toggleIO` 只记身份字段）：它本来就是
 * 画布从同一个 raw 槽位读出来的显示名，抄一份下来只会在两处口径不一致时固化
 * 出一个陈旧名字（`value_1`）。显示名因此只在前端这一处算，后端只认 pin 名与
 * 事实字段 —— ISSUE #349 的整条「机器名让位 / 清洗」链随此删除：库里带
 * `label` 的条目从此一律按「作者重命名」直读（`setIOLabel` 传空串即可清掉）。 */
import {
  ioLabel,
  type WorkflowIOEntry,
} from "~/components/studio/shared/workflow-io";
import { sanitizeComboLabel } from "~/components/studio/workflow-utils";

/** 本地勾选态在显示名上真正携带的字段（作者的显式重命名 + 画布透传的类型，
 *  后者缺省时不该把富化类型盖掉）。 */
export interface ExposedLabelSource {
  label?: string;
  type?: string;
}

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
 *  本地字段（label / value / required / seedMode / modes…）整体覆盖在富化
 *  结果之上——本地才是作者编辑态的唯一事实源；只有 `label` 需要额外兜住
 *  「本地没重命名过」的情形（此时取富化名，没有富化名再回退原始 pin 名）。
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
 *
 *  IO 预览面板的数据源是服务端富化的 `detail.workflowIO`。下钻到子工作流
 *  后，详情响应里没有这份富化（子图路由不产出 workflowIO：它按整份工作流
 *  的下标打键，带进内层视图会误伤顶层未保存的编辑）——面板只能回落到本地
 *  存的 label，于是没被重命名过的条目会显示成原始槽位名。
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
    | undefined,
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
        ...(input.multiline !== undefined
          ? { multiline: input.multiline }
          : {}),
        ...(value !== undefined ? { defaultValue: value } : {}),
        ...(node.class_type ? { classType: node.class_type } : {}),
      };
    }
  }
  return out;
}
