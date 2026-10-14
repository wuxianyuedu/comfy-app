"use client";

/**
 * ComfyUI 运行页 · 第④层（容器）：取 controller → 传给视图。
 *
 * 不含任何业务规则（规范 17 §17.2），也不挂弹层 —— 这一屏的「弹层」是
 * `RuntimeLogBox` 自己的全屏视图，那由它自持（它管的是日志框的形态）。
 */
import { useComfyuiControl } from "./hooks/use-comfyui-control";
import { ComfyuiControlView } from "./ComfyuiControlView";

export function ComfyuiControl() {
  const c = useComfyuiControl();
  return <ComfyuiControlView c={c} />;
}
