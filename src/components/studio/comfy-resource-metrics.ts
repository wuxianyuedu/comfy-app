/**
 * 资源指标（显存 / 内存）的**口径描述符**：标签、title、顺序，以及「哪些档现在有读数」——
 * 状态栏与首页「本机算力」卡展示同一组读数，措辞必须逐字一致（§12.12）。两条显存口径分开点名：
 * `smiVram`=nvidia-smi 物理专用显存，`cudaVram`=ComfyUI 的 CUDA 逻辑口径；缺读数的档整档隐藏，不渲染 0%。
 */
import type { ComfyStatusViewModel } from "./hooks/use-comfy-readiness";

/** 一档资源指标在视图里的身份。 */
export type ResourceMetricKey = "smiVram" | "cudaVram" | "ram";

export type ResourceMetricDescriptor = {
  key: ResourceMetricKey;
  /** 行首标签（两处消费点共用）。 */
  label: string;
  /** 口径说明，落进 `title`：用户必须能看出这根条数的是哪一种显存。 */
  title: string;
};

/**
 * 顺序即渲染顺序（物理显存 → ComfyUI 显存 → 内存）。状态栏历史上就是这个次序，
 * 首页卡沿用，免得同一组数在两个地方以两种顺序出现。
 */
export const RESOURCE_METRICS: ReadonlyArray<ResourceMetricDescriptor> = [
  {
    key: "smiVram",
    label: "显存",
    title: "nvidia-smi 物理专用显存（与任务管理器「专用 GPU 内存」同口径）",
  },
  {
    key: "cudaVram",
    label: "显存·ComfyUI",
    title: "ComfyUI 上报的 CUDA 口径（显存剩余可用/总量，已用 = 总量 − 剩用）",
  },
  { key: "ram", label: "内存", title: "系统内存占用" },
];

/**
 * 迟滞容忍期内（连着但这一轮没读到）要说的那句话。状态栏原先把它内联在 `title`
 * 里；首页卡要说的是同一件事，收在这里，免得两处漂成两个名字（§12.14）。
 */
export const STALE_RESOURCE_NOTE = "ComfyUI 指标暂时读不到，显示的是上一次数据";

/**
 * 已连接、但首帧占用采样还没回来。与「未运行」必须分开说 —— 报「未运行」是谎，
 * 什么都不说则让用户以为卡住（硬规则 4：失败路径要有用户可见的出口）。
 */
export const WAIT_FIRST_SAMPLE_NOTE = "已连接，占用数据首帧读取中";

/** 一档的完整渲染输入：描述符 + 已算好的读数。 */
export type VisibleResourceMetric = {
  bar: NonNullable<ComfyStatusViewModel[ResourceMetricKey]>;
  descriptor: ResourceMetricDescriptor;
};
/**
 * 只留下有读数的档。判据收在这里，两个消费点不再各写一遍 `smiVram && (...)`，
 * 也就不会出现「状态栏隐藏了、首页画成 0」这种半截实现。
 */
export function selectVisibleResourceMetrics(
  view: Pick<ComfyStatusViewModel, "smiVram" | "cudaVram" | "ram">,
): Array<VisibleResourceMetric> {
  const out: Array<VisibleResourceMetric> = [];
  for (const descriptor of RESOURCE_METRICS) {
    const bar = view[descriptor.key];
    if (bar) {
      out.push({ descriptor, bar });
    }
  }
  return out;
}
