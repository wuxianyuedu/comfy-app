"use client";

// DynamicWorkflowForm 的全部业务逻辑：IO 切分与分组、行拖拽手势、图片上传、
// 值写入。视图层只消费这里返回的 controller，不持有任何业务规则。

import { useFilePicker } from "~/components/ui/file-picker";
import { errorMessage } from "~/lib/error-message";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ComponentType, DragEvent } from "react";

import { uploadImageFile } from "~/lib/project-canvas/canvas-api";
import { readFileAsDataUrl } from "~/lib/file-io";
import {
  filterVisibleInMode,
  inferGroups,
  splitWorkflowIO,
  type EnrichedWidget,
  type WorkflowIOEntry,
} from "~/components/studio/workflow-io";
import { isNumericWidget, type DynamicWorkflowFormProps } from "../dynamic-workflow-form-config";
import type { WorkflowIODropPosition } from "~/components/studio/workflow-types";

/** 在这些可编辑控件上起手不发起拖拽：输入框 / 下拉 / 按钮是「用」的地方，
 *  不是「抓」的地方 —— 行级 draggable 会劫持文本选择与下拉交互；且从这些
 *  控件发起的原生拖拽经常根本不触发 drop（只有 dragend），表现成
 *  「拖了但顺序没变」。用户口径：只能从不可编辑区域拖动。 */
const DRAG_CANCEL_SELECTOR = "input, textarea, select, button, [contenteditable]";

/** 指针在行内的上/下半区决定插入点：上半区 = 插到该行之前，下半区 = 之后。
 *  指示线画在实际插入位置，落点即所见。取不到几何信息（测试桩 / 理论上
 *  的分离节点）时退回 before。 */
const positionOf = (event: DragEvent<HTMLDivElement>): WorkflowIODropPosition => {
  const rect = event.currentTarget?.getBoundingClientRect?.();
  if (!rect || rect.height <= 0) {
    return "before";
  }
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
};

/** 每行的 HTML5 拖拽事件包，由 controller 统一生成后下发给行组件。
 *
 *  刻意没有 onDragLeave：指针在同一行的子元素间移动时它同样会触发，据此清除
 *  高亮会频闪 —— 高亮统一由 dragover / drop / dragend 收敛。 */
export type RowDragHandlers = {
  onDragEnd: () => void;
  onDragOver: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => void;
};

export type DynamicWorkflowFormController = {
  /** 端口行被拿起时回传本 controller —— 端口行自身不持有拖拽状态。 */
  beginPortDrag: (ioKey: string) => void;
  dismissUploadError: () => void;
  draggingKey: string | null;
  /** 未开启重排（调用方未传 onReorder）时为 null。 */
  dragHandlers: RowDragHandlers | null;
  dragOverKey: string | null;
  /** 指示线画在 `dragOverKey` 那一行的上缘还是下缘 —— 与 reorderIO 收到的
   *  `position` 同源，指示线永远画在实际插入位置。 */
  dropPosition: WorkflowIODropPosition;
  endDrag: () => void;
  /** 隐藏图片选择 input 的挂载点（`ui/file-picker`）。 */
  FileInput: ComponentType;
  groups: ReturnType<typeof inferGroups>;
  /** 全量输入（wire + widget），按 displayOrder 稳定排序。 */
  inputs: Array<EnrichedWidget>;
  /** 没有任何输入/输出端点 —— 视图据此渲染空态提示。 */
  isEmpty: boolean;
  /** 用户刚选过这张图时的本地预览地址（data URL）；没有则 undefined，
   *  由控件回退到按值算出的 ComfyUI 代理地址。让「选完就能看到」不依赖 ComfyUI。 */
  localPreviewUrl: (ioKey: string) => string | undefined;
  /** 整表写入口：GroupedControls 这类批量写入的组件直接用它，`set` 是它的
   *  单键快捷方式。 */
  onChange: (next: Record<string, unknown>) => void;
  outputs: Array<WorkflowIOEntry & { ioKey: string }>;
  pickFile: (ioKey: string) => void;
  /** 端口行：wire inputs + 数值 widget（已分组的 pin 除外）。 */
  portEntries: Array<EnrichedWidget>;
  /** 上传是异步的（读文件 + 调接口），但 `<input type=file>` 的 onChange 只
   *  要求 void 返回 —— 调用方不需要 await，失败在这里转成 uploadError。 */
  set: (ioKey: string, value: unknown) => void;
  /** 上传失败的可读原因（未运行 / 启动超时…）；下一次选择文件时清空。
   *  视图据此在表单内渲染提示条——上传位本身没有错误区。 */
  uploadError: string | null;
  uploading: boolean;
  uploadTarget: string | null;
  /** 当前值表（keyed by ioKey）—— 调用方持有，这里只读透传。 */
  values: Record<string, unknown>;
  widgetInputs: Array<EnrichedWidget>;
  /** 可编辑参数行：非数值 widget（已分组的 pin 除外）。 */
  widgetSectionEntries: Array<EnrichedWidget>;
  wireInputs: Array<EnrichedWidget>;
};

export function useDynamicWorkflowForm(
  props: DynamicWorkflowFormProps,
): DynamicWorkflowFormController {
  /* 逐字段取出回调：React Compiler 不接受依赖写成 `props.x` 之外的可选链，
   * 也让 deps 表读起来是具体字段而不是整个 props 对象。 */
  const { onUploadError, onUploadProgress } = props;
  const { io, values, onChange, onReorder, mode } = props;

  /* IO-edit 作者态：行内提供「必填/可选」或 👁 可见性回调时，数值类参数（seed/steps/cfg…）
   * 也要渲染成完整参数行，否则按端口行版式压缩成单行、那套版式从不渲染必填/👁，
   * 作者永远碰不到（seed 挤没的历史根因）。CreatePanel / 画布 workflow 节点等运行期只读表单
   * 不带这些回调，数值行保持紧凑端口行 + SeedMode。
   * rowTrailing 同样按作者态处理：行尾徽标只有完整参数行才渲染得出，否则数值参数漏标。 */
  const isAuthoringEdit = !!(
    props.onRequiredChange ??
    props.onLabelChange ??
    props.onVisibilityChange ??
    props.rowTrailing ??
    onReorder
  );

  const { wireInputs, widgetInputs, outputs } = useMemo(() => splitWorkflowIO(io), [io]);

  /* 多模式：按当前模式过滤 visible === false 的行，只是展示层过滤 —— 被隐藏参数仍留在 values 里
   *（调用方用 defaultInputValues(io, mode) 播种模式默认值），提交 ComfyUI 的 payload 不会缺字段。
   * showHiddenInMode（IO 编辑预览）不过滤：隐藏行置灰呈现，作者靠行内 👁 恢复；否则眼睛跟着消失、改不回来。 */
  const visibilityFilterMode = props.showHiddenInMode ? null : mode;
  const shownWireInputs = useMemo(
    () => filterVisibleInMode(wireInputs, visibilityFilterMode),
    [wireInputs, visibilityFilterMode],
  );
  const shownWidgetInputs = useMemo(
    () => filterVisibleInMode(widgetInputs, visibilityFilterMode),
    [widgetInputs, visibilityFilterMode],
  );
  const shownOutputs = useMemo(
    () => filterVisibleInMode(outputs, visibilityFilterMode),
    [outputs, visibilityFilterMode],
  );
  const inputs = useMemo(
    () => [...shownWireInputs, ...shownWidgetInputs],
    [shownWireInputs, shownWidgetInputs],
  );

  /* 耦合的 widget 组（尺寸 = 宽 + 高；视频 = 时长 +
   * 比例 + 画质）会被挡在通用逐 widget 行之外，
   * 改由 `GroupedControls` 渲染 —— 一个下拉在 分别填写 与
   * 友好预设范式之间切换。`groupedKeys` 是
   * 各组消费的 ioKey 集合。 */
  const groups = useMemo(() => inferGroups(shownWidgetInputs), [shownWidgetInputs]);
  const { groupedKeys } = groups;

  /* 端口行 = 连线输入 + 数值 widget（seed/steps/cfg…），后者并入以继承可连接的单行布局。
   * 已分组针脚排除在外，永不重复渲染（一次这里，一次在 GroupedControls）。
   * IO 编辑作者态下数值 widget 不再并入 —— 改由 widgetSectionEntries 渲染成完整参数行，
   * 否则必填/👁 无从编辑。 */
  const portEntries = useMemo(
    () => [
      ...shownWireInputs,
      ...shownWidgetInputs.filter(
        (widgetInput) =>
          isNumericWidget(widgetInput) && !groupedKeys.has(widgetInput.ioKey) && !isAuthoringEdit,
      ),
    ],
    [shownWireInputs, shownWidgetInputs, groupedKeys, isAuthoringEdit],
  );

  const widgetSectionEntries = useMemo(
    () =>
      shownWidgetInputs.filter(
        (widgetInput) =>
          !groupedKeys.has(widgetInput.ioKey) && (isAuthoringEdit || !isNumericWidget(widgetInput)),
      ),
    [shownWidgetInputs, groupedKeys, isAuthoringEdit],
  );

  /* 拖拽状态刻意留在组件本地（不进 workflow-io.ts 或 context），避免同页另一表单的拖拽焦点被抢。
   * draggingKey = 用户拎起的 ioKey，dragOverKey = 光标所在行（画插入线）；drop/dragend 时清掉，不留陈旧高亮。
   * 被拿起的键同时记在 ref：原生拖拽横跨多个 task，drop 闭包可能来自另一次渲染、读到旧 state；
   * ref 在 dragstart 现场写好、drop 一律以它为准 —— 否则「拖完什么都没发生」（ISSUE #349）。
   * state 仍保留：插入指示线/半透明行靠它触发重渲。 */
  const dragFromRef = useRef<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<WorkflowIODropPosition>("before");

  const beginDrag = useCallback((ioKey: string) => {
    dragFromRef.current = ioKey;
    setDraggingKey(ioKey);
    setDragOverKey(ioKey);
  }, []);

  const endDrag = useCallback(() => {
    dragFromRef.current = null;
    setDraggingKey(null);
    setDragOverKey(null);
    setDropPosition("before");
  }, []);

  /* 事件目标所在的行：`data-io-key` 挂在每一行的行锚点上（参数行与端口行
   *  都带），而原生事件的目标常常是行内的某个子元素（标签按钮、输入框）。 */
  const rowKeyOf = useCallback((target: EventTarget | null): string | null => {
    const el = target instanceof HTMLElement ? target : null;
    return el?.closest<HTMLElement>("[data-io-key]")?.dataset.ioKey ?? null;
  }, []);

  /* 端口行（wire / 数值行）与参数行共用一套拖拽状态：端口行把
   *  dragstart / dragend 上抛，真正被拿起的键与高亮都记在这里。 */
  const beginPortDrag = beginDrag;

  const dragHandlers = useMemo<RowDragHandlers | null>(() => {
    if (!onReorder) {
      return null;
    }
    return {
      onDragStart: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => {
        /* 输入框 / 下拉 / 按钮上起手不拖（用户口径：只能从不可编辑区域拖动）
         *  —— preventDefault 直接取消这次拖拽。 */
        /* SAFETY: 类型断言已复核 */
        const target = event.target as HTMLElement | null;
        if (target?.closest?.(DRAG_CANCEL_SELECTOR)) {
          event.preventDefault();
          return;
        }
        /* 起手行以**事件目标所在的那一行**为准：行级 draggable 下目标通常是
         *  行内子元素（标签按钮），bind 进来的 ioKey 是渲染时那一次的闭包值，
         *  可能与用户实际抓住的行不一致。取不到才退回 bind 值。 */
        beginDrag(rowKeyOf(event.target) ?? ioKey);
        /* Firefox 不调 dataTransfer.setData 就拒绝开始拖拽。
         * Payload 只给原生拖拽一个「有内容」的凭据 —— 真正的来源键
         * 以上面的 ref 为准（见 dragFromRef 注释）。 */
        try {
          event.dataTransfer.setData("text/plain", ioKey);
          event.dataTransfer.effectAllowed = "move";
        } catch {
          /* 有些浏览器在用户手势之外调 setData 会抛异常；忽略即可。 */
        }
      },
      onDragOver: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => {
        const fromKey = dragFromRef.current;
        if (!fromKey || fromKey === ioKey) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dragOverKey !== ioKey) {
          setDragOverKey(ioKey);
        }
        const pos = positionOf(event);
        if (dropPosition !== pos) {
          setDropPosition(pos);
        }
      },
      onDrop: (ioKey: string) => (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        /* 来源一律取**起手那一刻记下的键**（ref）。落点行以事件目标为准，
         *  两者相同即「拖回原地」，不动数据。插入点以松手时指针所在的
         *  半区为准，与指示线一致。 */
        const fromKey = dragFromRef.current;
        const toKey = rowKeyOf(event.target) ?? ioKey;
        const pos = positionOf(event);
        endDrag();
        if (!fromKey || fromKey === toKey) {
          return;
        }
        onReorder(fromKey, toKey, pos);
      },
      onDragEnd: endDrag,
    };
  }, [onReorder, dragOverKey, dropPosition, endDrag, beginDrag, rowKeyOf]);

  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /* 上传失败的原因（可读文案）：此前只在 console 留一行，表单里没有任何
   * 出口，用户看到的是「点了没反应 / 图片没进来」（ISSUE #345）。 */
  const [uploadError, setUploadError] = useState<string | null>(null);
  const dismissUploadError = useCallback(() => {
    setUploadError(null);
  }, []);
  /* 本地图片预览（ioKey → data URL）：选完立刻显示，不依赖 ComfyUI 上传成功或
   * 是否运行。上传失败 / 未启动时值不会回填，但用户选的那张图仍应看得见。 */
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const set = useCallback(
    (ioKey: string, value: unknown) => {
      /* 清空某格 → 撤掉它的本地预览，避免「值已空却还显示旧图」。 */
      // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
      if (value === "" || value == null) {
        setPreviews((prev) => {
          if (prev[ioKey] === undefined) {
            return prev;
          }
          const next = { ...prev };
          delete next[ioKey];
          return next;
        });
      }
      onChange({ ...values, [ioKey]: value });
    },
    [values, onChange],
  );

  /* 图片输入选择器：隐藏 input、「点谁去触发」与「选完复位 value」收进
   *  `ui/file-picker` —— 此前本 hook 自己持 ref、自己 click、自己在
   *  onChange 里复位 `event.target.value`（同一套样板全库 9 份）。 */
  const uploadPicker = useFilePicker({
    accept: "image/*",
    // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
    onPick: (file) => void onFile(file),
  });

  const pickFile = useCallback(
    (ioKey: string) => {
      setUploadTarget(ioKey);
      uploadPicker.open();
    },
    [uploadPicker],
  );

  const onFile = useCallback(
    async (file: File) => {
      const target = uploadTarget;
      if (!target) {
        return;
      }
      setUploading(true);
      setUploadError(null);
      /* 本地预览：读成 data URL 后存起来，选完立刻显示、不依赖 ComfyUI 是否运行。
       * **不 await** —— 它是附带效果，读文件的异步不该推迟真正的上传时序；读失败
       * 也只是没有本地预览，不阻断上传。 */
      void readFileAsDataUrl(file)
        .then((dataUrl) => {
          setPreviews((prev) => ({ ...prev, [target]: dataUrl }));
        })
        .catch(() => undefined);
      try {
        /* ComfyUI 未运行 / 正在启动时由客户端自动等就绪后重试；等待期间
         * 把「正在启动…」上抛给调用方（画布节点/库节点有提示条位置）。 */
        const name = await uploadImageFile(file, {
          onProgress: (message) => onUploadProgress?.(message),
        });
        set(target, name);
      } catch (error) {
        const message = errorMessage(error, "上传失败");
        console.error("[DynamicWorkflowForm] upload failed", error);
        setUploadError(message);
        onUploadError?.(message);
      } finally {
        setUploading(false);
        setUploadTarget(null);
      }
    },
    [uploadTarget, set, onUploadError, onUploadProgress],
  );

  /* 本地预览地址（仅当用户刚选过这张图时有值）；没有则回退到按值算出的
   * ComfyUI 代理地址（见 WidgetControl 的 previewSrc ?? mediaPreviewUrl）。 */
  const localPreviewUrl = useCallback(
    (ioKey: string): string | undefined => previews[ioKey],
    [previews],
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
    uploading,
    uploadTarget,
    FileInput: uploadPicker.Input,
    pickFile,
    localPreviewUrl,
    uploadError,
    dismissUploadError,
    set,
    dragHandlers,
    draggingKey,
    dragOverKey,
    dropPosition,
    beginPortDrag,
    endDrag,
  };
}
