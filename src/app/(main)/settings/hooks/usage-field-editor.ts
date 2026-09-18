"use client";

/**
 * 「实际使用」测试弹窗的**字段行编辑器**（规范 17 §17.2 第②层的一个子域）。
 *
 * 从 `use-remote-model-dialogs` 里切出来，因为它是一个**自洽的交互面**：
 * 七个动作全部只读写 `UsageFieldEditorState.fields`，不碰网络、不碰草稿仓库、
 * 不碰其它任何状态。留在主 hook 里会让那个函数越过 400 行的拆分阈值
 * （§12.13），而按注释分段不算拆分。
 *
 * `update` 由调用方传入（就是 `setUsageTest`）—— 子域不持有状态，
 * 只提供动作，状态仍归主 hook 一处持有。
 */

import type { Dispatch, SetStateAction } from "react";

import {
  hasUsageFieldKey,
  isMediaField,
  sanitizeModeValue,
  videoModeHidesMedia,
  type UsageField,
} from "~/lib/llm/usage-test-config";

/** 读取本地图片文件为 data URL，供图片字段上传（不回服务端，纯前端转码）。 */
function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      /* readAsDataURL 的结果必是字符串（data:image/...） */
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

/** 编辑器需要的最小状态形状：只有 `kind` 与 `fields`。
 *
 *  刻意**不** import 主 hook 的 `UsageTestDialogState` —— 那会形成双向依赖
 *  （主 hook 要 import 本模块的构造函数），由 `tests/check-circular-deps.test.ts`
 *  拦下。这里按「我需要什么」声明，主 hook 的完整状态**结构上**满足它。 */
export interface UsageFieldEditorState {
  kind: "chat" | "image" | "video";
  fields: UsageField[];
}

/** 字段行编辑器的动作集合（挂在 `RemoteModelDialogs` 上透给视图）。 */
export interface UsageFieldEditor {
  patchField: (index: number, patch: Partial<UsageField>) => void;
  addField: (key?: string) => void;
  addPresetField: (key: string) => void;
  removeField: (index: number) => void;
  pickFieldImage: (index: number, file: File | undefined) => Promise<void>;
  setVideoMode: (mode: string) => void;
  rescueMediaFromMode: (index: number, url: string) => void;
  usageFieldsToSend: (state: UsageFieldEditorState) => UsageField[];
}

/** 造出字段行编辑器的动作集合。`update` 即 `setUsageTest`。 */
export function createUsageFieldEditor<T extends UsageFieldEditorState>(
  update: Dispatch<SetStateAction<T | null>>,
): UsageFieldEditor {
  /* ── 「额外字段」行编辑器：增删改某一行 / 把某行设为图片 / 应用 mode 预设。
   *  纯视图交互，不入库；随弹窗关闭即丢弃。 */
  function patchField(index: number, patch: Partial<UsageField>) {
    update((prev) => {
      if (!prev) return prev;
      const fields = prev.fields.map((f, i) =>
        i === index ? { ...f, ...patch } : f,
      );
      return { ...prev, fields };
    });
  }
  function addField(key = "") {
    update((prev) =>
      prev ? { ...prev, fields: [...prev.fields, { key, value: "" }] } : prev,
    );
  }
  /** 一键添加固定名称字段（images / first_frame / seed 等预设）：
   *  已存在同名行则不重复加，避免堆出无用的空行。 */
  function addPresetField(key: string) {
    update((prev) =>
      prev && !hasUsageFieldKey(prev.fields, key)
        ? { ...prev, fields: [...prev.fields, { key, value: "" }] }
        : prev,
    );
  }
  function removeField(index: number) {
    update((prev) =>
      prev
        ? { ...prev, fields: prev.fields.filter((_, i) => i !== index) }
        : prev,
    );
  }
  async function pickFieldImage(index: number, file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await readImageAsDataUrl(file);
      patchField(index, { value: dataUrl });
    } catch (err) {
      patchField(index, {
        value: `读取图片失败：${err instanceof Error ? err.message : "未知错误"}`,
      });
    }
  }
  /** 随请求发送的字段行：视频 mode=text 时媒体字段已被隐藏（不渲染也不发送），
   *  其余场景原样保留。过滤逻辑读 usage-test-config 的纯函数，视图不重复实现。 */
  function usageFieldsToSend(state: UsageFieldEditorState): UsageField[] {
    const hideMedia =
      state.kind === "video" && videoModeHidesMedia(state.fields);
    return hideMedia
      ? state.fields.filter((f) => !isMediaField(f.key))
      : state.fields;
  }

  /** 设置视频 mode 快捷值：已有 mode 行则改其值，否则在末尾追加一行。
   *  若引用图从未落到媒体行（images / first_frame / audios）——例如被误
   *  填进了 mode 行或首行默认值——先把它搬移过去再设 mode，避免丢图。 */
  function setVideoMode(mode: string) {
    update((prev) => {
      if (!prev) return prev;
      const idx = prev.fields.findIndex((f) => f.key === "mode");
      if (idx >= 0) {
        const fields = prev.fields.map((f, i) =>
          i === idx ? { ...f, value: mode } : f,
        );
        return { ...prev, fields };
      }
      return {
        ...prev,
        fields: [...prev.fields, { key: "mode", value: mode }],
      };
    });
  }

  /** mode 行被图片覆盖时的自愈：把图片搬到 images 行（没有则新建），
   *  mode 值复位为 text——图片不丢、mode 可见可改。
   *
   *  「复位成什么」不在视图层写死：`sanitizeModeValue` 是「坏值 → 可再改的
   *  值」的唯一出口（同名卡片在 `UsageTestDialog` 里按同一个函数判「已损坏」），
   *  这里手抄一份 `"text"` 就是同一件事的两个名字（§12.14）。 */
  function rescueMediaFromMode(index: number, url: string) {
    update((prev) => {
      if (!prev) return prev;
      const fields = prev.fields.map((f, i) =>
        i === index ? { ...f, value: sanitizeModeValue(f.value) } : f,
      );
      const emptyImgRow = fields.findIndex(
        (f) => f.key.trim() === "images" && f.value.trim() === "",
      );
      if (emptyImgRow >= 0) {
        fields[emptyImgRow] = { key: "images", value: url };
      } else {
        fields.push({ key: "images", value: url });
      }
      return { ...prev, fields };
    });
  }

  return {
    patchField,
    addField,
    addPresetField,
    removeField,
    pickFieldImage,
    setVideoMode,
    rescueMediaFromMode,
    usageFieldsToSend,
  };
}
