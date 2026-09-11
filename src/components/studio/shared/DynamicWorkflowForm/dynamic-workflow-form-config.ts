// DynamicWorkflowForm 的公开契约与行派生规则。
// 纯类型 + 纯函数（无 React、无副作用）：hook 据此派生行数据，视图只负责渲染。

import type { ReactNode } from "react";

import type {
  ControlKind,
  EnrichedWidget,
  WorkflowIOMap,
} from "~/components/studio/shared/workflow-io";

export interface DynamicWorkflowFormProps {
  /** Enriched workflowIO map from GET /api/workflows/[id]. */
  io: WorkflowIOMap | null | undefined;
  /** Current values, keyed by ioKey. */
  values: Record<string, unknown>;
  /** Receives the full next value map (caller owns the state). */
  onChange: (next: Record<string, unknown>) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Tighter spacing + single column, for the 300px-wide canvas node. */
  compact?: boolean;
  /** Render the "此工作流输出" strip below the inputs. */
  showOutputs?: boolean;
  /** Override the hint shown when the workflow exposes no input pins. */
  emptyHint?: ReactNode;
  /** When set, each input row's label becomes click-to-edit (pencil icon →
   *  click → inline <input> → blur / Enter commits).  The new label is
   *  written into `workflowIO[key].label`, where `key` is the ioKey — the
   *  IO-edit preview panel's UX: the author sees exactly what the form will
   *  look like and can rename each pin in-place. */
  onLabelChange?: (ioKey: string, label: string) => void;
  /** When set, every widget row gets a "必填 / 可选" toggle button next to
   *  the label.  Clicking it flips `workflowIO[ioKey].required`.  Required
   *  rows that are still empty render the input with a red border to keep
   *  the author honest — the IO-edit-mode counterpart of `onLabelChange`. */
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  /** IO 编辑态：每行渲染 👁 切换「该参数在 visibilityMode 模式下是否可见」，
   *  写入 `workflowIO[ioKey].modes[visibilityMode].visible`（按模式保留）。
   *  visibilityMode 为空（无模式）时不渲染。 */
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
  /** IO 编辑预览置 true：隐藏行不过滤、置灰呈现（作者靠 👁 恢复显示）。 */
  showHiddenInMode?: boolean;
  /** Canvas-only: per-pin seed "control after generate" mode, keyed by
   *  ioKey.  Rendered as a clickable chip on seed-like int rows so the user
   *  can pick fixed / increment / decrement / random without leaving the
   *  node. */
  seedModes?: Record<string, string>;
  onSeedModeChange?: (ioKey: string, mode: string) => void;
  /** When set, rows in the rendered list become drag-to-reorder: the author
   *  picks up a row by its drag handle and drops it onto another row to
   *  insert immediately before it.  The callback receives
   *  `(fromKey, beforeKey | null)`, where `beforeKey === null` signals "send
   *  to the tail of the same group".  The consumer (typically the IO-edit
   *  preview panel) is responsible for renumbering `displayOrder` and
   *  persisting — we only emit the intent here so this component stays free
   *  of persistence concerns.  Not provided = rows are non-draggable
   *  (read-only surfaces like CreatePanel, WorkflowLibrary, canvas
   *  `workflow` node). */
  onReorder?: (fromKey: string, beforeKey: string | null) => void;
  /** Owning workflow id — scopes the user's chosen group fill-paradigm
   *  (分别填写 ⇄ 比例+清晰度 / 时长+画质+比例) in localStorage so the
   *  preference survives reloads.  Omit to fall back to a per-browser
   *  global key. */
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

/** ComfyUI types that render as connectable port rows instead of generic
 *  widget rows, so they keep the canvas' single-line 33h layout (with
 *  SeedModeButton injected by `WirePortRows`). */
const NUMERIC_TYPES = new Set(["INT", "FLOAT", "NUMBER"]);

export function isNumericWidget(entry: EnrichedWidget): boolean {
  return NUMERIC_TYPES.has((entry.type ?? "").toUpperCase());
}

/** When the backend type is missing/unknown, fall back to a chip that matches
 *  the control we actually render so the badge stays honest about the row's
 *  edit semantics (e.g. textarea → STRING instead of INT). */
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
