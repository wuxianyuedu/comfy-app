// 画布「对外参数节点」的 data 契约（纯类型，无 React / 无副作用，§17.2 第①层）。
//
// 放进独立文件是为了让 React Flow 的节点注册表（WorkflowEditorNodes）与渲染
// 组件都能引用它，而不必互相 import —— 注册表被大量模块间接引用，反向依赖会
// 把整棵节点树拖进只用类型的文件里。

import type {
  ParamClass,
  ParamEntry,
  ParamOutputPort,
} from "~/lib/workflow-param-mapping";

export interface WorkflowParamNodeData extends Record<string, unknown> {
  /** 条目 id（`<hostNodeId>|<cls>`）。 */
  entryId: string;
  /** 宿主节点（该对外参数落在哪个节点上）。 */
  hostNodeId: string;
  hostNodeTitle: string;
  cls: ParamClass;
  /** 对外参数名（作者改名优先）。 */
  label: string;
  /** 分类的中文名（提示词 / 宽度 / …），用作悬停提示。 */
  classLabel: string;
  /** 该对外参数包含的端口。 */
  pins: ParamEntry["pins"];
  /** 卡片右侧那个**带类型的输出端口**（提示词 → STRING）。
   *  类型跟着当前落点走；未连线时退到候选端口并标 `*`。 */
  outputPorts: readonly ParamOutputPort[];
  /** 卡片宽度（须与 placeParamNodes 的几何常量一致）。 */
  width: number;
  /** 当前模式是否允许连线（无模式 → 不渲染端点）。 */
  canWire: boolean;
  /** 确实没有模式可归属时的说明（有模式时为 false，卡片不写任何警告）。 */
  noModeHint: boolean;
  /** 当前模式下是否画过线（决定「恢复默认」是否可用）。 */
  canReset: boolean;
  /** 「恢复默认」：撤销该对外参数在当前模式下的线。 */
  onReset: () => void;
}
