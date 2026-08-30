import React from "react";
import { Handle, Position } from "@xyflow/react";
import {
  type CanvasNodeData,
  NODE_META,
  STATUS_LABEL,
  type NodeKind,
} from "../canvas-types";

/* ── Small shared UI primitives ── */
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
      {/* Unified label row — relative anchor so the input Handle centers on the title */}
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
        <span className="text-[11px] font-medium text-gray-300">{label}</span>
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
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: grad, boxShadow: `0 0 8px ${glow}` }}
    />
  );
}

/* ── Status badge (text label) ──
 * Used in the top-left header row of nodes & result cards so the user can
 * read the lifecycle state at a glance.  Color matches the status dot. */
export function StatusBadge({ status }: { status: CanvasNodeData["status"] }) {
  const style =
    status === "running"
      ? "bg-amber-400/10 text-amber-300 border-amber-400/20"
      : status === "done"
        ? "bg-emerald-400/10 text-emerald-300 border-emerald-400/20"
        : status === "error"
          ? "bg-rose-400/10 text-rose-300 border-rose-400/20"
          : "bg-white/5 text-gray-300 border-white/8";
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${style}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ── "Type char + name" chip ──
 * Shared by the node header and the result-card header so every surface
 * displays a consistent top-left "type indicator + name" pair.  The char is
 * the kind's representative letter (T/I/V/A/W) rendered inside a circular
 * gradient that matches the kind's color. */
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
        className={`truncate font-semibold text-gray-100 ${
          isSm ? "text-[11px]" : "text-[13px]"
        }`}
      >
        {name}
      </span>
    </div>
  );
}
