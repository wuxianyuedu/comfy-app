/**
 * ComfyUI 运行页（侧栏全局页签「ComfyUI」）的**纯派生与常量**
 * （规范 17 §17.2 第①层：常量 + 纯派生，无 React、无副作用）。
 *
 * 为什么单独成模块：这一屏的「状态文字」「圆点语义」「按钮该不该禁用」全是
 * **同一份状态的四五个投影**，而它们此前散在设置页 `ComfyuiSection` 的 JSX
 * 里（多行三元嵌套）。视图里留一行 `comfyStatusText(c)` 与一枚
 * `comfyDotState(c)`，改文案不必穿过 JSX。
 *
 * ⚠️ 这里**不下**「ComfyUI 到底在不在跑」的结论 —— 那是
 * `setting.comfyStatus` 的职责（服务端已把四态判完）。本模块只做「四态 →
 * 文案 / 圆点 / 按钮禁用」的投影，不引 `~/lib/comfyui/lifecycle-notice`
 * 那套判据（同一件事第二个判据必然漂，见该模块文件头）。
 */

import type { StatusDotState } from "~/components/ui/status-dot";

/** 本页消费的运行态四态（与 `setting.comfyStatus` 出口逐字段一致）。 */
export interface ComfyRuntimeStatus {
  up: boolean;
  starting: boolean;
  probing: boolean;
  stopping: boolean;
  base: string | null;
  port: number;
  via: string | null;
}

/** 一个运行态快照里所有「正在过渡」的信号 —— 动作按钮的禁用判据只用它。 */
export function isComfyBusy(
  status: ComfyRuntimeStatus | null,
  flags: { starting: boolean; stopping: boolean; opening: boolean },
): boolean {
  return (
    flags.opening ||
    flags.starting ||
    flags.stopping ||
    !!status?.starting ||
    !!status?.stopping
  );
}

/**
 * 运行状态 → 圆点语义（纯派生，无 React 状态）。
 *
 * 顺序是载荷：**「过渡态」优先于「探测中」**，因为启动 / 关闭过程中状态查询
 * 也会返回 probing 类似的形态；先把过渡态认下，圆点才不会是「未运行」的红。
 */
export function comfyDotState(
  status: ComfyRuntimeStatus | null,
  flags: { starting: boolean; stopping: boolean },
): StatusDotState {
  if (status?.up) return "up";
  if (
    flags.starting ||
    flags.stopping ||
    status?.starting ||
    status?.stopping
  ) {
    return "busy";
  }
  if (status?.probing) return "probing";
  return "down";
}

/**
 * 状态行那句话（读屏与肉眼同一句）。
 *
 * 运行中把**地址与启动方式**一并写进来：同一个端口上可能跑着外部实例，
 * 「谁拉起来的」是用户排查时第一件想知道的事（`via` 非空即来自服务端探测）。
 */
export function comfyStatusText(
  status: ComfyRuntimeStatus | null,
  flags: { starting: boolean; stopping: boolean },
): string {
  if (status?.up) {
    const base = status.base ? `（${status.base}）` : "";
    const via = status.via ? `·${status.via}` : "";
    return `ComfyUI 运行中${base}${via}`;
  }
  if (flags.stopping || status?.stopping) return "ComfyUI 关闭中…";
  if (flags.starting || status?.starting) return "ComfyUI 正在启动…";
  if (status?.probing) return "ComfyUI 状态检测中…";
  return "ComfyUI 未运行";
}

/**
 * 圆点 `title`（悬停说明）。
 *
 * 只在**明确运行中**时给地址：探测中 / 未运行时给一个空 title 或半截结论，
 * 都比不给更坏（悬停出来的东西看起来就是权威结论）。
 */
export function comfyDotTitle(
  status: ComfyRuntimeStatus | null,
): string | undefined {
  if (!status?.up) return undefined;
  return comfyStatusText(status, { starting: false, stopping: false });
}

/** 安装形态 → 徽标文案。 */
export const INSTANCE_KIND_LABEL: Record<
  "desktop" | "portable" | "venv" | "unknown",
  string
> = {
  desktop: "桌面版（ComfyUI Desktop）",
  portable: "便携版",
  venv: "venv",
  unknown: "未知安装",
};

/** 一个安装形态键 → 徽标文案（判不出形态时按 `unknown` 档说，不猜）。 */
export function instanceKindLabel(
  kind: "desktop" | "portable" | "venv" | null,
): string {
  return INSTANCE_KIND_LABEL[kind ?? "unknown"];
}

/**
 * 「这一屏为什么还没准备好」的一句话；配置齐了返回 null。
 *
 * 与设置页那边的关系：路径 / 解释器在「设置 → 创作后端」里配，这里**只**读
 * 结论、只给出口 —— 不在本页重开一组输入框（同一份配置两个编辑入口必然打架，
 * 而保存路径会重写 `setting` 表里那一行）。
 */
export function comfyConfigHint(
  instance: {
    pathConfigured: boolean;
  } | null,
): string | null {
  if (instance?.pathConfigured) return null;
  return "还没配置 ComfyUI 路径 —— 在「设置 → 创作后端」里填源码根或桌面实例根，再回来启动。";
}
