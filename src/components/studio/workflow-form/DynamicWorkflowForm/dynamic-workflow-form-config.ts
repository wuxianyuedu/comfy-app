// DynamicWorkflowForm 的公开契约与行派生规则。
// 纯类型 + 纯函数（无 React、无副作用）：hook 据此派生行数据，视图只负责渲染。

import type { ReactNode } from "react";

import type {
  ControlKind,
  EnrichedWidget,
  WorkflowIOMap,
} from "~/components/studio/workflow-io";

export interface DynamicWorkflowFormProps {
  /** 来自 GET /api/workflows/[id] 的富化 workflowIO 表。 */
  io: WorkflowIOMap | null | undefined;
  /** 当前取值，按 ioKey 索引。 */
  values: Record<string, unknown>;
  /** 接收完整的新值表（状态归调用方所有）。 */
  onChange: (next: Record<string, unknown>) => void;
  loading?: boolean;
  disabled?: boolean;
  /** 更紧的间距 + 单列，适配 300px 宽的画布节点。 */
  compact?: boolean;
  /** 在输入下方渲染「此工作流输出」条。 */
  showOutputs?: boolean;
  /** 覆盖工作流没有暴露输入针脚时显示的提示。 */
  emptyHint?: ReactNode;
  /** 设置后，每个输入行的标签变成可点击编辑（铅笔图标 →
   *  点击 → 内联 <input> → blur / Enter 提交）。新标签写进
   *  `workflowIO[key].label`，其中 `key` 是 ioKey —— 这是
   *  IO 编辑预览面板的 UX：作者看到表单最终长什么样，
   *  并能就地重命名每个针脚。 */
  onLabelChange?: (ioKey: string, label: string) => void;
  /** 设置后，每个 widget 行在标签旁得到「必填 / 可选」切换按钮。
   *  点击它翻转 `workflowIO[ioKey].required`。仍为空的必填
   *  行会把输入渲染成红边框，逼作者面对 —— 这是
   *  IO 编辑模式下 `onLabelChange` 的对应物。 */
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  /** IO 编辑态：每行渲染 👁 切换「该参数在 visibilityMode 模式下是否可见」，
   *  写入 `workflowIO[ioKey].modes[visibilityMode].visible`（按模式保留）。
   *  visibilityMode 为空（无模式）时不渲染。 */
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
  /** IO 编辑预览置 true：隐藏行不过滤、置灰呈现（作者靠 👁 恢复显示）。 */
  showHiddenInMode?: boolean;
  /** 仅画布：每针脚的 seed「生成后控制」模式，按
   *  ioKey 索引。在类 seed 的 int 行上渲染成可点击的章，让用户
   *  不离开节点就能选 固定 / 递增 / 递减 / 随机。
   *  模式值经 onSeedModeChange 上抛。 */
  seedModes?: Record<string, string>;
  onSeedModeChange?: (ioKey: string, mode: string) => void;
  /** 设置后，渲染列表里的行变成可拖拽重排：作者
   *  用拖拽把手拎起一行，放到另一行上，就插到它
   *  之前。回调收到
   *  `(fromKey, beforeKey | null)`，其中 `beforeKey === null` 表示「送到
   *  同组末尾」。消费方（通常是 IO 编辑
   *  预览面板）负责重排 `displayOrder` 序号并
   *  落盘 —— 这里只发意图，好让本组件不背
   *  持久化的包袱。不传 = 行不可拖
   *（只读场景如 CreatePanel、WorkflowLibrary、画布的
   *  `workflow` 节点）。 */
  onReorder?: (fromKey: string, beforeKey: string | null) => void;
  /** 宿主工作流 id —— 把用户选的分组填写范式
   *（分别填写 ⇄ 比例+清晰度 / 时长+画质+比例）限定在 localStorage 作用域，好让
   *  这个偏好扛过重新加载。省略则回落到按浏览器的
   *  全局 key。 */
  workflowId?: string;
  /** 多模式：当前模式码。传入后表单只渲染该模式下
   *  `visible !== false` 的参数行；默认值由调用方用
   *  `defaultInputValues(io, mode)` 播种，走「模式默认值 → 通用默认值」
   *  两级回退。不传（null/undefined）= 不分模式，与旧行为一致。 */
  mode?: string | null;
  /** 上传失败时把可读原因交给调用方渲染（「正在启动 ComfyUI…」「启动超时…」）。
   *  上传位没有自己的错误区，只记 console 的话用户看不到失败原因，
   *  也拿不到「去设置页手动启动」这条出口（ISSUE #345）。 */
  onUploadError?: (message: string) => void;
  /** 上传被 ComfyUI 未就绪挡住、正在等待启动时回调一次，供调用方显示进行态。 */
  onUploadProgress?: (message: string) => void;
  /** 行尾附加的只读徽标（工作流库画布节点用它标出每个参数连到的「对外参数」）。
   *  缺省不渲染：画布节点 / CreatePanel / 表单预览的观感一律不变。 */
  rowTrailing?: (entry: EnrichedWidget) => ReactNode;
}
/** ComfyUI 里渲染成可连接端口行而不是通用
 *  widget 行的类型，好让它们保持画布的单行 33h 布局（由
 *  `WirePortRows` 注入 SeedModeButton）。
 *  这些类型同时用于数值校验。 */
const NUMERIC_TYPES = new Set(["INT", "FLOAT", "NUMBER"]);

export function isNumericWidget(entry: EnrichedWidget): boolean {
  return NUMERIC_TYPES.has((entry.type ?? "").toUpperCase());
}
/** 后端类型缺失 / 未知时，回落到与实际渲染的控件相匹配
 *  的章，好让徽标对该行
 *  编辑语义的标注保持诚实
 *（如 textarea → STRING 而不是 INT）。 */
export function controlTypeFallback(control: ControlKind): string {
  switch (control) {
    case "textarea":
    case "text":
    case "select":
      return "STRING";
    case "int":
      return "INT";
    case "float":
      return "FLOAT";
    case "switch":
      return "BOOLEAN";
    case "image":
      return "IMAGE";
    case "link":
      return "*";
    default:
      return "INT";
  }
}
