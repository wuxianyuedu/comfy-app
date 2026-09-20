"use client";

import React from "react";

import { Button } from "~/components/ui/button";
import { type OmitOwnProps } from "~/lib/dom-props";

/**
 * 「隐藏 `<input type="file">` + 谁来点它」的唯一出口。
 *
 * 此前这件事散在 9 个文件里各写一份，写法互不相同：
 *  - 把 input 挂在 `useRef` 上，再 `ref.current?.click()`；
 *  - 用 `<label htmlFor>` 隐式关联（`UsageTestDialog` / `VideoQueueModal`）；
 *  - 干脆把 input 露在界面上，靠 `file:` 伪元素美化（`FilmStudio` 的 BGM 选择器）。
 *
 * 三个共性问题只有放在一处才收得住：
 *  1. **`click()` 在 ref 未挂上时是静默空操作** —— 界面「点了没反应」，
 *     既没有反馈也不知道该去查什么；
 *  2. **选完之后多数落点没有复位 `event.target.value`** —— 用户第二次选**同一个
 *     文件**不会触发 `change`（浏览器只在取值变化时派发），看起来像上传坏了；
 *  3. 同一个文件里两个隐藏 input + 两个 ref + 两个 `click()` 的样板重复，
 *     改一处「要不要支持多选」要改四个地方。
 */

export interface FilePickerProps {
  /**
   * 选中文件后的回调。用户取消时不会被调用。
   *
   * `files` 原样保留浏览器的 `FileList`（多选场景要整份交给上传管线，
   * `Array.from(files)` 之后按序串行）；`file` 是它的第一项，单选落点的
   * 常见写法。两个都传是为了让调用方**不必**自己写 `files[0]` ——
   * 那正是此前 9 份实现里各写一遍、且有两处忘了判空的地方。
   */
  onPick: (file: File, files: FileList) => void;
  /** 透传给 `<input>` 的 `accept`，把系统文件对话框筛成期望类型。 */
  accept?: string;
  /** 是否允许一次选多个。默认单选。 */
  multiple?: boolean;
  /** 额外透传给 `<input>` 的属性（如 `id`，供 `<label htmlFor>` 关联）。 */
  inputProps?: OmitOwnProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "accept" | "multiple" | "onChange" | "className"
  >;
}

export interface FilePickerHandle {
  /** 打开系统文件对话框。 */
  open: () => void;
}

/**
 * 命令式用法：`open()` 挂在任意既有按钮上，`Input` 挂在本组件树里。
 *
 * ```tsx
 * // 建选择器：拿到「谁来开」；onPick 收单个 File
 * const picker = useFilePicker({ onPick: (f) => void upload(f), accept: "image/*" }); // 建选择器
 * // 触发钮调它的 open；input 自己挂在树里，不用你管 ref
 * <Button onClick={picker.open}>上传</Button> // 触发钮
 * <picker.Input /> // 挂载隐藏 input
 * ```
 *
 * `Input` 用 `useMemo` 固定身份：它在 JSX 里是组件位置，每次渲染重建会让
 * React 卸载再挂载 input（正在进行的文件对话框会被打断）。
 */
export function useFilePicker({
  onPick,
  accept,
  multiple,
  inputProps,
}: FilePickerProps) {
  const handleRef = React.useRef<FilePickerHandle | null>(null);

  /* `open` 必须身份稳定：调用方会把它放进 `onClick` 甚至依赖数组。 */
  const open = React.useCallback(() => handleRef.current?.open(), []);

  const Input = React.useMemo(
    () =>
      function PickerInput() {
        return (
          <FilePicker
            onPick={onPick}
            accept={accept}
            multiple={multiple}
            inputProps={inputProps}
            handleRef={handleRef}
          />
        );
      },
    [onPick, accept, multiple, inputProps],
  );

  return { open, Input };
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
    const files = event.target.files;
    /* 必须复位：`value` 不归零时，用户第二次选**同一个文件**不会触发
     * `change`，表现成「上传按钮坏了」。复位要在取完 `files` 之后 ——
     * 赋值 `""` 会把 `FileList` 清空。 */
    const picked = files && files.length > 0 ? files : null;
    event.target.value = "";
    const first = picked?.[0];
    if (first) onPick(first, picked);
  };

  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      className="hidden"
      onChange={handleChange}
      {...inputProps}
    />
  );
}

/**
 * 声明式「按钮 + 隐藏 input」二合一。
 *
 * 适合「按钮就是唯一入口」的落点：调用方只给 `onPick` 与按钮外观，
 * 不需要自己拿 ref、也不需要记得把 input 放进 JSX。
 */

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
        onPick={onPick}
        accept={accept}
        multiple={multiple}
        inputProps={inputProps}
        handleRef={handleRef}
      />
    </>
  );
}
