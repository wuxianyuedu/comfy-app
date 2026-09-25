import React from "react";
import { Handle, Position } from "@xyflow/react";
import {
  type CanvasNodeData,
  NODE_META,
  STATUS_BADGE_KEY,
  STATUS_LABEL,
  type NodeKind,
} from "~/lib/project-canvas/canvas-types";
import { StatusBadge as StatusBadgePrimitive } from "~/components/ui/status-badge";

/* ── 小型共享 UI 原语 ── */
export const btnCls =
  "rounded-md btn-gradient px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-40";

export function Field({
  label,
  port,
  children,
}: {
  label: string;
  port?: { id: string; type: PortType; dir?: "in" | "out" };
  children: React.ReactNode;
}) {
  const s = port ? PORT_STYLE[port.type] : null;
  const isOut = port?.dir === "out";
  return (
    <div className="relative block">
      {/* 统一标签行 —— 相对锚点，好让输入 Handle 居中于标题 */}
      <div className="relative mb-1.5 flex items-center gap-1.5">
        {port && s && !isOut && (
          <>
            <Handle
              type="target"
              position={Position.Left}
              id={port.id}
              style={{
                position: "absolute",
                width: 10,
                height: 10,
                background: s.gradient,
                border: `1.5px solid ${s.color}`,
                boxShadow: `0 0 8px ${s.glow}, 0 0 0 1px rgba(255,255,255,0.06)`,
                left: -14,
                top: "50%",
                transform: "translateY(-50%)",
                borderRadius: 9999,
              }}
            />
            <span
              className="text-[11px] font-medium"
              style={{ color: s.color }}
            >
              {s.label}
            </span>
          </>
        )}
        <span className="text-ink-soft text-[11px] font-medium">{label}</span>
      </div>

      {/* Input area */}
      <div className="relative">
        {children}
        {port && s && isOut && (
          <>
            <span className="mt-1 flex items-center justify-end gap-1.5">
              <span
                className="text-[11px] font-medium"
                style={{ color: s.color }}
              >
                {s.label}
              </span>
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              style={{
                width: 10,
                height: 10,
                background: s.gradient,
                border: `1.5px solid ${s.color}`,
                boxShadow: `0 0 8px ${s.glow}, 0 0 0 1px rgba(255,255,255,0.08)`,
                right: -14,
                top: 1,
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

/* ── Parameter-level port colors (粉彩渐变 6 色对应 6 类参数) ──
   灵感来源：用户偏好柔和粉彩渐变（紫粉/蓝青/黄橙/青绿/蓝紫/粉红）。
   端口用大圆点 + 渐变 + 同色发光，hover/连线时更醒目。 */
export const PORT_STYLE = {
  model: {
    gradient: "linear-gradient(135deg, #5BC6FF 0%, #6BEBEB 100%)",
    color: "#5BC6FF",
    glow: "rgba(91,198,255,0.55)",
    label: "模型",
  },
  latent: {
    gradient: "linear-gradient(135deg, #B584FF 0%, #FF9DCD 100%)",
    color: "#B584FF",
    glow: "rgba(181,132,255,0.55)",
    label: "LATENT",
  },
  condition: {
    gradient: "linear-gradient(135deg, #FFD571 0%, #FF9C5B 100%)",
    color: "#FF9C5B",
    glow: "rgba(255,156,91,0.55)",
    label: "条件",
  },
  negative: {
    gradient: "linear-gradient(135deg, #FF8FB0 0%, #FF7AC0 100%)",
    color: "#FF7AC0",
    glow: "rgba(255,122,192,0.55)",
    label: "负条件",
  },
  image: {
    gradient: "linear-gradient(135deg, #5BE3C4 0%, #67E89D 100%)",
    color: "#5BE3C4",
    glow: "rgba(91,227,196,0.55)",
    label: "图像",
  },
  seed: {
    gradient: "linear-gradient(135deg, #7891FF 0%, #A584FF 100%)",
    color: "#A584FF",
    glow: "rgba(165,132,255,0.55)",
    label: "种子",
  },
  int: {
    gradient: "linear-gradient(135deg, #B584FF 0%, #FF9DCD 100%)",
    color: "#B584FF",
    glow: "rgba(181,132,255,0.55)",
    label: "整数值",
  },
  float: {
    gradient: "linear-gradient(135deg, #FFD571 0%, #FF9C5B 100%)",
    color: "#FFD571",
    glow: "rgba(255,213,113,0.55)",
    label: "浮点值",
  },
} as const;
type PortType = keyof typeof PORT_STYLE;

export function StatusDot({ status }: { status: CanvasNodeData["status"] }) {
  const grad =
    status === "running"
      ? "linear-gradient(135deg, #FFD571 0%, #FF9C5B 100%)"
      : status === "done"
        ? "linear-gradient(135deg, #5BE3C4 0%, #67E89D 100%)"
        : status === "error"
          ? "linear-gradient(135deg, #FF8FB0 0%, #FF7AC0 100%)"
          : "linear-gradient(135deg, #7891FF 0%, #A584FF 100%)";
  const glow =
    status === "running"
      ? "rgba(255,213,113,0.6)"
      : status === "done"
        ? "rgba(91,227,196,0.6)"
        : status === "error"
          ? "rgba(255,122,192,0.6)"
          : "rgba(165,132,255,0.6)";
  return (
    <span
      className="inline-block size-2.5 rounded-full"
      style={{ background: grad, boxShadow: `0 0 8px ${glow}` }}
    />
  );
}

/* ── 状态徽标（文字标签） ──
 * 用在节点与结果卡的左上角头部行，好让用户
 * 一眼读出生命周期状态。配色走 `ui/status-badge` 的同一份状态 → 语义 token
 * 映射（规范 16 §16.2.4.5）—— 此前这里另写四档字面量配色，改状态色要点两遍名。 */
export function StatusBadge({ status }: { status: CanvasNodeData["status"] }) {
  return (
    <StatusBadgePrimitive
      status={STATUS_BADGE_KEY[status]}
      label={STATUS_LABEL[status]}
      dot={false}
      className="shrink-0 gap-0 rounded px-1.5 py-0.5 text-[10px]"
    />
  );
}

/* ── 「类型字符 + 名字」章 ──
 * 由节点头部与结果卡头部共享，好让每处界面
 * 都显示一致的左上角「类型指示 + 名字」配对。字符是
 * 该类型的代表字母（T/I/V/A/W），画在与该类型颜色相配的
 * 圆形渐变里。 */
export function NodeChip({
  kind,
  name,
  size = "md",
}: {
  kind: NodeKind;
  name: string;
  size?: "sm" | "md";
}) {
  const meta = NODE_META[kind];
  const isSm = size === "sm";
  return (
    <div
      className={`flex min-w-0 items-center ${isSm ? "gap-1.5" : "gap-2.5"}`}
    >
      <span
        className={`flex shrink-0 items-center justify-center rounded-full font-bold ${
          isSm ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]"
        }`}
        style={{
          background: `linear-gradient(135deg, ${meta.color}30 0%, ${meta.color}15 100%)`,
          color: meta.color,
          boxShadow: `0 0 8px ${meta.color}33, inset 0 0 0 1px ${meta.color}40`,
        }}
        aria-label={`类型 ${meta.label}`}
      >
        {meta.typeChar}
      </span>
      <span
        className={`text-ink-bright truncate font-semibold ${
          isSm ? "text-[11px]" : "text-[13px]"
        }`}
      >
        {name}
      </span>
    </div>
  );
}
