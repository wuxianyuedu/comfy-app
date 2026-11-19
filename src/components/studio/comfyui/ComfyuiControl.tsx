"use client";

/**
 * ComfyUI 运行页 · 第④层（容器）：取 controller → 传给视图。
 * 不含业务规则（规范 17 §17.2），也不挂弹层 —— 日志框形态由 RuntimeLogBox 自持。
 */
import { useComfyuiControl } from "./hooks/use-comfyui-control";
import { ComfyuiControlView } from "./ComfyuiControlView";

export function ComfyuiControl() {
  const c = useComfyuiControl();
  return <ComfyuiControlView c={c} />;
}
