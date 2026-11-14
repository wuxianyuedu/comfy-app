"use client";

import React from "react";

import { Button } from "~/components/ui/button";
import type { OmitOwnProps } from "~/lib/dom-props";

/** 「隐藏 `<input type="file">` + 谁来点它」的唯一出口。此前这件事散在 9 个文件里各写一份，写法互不相同：把 input 挂在 `useRef` 上再 `ref.current?.click()`；用 `<label htmlFor>` 隐式关联；或把 input 露在界面上、靠 `file:` 伪元素美化。
 * 三个共性问题只有放在一处才收得住：① `click()` 在 ref 未挂上时是静默空操作（界面「点了没反应」，既没反馈也不知该去查什么）；② 选完多数落点没有复位 `event.target.value`，用户第二次选同一文件不触发 `change`（浏览器只在取值变化时派发，看起来像上传坏了）；③ 同一文件里两个隐藏 input + 两个 ref + 两个 `click()` 的样板重复，改一处「要不要支持多选」要改四个地方。 */

export type FilePickerProps = {
  /** 透传给 `<input>` 的 `accept`，把系统文件对话框筛成期望类型。 */
  accept?: string;
  /** 额外透传给 `<input>` 的属性（如 `id`，供 `<label htmlFor>` 关联）。 */
  inputProps?: OmitOwnProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "accept" | "multiple" | "onChange" | "className"
  >;
  /** 是否允许一次选多个。默认单选。 */
  multiple?: boolean;
  /** 选中文件后的回调。用户取消时不会被调用。
   * `files` 原样保留浏览器的 `FileList`（多选场景要整份交给上传管线按序串行）；`file` 是它的第一项。两个都传是为了让调用方不必自己写 `files[0]` —— 那正是此前 9 份实现里各写一遍、且有两处忘了判空的地方。 */
  onPick: (file: File, files: FileList) => void;
};

export type FilePickerHandle = {
  /** 打开系统文件对话框。 */
  open: () => void;
};

/** 命令式用法：`open()` 挂在任意既有按钮上，隐藏 input 挂在本组件树里。`const picker = useFilePicker({ onPick: (f) => void upload(f), accept: "image/*" })`；`<Button onClick={picker.open}>上传</Button>` 触发，`<FilePicker {...picker.inputProps} />` 挂载隐藏 input（不用你管 ref）。
 *
 *  **为什么返回 props 而不是返回一个 `<picker.Input />` 组件**（#3692）：`Input`
 *  在 JSX 里占的是组件位置，身份必须逐渲染恒定，否则 React 会把它卸载再重挂 ——
 *  重挂窗口里落下的文件选择事件会打在已脱离 DOM 的旧节点上，选择结果整个丢失。
 *  而 `onPick` 几乎总是调用方的内联箭头，把它放进 `useMemo` 的 deps，身份就每
 *  渲染必变（形同虚设）。`FilePicker` 本身是模块级组件、身份天然恒定：返回
 *  **现成的 props** 让调用点展开到它身上，重渲染只更新 props、不重挂。 */
export function useFilePicker({ onPick, accept, multiple, inputProps }: FilePickerProps) {
  const handleRef = React.useRef<FilePickerHandle | null>(null);

  /* `open` 必须身份稳定：调用方会把它放进 `onClick` 甚至依赖数组。 */
  const open = React.useCallback(() => handleRef.current?.open(), []);

  const pickerInputProps = {
    accept,
    handleRef,
    inputProps,
    multiple,
    onPick,
  };

  return { open, inputProps: pickerInputProps };
}

/**
 * 基础组件形态：持有隐藏 input，把 `open` 通过 `handleRef` 暴露出去。
 * 视图层一般用 `useFilePicker`（已封好 ref 转发），本组件是它的实现细节。
 */
export function FilePicker({
  onPick,
  accept,
  multiple,
  inputProps,
  handleRef,
}: FilePickerProps & {
  handleRef?: React.RefObject<FilePickerHandle | null>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const open = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  React.useImperativeHandle(handleRef, () => ({ open }), [open]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target;
    /* 按下标取第一个：真实 `FileList` 与测试桩（数组形）都认下标访问，
     * `.item()` 只有真 DOM 里有（#3657 平台受影响用例格的现场）。 */
    const first = files?.[0];
    if (!files || !first) {
      return;
    }
    /* 先交付**再**复位（ISSUE #3657）：`FileList` 是活对象，`value = ""` 会当场把
     * 它清空 —— 复位若写在取文件之前，`picked[0]` 读到的就是 `undefined`，
     * onPick 永远不触发，界面上就是「选了文件毫无反应」。复位仍要执行：不归零时
     * 用户第二次选**同一个文件**不会触发 `change`，表现成「上传按钮坏了」。 */
    try {
      onPick(first, files);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <input
      accept={accept}
      className="hidden"
      multiple={multiple}
      onChange={handleChange}
      ref={inputRef}
      type="file"
      {...inputProps}
    />
  );
}

/** 声明式「按钮 + 隐藏 input」二合一。适合「按钮就是唯一入口」的落点：调用方只给 `onPick` 与按钮外观，不需要自己拿 ref、也不需要记得把 input 放进 JSX。 */

export function FilePickerButton({
  onPick,
  accept,
  multiple,
  inputProps,
  children,
  ...buttonProps
}: FilePickerProps &
  OmitOwnProps<React.ComponentProps<typeof Button>, "children" | "onClick"> & {
    children: React.ReactNode;
  }) {
  const handleRef = React.useRef<FilePickerHandle | null>(null);

  return (
    <>
      <Button {...buttonProps} onClick={() => handleRef.current?.open()}>
        {children}
      </Button>
      <FilePicker
        accept={accept}
        handleRef={handleRef}
        inputProps={inputProps}
        multiple={multiple}
        onPick={onPick}
      />
    </>
  );
}
