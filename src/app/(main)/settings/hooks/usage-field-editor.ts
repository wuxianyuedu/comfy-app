"use client";

/**
 * 「实际使用」测试弹窗的**字段行编辑器**（规范 17 §17.2 第②层子域）。
 * 自洽交互面：动作只读写 `UsageFieldEditorState.fields`。`update` 由调用方传入
 * （即 `setUsageTest`）—— 子域不持有状态，状态仍归主 hook 一处持有。
 */

import type { RemoteModelKind } from "~/lib/llm/types";
import type { Dispatch, SetStateAction } from "react";

import { errorText } from "~/lib/error-message";
import { readFileAsDataUrl } from "~/lib/file-io";

import {
  hasUsageFieldKey,
  isMediaField,
  makeUsageField,
  sanitizeModeValue,
  videoModeHidesMedia,
  type UsageField,
} from "~/lib/llm/usage-test-config";

/** 编辑器需要的最小状态形状：只有 `kind` 与 `fields`。
 *
 *  刻意**不** import 主 hook 的 `UsageTestDialogState` —— 那会形成双向依赖
 *  （主 hook 要 import 本模块的构造函数），由 `tests/check-circular-deps.test.ts`
 *  拦下。这里按「我需要什么」声明，主 hook 的完整状态**结构上**满足它。 */
export type UsageFieldEditorState = {
  fields: Array<UsageField>;
  kind: RemoteModelKind;
};

/** 字段行编辑器的动作集合（挂在 `useProviderModelDialogs` 的返回对象上透给视图）。 */
export type UsageFieldEditor = {
  addField: (key?: string) => void;
  addPresetField: (key: string) => void;
  patchField: (index: number, patch: Partial<UsageField>) => void;
  pickFieldImage: (index: number, file: File | undefined) => Promise<void>;
  removeField: (index: number) => void;
  rescueMediaFromMode: (index: number, url: string) => void;
  setVideoMode: (mode: string) => void;
  usageFieldsToSend: (state: UsageFieldEditorState) => Array<UsageField>;
};

/** 造出字段行编辑器的动作集合。`update` 即 `setUsageTest`。 */
export function createUsageFieldEditor<T extends UsageFieldEditorState>(
  update: Dispatch<SetStateAction<T | null>>,
): UsageFieldEditor {
  /* ── 「额外字段」行编辑器：增删改某一行 / 把某行设为图片 / 应用 mode 预设。
   *  纯视图交互，不入库；随弹窗关闭即丢弃。 */
  function patchField(index: number, patch: Partial<UsageField>) {
    update((prev) => {
      if (!prev) {
        return prev;
      }
      const fields = prev.fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
      return { ...prev, fields };
    });
  }
  function addField(key = "") {
    update((prev) =>
      prev ? { ...prev, fields: [...prev.fields, makeUsageField(key, "")] } : prev,
    );
  }
  /** 一键添加固定名称字段（images / first_frame / seed 等预设）：
   *  已存在同名行则不重复加，避免堆出无用的空行。 */
  function addPresetField(key: string) {
    update((prev) =>
      prev && !hasUsageFieldKey(prev.fields, key)
        ? { ...prev, fields: [...prev.fields, makeUsageField(key, "")] }
        : prev,
    );
  }
  function removeField(index: number) {
    update((prev) =>
      prev ? { ...prev, fields: prev.fields.filter((_, i) => i !== index) } : prev,
    );
  }
  async function pickFieldImage(index: number, file: File | undefined) {
    if (!file) {
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      patchField(index, { value: dataUrl });
    } catch (error) {
      patchField(index, { value: errorText(error, "读取图片失败") });
    }
  }
  /** 随请求发送的字段行：视频 mode=text 时媒体字段已被隐藏（不渲染也不发送），
   *  其余场景原样保留。过滤逻辑读 usage-test-config 的纯函数，视图不重复实现。 */
  function usageFieldsToSend(state: UsageFieldEditorState): Array<UsageField> {
    const hideMedia = state.kind === "video" && videoModeHidesMedia(state.fields);
    return hideMedia ? state.fields.filter((f) => !isMediaField(f.key)) : state.fields;
  }

  /** 设置视频 mode 快捷值：已有 mode 行则改其值，否则在末尾追加一行。
   *  若引用图从未落到媒体行（images / first_frame / audios）——例如被误
   *  填进了 mode 行或首行默认值——先把它搬移过去再设 mode，避免丢图。 */
  function setVideoMode(mode: string) {
    update((prev) => {
      if (!prev) {
        return prev;
      }
      const idx = prev.fields.findIndex((f) => f.key === "mode");
      if (idx !== -1) {
        const fields = prev.fields.map((f, i) => (i === idx ? { ...f, value: mode } : f));
        return { ...prev, fields };
      }
      return {
        ...prev,
        fields: [...prev.fields, makeUsageField("mode", mode)],
      };
    });
  }

  /** mode 行被图片覆盖时的自愈：把图片搬到 images 行（没有则新建），mode 值复位。
   *  「复位成什么」不在视图层写死：`sanitizeModeValue` 是「坏值 → 可再改的值」的
   *  唯一出口（`UsageTestDialog` 按同一函数判「已损坏」），手抄 `"text"` 就是同一
   *  件事的两个名字（§12.14）。 */
  function rescueMediaFromMode(index: number, url: string) {
    update((prev) => {
      if (!prev) {
        return prev;
      }
      const fields = prev.fields.map((f, i) =>
        i === index ? { ...f, value: sanitizeModeValue(f.value) } : f,
      );
      const emptyImgRow = fields.findIndex(
        (f) => f.key.trim() === "images" && f.value.trim() === "",
      );
      if (emptyImgRow === -1) {
        fields.push(makeUsageField("images", url));
      } else {
        fields[emptyImgRow] = makeUsageField("images", url);
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
