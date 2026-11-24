"use client";

// ── 「接收系统文件拖入」的唯一漏斗（§12.18 复用优先）──
// 现有调用点：工作流库导入（列表区 + 导入面板）、工坊剧本导入（剧本阶段整页）、
// 测试模型图片输入行与参考图多选（#4975）。
// 漏斗只负责「怎么收拖拽」：只认带 Files 的拖动、enter/leave 计数防子元素闪烁、
// 多文件 / 空投递的错误话术；「收到的文件怎么处理」由调用方给 onFile，
// 错误出口由调用方给 onError（各自接自己的提示通道，本 hook 不做 UI）。

import { useCallback, useRef, useState, type DragEvent } from "react";

/** 漏斗的可选档位。`multiple` 开启后一次拖入多个文件不再报错，整批交给
 *  `onFiles`（没给 `onFiles` 时退回逐个交 `onFile`）；默认仍是单文件档，
 *  多文件走 `onError` 的既有话术。既有调用方不传它，行为一字不变。 */
export type DropZoneOptions = {
  multiple?: boolean;
  onFiles?: (files: Array<File>) => void | Promise<void>;
};

/** 拖放投放区：只认带 `Files` 的拖动（否则文本选择拖动也会点亮高亮）。
 *  计数器抵消子元素冒泡产生的 leave —— 没有它，光标掠过子元素时高亮会闪。
 *  多文件 / 空投递在这里统一给出可展示的错误；同一页面的多个投放区共用。 */
export function useDropZone(
  onFile: (file: File) => void | Promise<void>,
  onError: (message: string) => void,
  options?: DropZoneOptions,
) {
  const counterRef = useRef(0);
  const [active, setActive] = useState(false);
  const multiple = options?.multiple === true;
  const onFiles = options?.onFiles;

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);
  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    counterRef.current += 1;
    setActive(true);
  }, []);
  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    counterRef.current = Math.max(0, counterRef.current - 1);
    if (counterRef.current === 0) {
      setActive(false);
    }
  }, []);
  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      counterRef.current = 0;
      setActive(false);
      const files = [...event.dataTransfer.files];
      if (files.length === 0) {
        return;
      }
      if (multiple) {
        if (onFiles === undefined) {
          for (const file of files) {
            void onFile(file);
          }
          return;
        }
        void onFiles(files);
        return;
      }
      const [first] = files;
      if (first === undefined) {
        return;
      }
      if (files.length > 1) {
        onError(`一次只能拖入一个文件（收到了 ${files.length} 个）`);
        return;
      }
      void onFile(first);
    },
    [multiple, onFile, onFiles, onError],
  );

  return { active, onDragOver, onDragEnter, onDragLeave, onDrop };
}
