"use client";

import { useStyleLab } from "./hooks/use-style-lab";
import { StyleLabView } from "./StyleLabView";

/**
 * 风格实验室 · 第④层（容器）：取 controller → 传给视图。
 *
 * 与 `QueueMonitor` 同形，本身不含任何业务规则（规范 17 §17.2），也不接任何对外
 * 回调 —— 这一屏是自成一体的「记录 + 浏览」，跳去别处（如工作流库）的动作留给
 * 下一批随扇出入口一起接。
 */
export function StyleLab() {
  const c = useStyleLab();
  return <StyleLabView c={c} />;
}
