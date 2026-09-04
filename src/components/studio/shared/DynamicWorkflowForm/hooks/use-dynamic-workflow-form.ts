"use client";

// DynamicWorkflowForm 的全部业务逻辑：IO 切分与分组、行拖拽手势、图片上传、
// 值写入。视图层只消费这里返回的 controller，不持有任何业务规则。

import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, RefObject } from "react";

import { uploadImageFile } from "@/lib/project-canvas/canvas-api";
import {
  filterVisibleInMode,
  inferGroups,
  splitWorkflowIO,
  type EnrichedWidget,
  type WorkflowIOEntry,
} from "~/components/studio/shared/workflow-io";
import {
  isNumericWidget,
  type DynamicWorkflowFormProps,
} from "../dynamic-workflow-form-config";

/** 每行的 HTML5 拖拽事件包，由 controller 统一生成后下发给行组件。
 *
 *  刻意没有 onDragLeave：指针在同一行的子元素间移动时它同样会触发，据此清除
 *  高亮会频闪 —— 高亮统一由 dragover / drop / dragend 收敛。 */
export interface RowDragHandlers {
  onDragStart: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export interface DynamicWorkflowFormController {
  /** 当前值表（keyed by ioKey）—— 调用方持有，这里只读透传。 */
  values: Record<string, unknown>;
  /** 整表写入口：GroupedControls 这类批量写入的组件直接用它，`set` 是它的
   *  单键快捷方式。 */
  onChange: (next: Record<string, unknown>) => void;
  /** 全量输入（wire + widget），按 displayOrder 稳定排序。 */
  inputs: EnrichedWidget[];
  outputs: (WorkflowIOEntry & { ioKey: string })[];
  wireInputs: EnrichedWidget[];
  widgetInputs: EnrichedWidget[];
  groups: ReturnType<typeof inferGroups>;
  /** 端口行：wire inputs + 数值 widget（已分组的 pin 除外）。 */
  portEntries: EnrichedWidget[];
  /** 可编辑参数行：非数值 widget（已分组的 pin 除外）。 */
  widgetSectionEntries: EnrichedWidget[];
  /** 没有任何输入/输出端点 —— 视图据此渲染空态提示。 */
  isEmpty: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  uploading: boolean;
  uploadTarget: string | null;
  pickFile: (ioKey: string) => void;
  /** 上传是异步的（读文件 + 调接口），但 `<input type=file>` 的 onChange 只
   *  要求 void 返回 —— 调用方不需要 await，失败已在内部记日志。 */
  onFile: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  set: (ioKey: string, value: unknown) => void;
  /** 未开启重排（调用方未传 onReorder）时为 null。 */
  dragHandlers: RowDragHandlers | null;
  draggingKey: string | null;
  dragOverKey: string | null;
  /** 端口行被拿起时回传本 controller —— 端口行自身不持有拖拽状态。 */
  beginPortDrag: (ioKey: string) => void;
  endDrag: () => void;
}

export function useDynamicWorkflowForm(
  props: DynamicWorkflowFormProps
): DynamicWorkflowFormController {
  const { io, values, onChange, onReorder, mode } = props;

  const { wireInputs, widgetInputs, outputs } = useMemo(
    () => splitWorkflowIO(io),
    [io]
  );

  /* 2026-09-03 多模式：按当前模式过滤掉 `visible === false` 的行。
   *  只是展示层过滤——被隐藏的参数仍留在 values 里（调用方用
   *  defaultInputValues(io, mode) 给它播种了模式默认值），所以提交给
   *  ComfyUI 的 payload 不会因为「当前模式不显示」就缺字段。 */
  const shownWireInputs = useMemo(
    () => filterVisibleInMode(wireInputs, mode),
    [wireInputs, mode]
  );
  const shownWidgetInputs = useMemo(
    () => filterVisibleInMode(widgetInputs, mode),
    [widgetInputs, mode]
  );
  const shownOutputs = useMemo(
    () => filterVisibleInMode(outputs, mode),
    [outputs, mode]
  );
  const inputs = useMemo(
    () => [...shownWireInputs, ...shownWidgetInputs],
    [shownWireInputs, shownWidgetInputs]
  );

  /* Coupled widget groups (dimension = width + height; video = length +
   * aspect + quality) are withheld from the generic per-widget rows and
   * rendered by `GroupedControls` instead — a single dropdown switches
   * between 分别填写 and the friendly preset paradigm.  `groupedKeys` is the
   * set of ioKeys the groups consume. */
  const groups = useMemo(() => inferGroups(shownWidgetInputs), [shownWidgetInputs]);
  const { groupedKeys } = groups;

  /* Port rows = wire inputs + numeric widgets (seed/steps/cfg …).  Numeric
   * widgets join them to inherit the connectable single-line layout.
   * Grouped pins are excluded so they never render twice (once here, once
   * in GroupedControls). */
  const portEntries = useMemo(
    () => [
      ...shownWireInputs,
      ...shownWidgetInputs.filter(
        (widgetInput) => isNumericWidget(widgetInput) && !groupedKeys.has(widgetInput.ioKey)
      ),
    ],
    [shownWireInputs, shownWidgetInputs, groupedKeys]
  );

  const widgetSectionEntries = useMemo(
    () =>
      shownWidgetInputs.filter(
        (widgetInput) => !isNumericWidget(widgetInput) && !groupedKeys.has(widgetInput.ioKey)
      ),
    [shownWidgetInputs, groupedKeys]
  );

  /* Drag state is deliberately component-local (not in workflow-io.ts or any
   * context) so a reorder on one surface can't steal drag focus from another
   * form rendered on the same page.  `draggingKey` is the ioKey the user
   * picked up; `dragOverKey` is the row currently under the cursor (paints
   * the insert line).  Both are cleared on drop / dragend so a dropped row
   * never leaves a stale highlight behind. */
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const endDrag = useCallback(() => {
    setDraggingKey(null);
    setDragOverKey(null);
  }, []);

  const beginPortDrag = useCallback((ioKey: string) => {
    setDraggingKey(ioKey);
    setDragOverKey(ioKey);
  }, []);

  const dragHandlers = useMemo<RowDragHandlers | null>(() => {
    if (!onReorder) return null;
    return {
      onDragStart: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => {
        setDraggingKey(ioKey);
        setDragOverKey(ioKey);
        /* Firefox refuses to start a drag unless dataTransfer.setData is
         * called.  The payload is ignored — rows are identified by ioKey via
         * state. */
        try {
          event.dataTransfer.setData("text/plain", ioKey);
          event.dataTransfer.effectAllowed = "move";
        } catch {
          /* Some browsers throw on setData outside a user gesture; safe to ignore. */
        }
      },
      onDragOver: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => {
        if (!draggingKey || draggingKey === ioKey) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dragOverKey !== ioKey) setDragOverKey(ioKey);
      },
      onDrop: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const fromKey = draggingKey;
        endDrag();
        if (!fromKey || fromKey === ioKey) return;
        onReorder(fromKey, ioKey);
      },
      onDragEnd: endDrag,
    };
  }, [onReorder, draggingKey, dragOverKey, endDrag]);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const set = useCallback(
    (ioKey: string, value: unknown) => onChange({ ...values, [ioKey]: value }),
    [values, onChange]
  );

  const pickFile = useCallback((ioKey: string) => {
    setUploadTarget(ioKey);
    fileRef.current?.click();
  }, []);

  const onFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !uploadTarget) return;
      setUploading(true);
      try {
        const name = await uploadImageFile(file);
        set(uploadTarget, name);
      } catch (err) {
        console.error("[DynamicWorkflowForm] upload failed", err);
      } finally {
        setUploading(false);
        setUploadTarget(null);
      }
    },
    [uploadTarget, set]
  );

  return {
    values,
    onChange,
    inputs,
    outputs: shownOutputs,
    wireInputs: shownWireInputs,
    widgetInputs: shownWidgetInputs,
    groups,
    portEntries,
    widgetSectionEntries,
    isEmpty: inputs.length === 0 && shownOutputs.length === 0,
    fileRef,
    uploading,
    uploadTarget,
    pickFile,
    onFile,
    set,
    dragHandlers,
    draggingKey,
    dragOverKey,
    beginPortDrag,
    endDrag,
  };
}
