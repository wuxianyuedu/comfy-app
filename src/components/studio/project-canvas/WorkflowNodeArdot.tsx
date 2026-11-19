/**
 * WorkflowNode.ardot.tsx — 纯设计转代码参考件（PURE DESIGN-TO-CODE · v4，不含运行时逻辑）；由 Ardot 稿 714503087315759（frame 3:12 NodeCard-v2）逐 token 落地。
 * v4 修正：Card 必须 overflow-hidden（保护 ActionBtn 圆角），但端点 x=-6/right=-6 会跑出卡外，故端点放在 wrapper 的 absolute 同辈层骑跨卡边。
 * token：Card #16161C / border #26262E / r14，端点 12px（in #4D4D59 / out #16161C），IMAGE/MASK #7C5CFC · VIDEO #FF5CA8 · STRING/INT #9A9AAD。
 */
import { upperToken } from "~/lib/upper-token";
import { TypeChip } from "~/components/studio/TypeChip";
import {
  WorkflowNodeActionButton,
  WorkflowNodePill,
} from "~/components/studio/workflow-form/WorkflowNodeParts";
import React from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

/* ── 端口类型色常量表（类型色例外：色值即类型语义，不随主题） ──
 * 与 `lib/comfyui/types.ts` 的 PORT_COLORS 同源；本文件只用到三档前缀，
 * 集中在这里而不是散在 JSX 里 —— 「成组集中的常量表」才是规范 §3.6.1
 * 「类型色例外」的合法载体，也便于扫描器显式豁免。 */
/* SAFETY: 类型断言已复核 */
const PORT_TYPE_COLORS = {
  image: "#7C5CFC",
  video: "#FF5CA8",
  boolean: "#67E89D",
} as const;

/** 端点圆点的投影 —— Ardot 稿 DROP_SHADOW rgba(0,0,0,0.25) y4 blur4，
 *  与 `WorkflowPortHandle` / 参数卡端点同源，属端点视觉常量。 */
const PORT_DOT_SHADOW = "0 4px 4px rgba(0,0,0,0.25)";

/** 端口类型 → 该类型的强调色（端点圆点 / chip 文字）。 */
const portColor = (type?: string) => {
  const t = upperToken(type);
  if (t === "IMAGE" || t === "MASK") {
    return PORT_TYPE_COLORS.image;
  }
  if (t === "VIDEO" || t.startsWith("VHS") || t === "AUDIO") {
    return PORT_TYPE_COLORS.video;
  }
  if (t === "BOOLEAN" || t === "BOOL") {
    return PORT_TYPE_COLORS.boolean;
  }
  return "var(--color-ink-muted)";
};

/** 类型 chip 的描边/文字同样取自类型色，只加透明度。 */
function portChipBorder(color: string) {
  return `1px solid color-mix(in srgb, ${color} 40%, transparent)`;
}

/* ── 类型 chip ── */
function PortChip({ type }: { type: string }) {
  const t = upperToken(type);
  const isImg = t === "IMAGE" || t === "MASK";
  const isVid = t === "VIDEO" || t.startsWith("VHS") || t === "AUDIO";
  const style = isImg
    ? {
        background: "var(--color-chip-type-image-bg)",
        color: PORT_TYPE_COLORS.image,
        border: portChipBorder(PORT_TYPE_COLORS.image),
      }
    : isVid
      ? {
          background: "var(--color-chip-type-video-bg)",
          color: PORT_TYPE_COLORS.video,
          border: portChipBorder(PORT_TYPE_COLORS.video),
        }
      : {
          background: "var(--color-subtle)",
          color: "var(--color-ink-muted)",
          border: "1px solid var(--color-border-subtle)",
        };
  return (
    <TypeChip style={style} tone="none">
      {type}
    </TypeChip>
  );
}

/* ── 端点（外层 wrapper 的 absolute 子元素，半圆骑跨 Card 边框）── */
function PortDot({
  side,
  color,
  top,
}: {
  color: string;
  side: "left" | "right";
  /** 距 wrapper 顶部 px（按 Ardot 实测绝对位置） */
  top: number;
}) {
  const stroke = side === "right" ? "var(--color-card)" : "var(--color-border-strong)";
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute size-3 rounded-full"
      style={{
        background: color,
        border: `1px solid ${stroke}`,
        boxShadow: PORT_DOT_SHADOW,
        top,
        transform: "translateY(-50%)",
        ...(side === "left" ? { left: -6 } : { right: -6 }),
      }}
    />
  );
}

/* ── STRING 端口行（label subrow + textarea，不含端点；端点由外层 wrapper 渲染）── */
function PortRowString({ label, type, value }: { label: string; type: string; value: string }) {
  return (
    <div className="flex h-21.5 flex-col gap-1.5 py-1.5">
      <div className="flex h-4 items-center justify-between gap-2.5 pr-3.5 pl-3.5">
        <span
          className="text-ink-bright text-xs font-medium"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {label}
        </span>
        <PortChip type={type} />
      </div>
      <Textarea
        className="bg-canvas-deep text-ink-soft border-border-subtle field-sizing-normal text-2xs mx-3.5 h-13 min-h-0 resize-none rounded-md border px-2.5 py-2 leading-relaxed focus-visible:ring-0"
        defaultValue={value}
        readOnly
        rows={2}
        style={{ fontFamily: "var(--font-sans)" }}
      />
    </div>
  );
}

/* ── INT/FLOAT 端口行（单行 33h：label + spacer + miniInput + chip） ── */
function PortRowInt({ label, type, value }: { label: string; type: string; value: string }) {
  return (
    <div className="flex h-8.25 items-center gap-2.5 pr-3.5 pl-3.5">
      <span
        className="text-ink-bright text-xs font-medium"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {label}
      </span>
      <div className="flex-1" />
      <input
        aria-label={label}
        className="border-border-strong bg-canvas-deep text-ink-bright h-5.25 w-35 rounded border px-2 text-right text-xs tabular-nums outline-none"
        defaultValue={value}
        readOnly
        style={{ fontFamily: "var(--font-sans)" }}
      />
      <PortChip type={type} />
    </div>
  );
}

/* ── 输出端口行（28h：spacer + label + chip + pr 让出右端点位置） ── */
function PortRowOutput({ label, type }: { label: string; type: string }) {
  return (
    <div className="flex h-7 items-center gap-2.5 pr-3.5 pl-3.5">
      <div className="flex-1" />
      <span
        className="text-ink-bright text-xs font-medium"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {label}
      </span>
      <PortChip type={type} />
    </div>
  );
}

/**
 * 纯视觉工作流节点（无运行时逻辑）。
 * 通过 nodeTypes.workflowArdot 渲染到画布，仅供先看视觉、再叠功能。
 * 结构：<div wrapper 340×353> + <Card overflow-hidden rounded-[14]> + <端点层 absolute inset-0>。
 */
export function WorkflowNodeArdot() {
  return (
    <div className="relative w-85">
      {/* ── Card 自身（overflow-hidden 保护底部 ActionBtn 圆角）── */}
      <div className="border-border-strong bg-card rounded-node relative overflow-hidden border">
        {/* ── CardHeader 340×32 ── */}
        <div className="flex h-8 items-center justify-between gap-2.5 pr-3.5 pl-3.5">
          <div className="flex items-center gap-2.5">
            <span
              aria-label="类型 工作流"
              className="text-primary rounded-node flex size-7 items-center justify-center text-sm font-bold"
              style={{
                background: "var(--color-node-accent)",
                fontFamily: "var(--font-sans)",
              }}
            >
              W
            </span>
            <span
              className="text-ink-bright text-sm font-bold"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              自定义工作流
            </span>
          </div>
          <WorkflowNodePill>
            <span className="bg-primary size-1.5 rounded-full" />
            <span
              className="text-ink-soft text-3xs font-medium"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              待开始
            </span>
          </WorkflowNodePill>
        </div>

        {/* ── Divider 340×1 ── */}
        <div className="bg-border-strong h-px" />

        {/* ── WorkflowChipRow 340×44（chip 24h 居中）── */}
        {/* 顺序：本机（位置）→ image_z_image_int8（名称）→ T2I（类型，最右） */}
        <div className="flex h-11 items-center gap-1.5 pr-3.5 pl-3.5">
          {/* Chip 1：本机（位置）· 绿点+本机+▾ */}
          <Button
            className="border-primary/35 bg-node-accent flex h-6 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-normal"
            variant="outline"
          >
            <span
              aria-hidden
              className="bg-status-online inline-block size-1.5 shrink-0 rounded-full"
            />
            <span
              className="text-status-online font-semibold"
              style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
            >
              本机
            </span>
            <span
              aria-hidden
              className="text-ink-icon shrink-0"
              style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
            >
              ▾
            </span>
          </Button>
          {/* Chip 2：image_z_image_int8（具体工作流名）· flex-1 撑满中间 */}
          <Button
            className="border-primary/35 bg-node-accent flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-normal"
            variant="outline"
          >
            <span
              className="text-ink-bright min-w-0 flex-1 truncate text-left font-semibold"
              style={{ fontFamily: "var(--font-sans)", fontSize: 11 }}
            >
              image_z_image_int8
            </span>
            <span
              aria-hidden
              className="text-ink-icon shrink-0"
              style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
            >
              ▾
            </span>
          </Button>
          {/* Chip 3：T2I（类型，单独下拉，最右）· 紫描边加深强调可切换 */}
          <Button
            className="border-primary/55 bg-node-accent flex h-6 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-normal"
            variant="outline"
          >
            <span
              className="text-ink-bright font-medium"
              style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
            >
              T2I
            </span>
            <span
              aria-hidden
              className="text-ink-muted shrink-0"
              style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
            >
              ▾
            </span>
          </Button>
        </div>

        {/* ── 端口行（输入） ── */}
        <PortRowString
          label="positive_prompt"
          type="STRING"
          value="1girl, silver hair, intricate white armor, soft cinematic lighting, highly detailed, masterpiece --ar 3:4"
        />
        <PortRowString
          label="negative_prompt"
          type="STRING"
          value="lowres, bad anatomy, worst quality, blurry, extra fingers, watermark, text"
        />
        <PortRowInt label="seed" type="INT" value="378304737375764" />

        {/* ── 输出端口行 ── */}
        <PortRowOutput label="images" type="IMAGE" />

        {/* ── ActionBtn 340×43（紧贴端口行下沿，0 间距；Card 自带 overflow-hidden，
              所以四角交还给卡片 —— 形状本身走唯一出处 WorkflowNodeParts）── */}
        <WorkflowNodeActionButton corner="clipped" label="▶ 用此工作流生成" />
      </div>

      {/* ── 端点层（外层 wrapper 的 absolute 子元素，骑跨 Card 边框）──
          y 坐标按 Ardot 实测（3:161/3:162/3:163 + 输出行 y=282 h=28, 圆心 296） */}
      <div className="pointer-events-none absolute inset-0">
        <PortDot color={portColor("STRING")} side="left" top={91} />
        <PortDot color={portColor("STRING")} side="left" top={177} />
        <PortDot color={portColor("INT")} side="left" top={265} />
        <PortDot color={portColor("IMAGE")} side="right" top={296} />
      </div>
    </div>
  );
}

const MemoizedWorkflowNodeArdot = React.memo(WorkflowNodeArdot);
MemoizedWorkflowNodeArdot.displayName = "WorkflowNodeArdot";
export default MemoizedWorkflowNodeArdot;
