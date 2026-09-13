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
  /** 该对外参数包含的端口（被组合控件接管的端口已剔除）。 */
  pins: ParamEntry["pins"];
  /** 卡片右侧的**输出端口**（提示词 → STRING）—— 一个候选一颗圆点。
   *  类型跟着当前落点走；未连线时逐个列出候选。 */
  outputPorts: readonly ParamOutputPort[];
  /** 卡片宽度（须与 placeParamNodes 的几何常量一致）。 */
  width: number;
  /** 卡片是否可以连线。编辑器画布上恒为 true —— 卡片就是接线面板，没有模式也
   *  能拖线（模式只决定这条线归属哪个命名空间）。 */
  canWire: boolean;
  /** 当前模式下这条线是默认线还是作者改过的线（卡片页脚明说）。 */
  wireManual: boolean;
  /** 该对外参数在当前模式下是否已经落到宿主卡片的某一行（页脚依据）。
   *  只连上一颗端点时页脚不许写「没有可连的端口」。 */
  wired: boolean;
  /** 当前模式下是否画过线（决定「恢复默认」是否可用）。 */
  canReset: boolean;
  /** 「恢复默认」：撤销该对外参数在当前模式下的线。 */
  onReset: () => void;
}

/** 画布上「对外**输出**参数节点」的 data 契约（纯类型）。
 *
 *  与输入卡片对称但语义相反：输入卡片说「这个对外参数**喂给**哪一行」，输出卡片说
 *  「这个对外产出**从**哪一行读」。连线方向因此是「宿主输出行 → 卡片圆点」，落点
 *  覆盖写在 `paramMap.output.mode:<模式>`（与输入的 `source` 不是同一张表）。 */
export interface WorkflowOutputNodeData extends Record<string, unknown> {
  /** 输出口的 ioKey（`<nodeId>::output::<name>`）—— 它同时是落点覆盖表的键。 */
  outputIoKey: string;
  /** 宿主节点（该输出来自哪个节点）。 */
  hostNodeId: string;
  /** 卡片标题（作者改过名用作者的名字，否则「输出」）。 */
  label: string;
  /** 端口自身的名字（名字与标题相同时只画一行）。 */
  portName: string;
  /** 端口声明的类型（IMAGE / VIDEO / STRING…）。 */
  portType: string;
  width: number;
  /** 当前是否可连线（没有模式时写入无归属，端点不渲染）。 */
  canWire: boolean;
  /** 作者在这个模式下改过它的取值行（页脚与「恢复默认」可用性依据）。 */
  wireManual: boolean;
  /** 当前是否有取值来源（`false` = 作者显式断开 / 落点已不存在）。 */
  wired: boolean;
  canReset: boolean;
  onReset: () => void;
}
