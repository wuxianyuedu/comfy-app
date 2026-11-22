"use client";

// ── 「接收系统文件拖入」的唯一漏斗（§12.18 复用优先）──
// 现有调用点：工作流库导入（列表区 + 导入面板）、工坊剧本导入（剧本阶段整页）。
// 漏斗只负责「怎么收拖拽」：只认带 Files 的拖动、enter/leave 计数防子元素闪烁、
// 多文件 / 空投递的错误话术；「收到的文件怎么处理」由调用方给 onFile，
// 错误出口由调用方给 onError（各自接自己的提示通道，本 hook 不做 UI）。

import { useCallback, useRef, useState, type DragEvent } from "react";

/** 拖放投放区：只认带 `Files` 的拖动（否则文本选择拖动也会点亮高亮）。
 *  计数器抵消子元素冒泡产生的 leave —— 没有它，光标掠过子元素时高亮会闪。
 *  多文件 / 空投递在这里统一给出可展示的错误；同一页面的多个投放区共用。 */
export function useDropZone(
  onFile: (file: File) => void | Promise<void>,
  onError: (message: string) => void,
) {
  const counterRef = useRef(0);
  const [active, setActive] = useState(false);

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
      const [first] = files;
      if (!first) {
        return;
      }
      if (files.length > 1) {
        onError(`一次只能拖入一个文件（收到了 ${files.length} 个）`);
        return;
      }
      void onFile(first);
    },
    [onError, onFile],
  );

  return { active, onDragOver, onDragEnter, onDragLeave, onDrop };
}
