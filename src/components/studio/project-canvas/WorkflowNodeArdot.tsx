/**
 * WorkflowNode.ardot.tsx — 纯设计转代码参考件（PURE DESIGN-TO-CODE · v4）
 *
 * 由 Ardot 稿 714503087315759（项目画布节点 v2 重设计，frame 3:12 NodeCard-v2）
 * 逐 token 落地。本文件**不含任何运行时逻辑**。
 *
 * v4 关键修正（端点必须骑跨在 Card 边框上）：
 *   - Card 必须 `overflow-hidden`（保护底部 ActionBtn 圆角不被矩形 fill 盖出角）
 *   - 但端点 x=-6 / right=-6 会跑到 Card 外 → 不能让 Card 把端点切了
 *   - 解法：把 Card 包一层 wrapper，端点作为 wrapper 的 absolute 同辈子元素
 *     骑跨在 Card 上，Card 自身圆角和 ActionBtn 圆角都不被破坏
 *
 * v3 → v4 → v5 演进：
 *  v3：删内层 #0B0B10 容器，Card 半径 12→14，端点绑 subrow 中心
 *  v4：端点提到外层 wrapper（absolute inset-0 层），Card 保留 overflow-hidden
 *  v5：subrow pl 回到 14（与 Ardot 3:40/3:46/3:52 实测一致）
 *
 * v2/v3/v4/v5 共同 token（来自 batch_read 实测对齐）：
 *   Card        #16161C / border #26262E / radius 14 / 内部 overflow-hidden
 *   Header      340×32 · W 图标 #2A1F4A r14 28×28 + 状态胶囊 #1E1A2E r11 57×20
 *   Divider     340×1 #26262E
 *   ChipRow     340×44 居中放 312×24 #1E1A2E 紫描边 r8 chip
 *   端口行高度   STRING(86) INT(33) Output(28)
 *   端口色      STRING/INT → #9A9AAD · IMAGE/MASK → #7C5CFC · VIDEO → #FF5CA8
 *   端点        12px / 描边 in #4D4D59 · out #16161C（卡片底色）/ 投影 0 4 4
 *   端点位置    in left:-6 / out right:-6，圆心 = 卡缘 ±0，外露 6px 半圆
 *   TypeChip    STRING/INT #26262E r3 · IMAGE #1E1A2E+紫描边 r3
 *   ActionBtn   340×43 渐变 #7C5CFC→#FF5CA8 r14
 *   Subrow/X 起点 14（与 Card padding 一致）
 *   字体        Noto Sans SC（中文） / Inter（数字·类型 chip）
 */
import { upperToken } from "~/lib/upper-token";
import React from "react";
import { Button } from "~/components/ui/button";

/* ── 端口类型色常量表（类型色例外：色值即类型语义，不随主题） ──
 * 与 `lib/comfyui/types.ts` 的 PORT_COLORS 同源；本文件只用到三档前缀，
 * 集中在这里而不是散在 JSX 里 —— 「成组集中的常量表」才是规范 §3.6.1
 * 「类型色例外」的合法载体，也便于扫描器显式豁免。 */
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
  if (t === "IMAGE" || t === "MASK") return PORT_TYPE_COLORS.image;
  if (t === "VIDEO" || t.startsWith("VHS") || t === "AUDIO")
    return PORT_TYPE_COLORS.video;
  if (t === "BOOLEAN" || t === "BOOL") return PORT_TYPE_COLORS.boolean;
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
    <span
      className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ fontFamily: "var(--font-sans)", ...style }}
    >
      {type}
    </span>
  );
}

/* ── 端点（外层 wrapper 的 absolute 子元素，半圆骑跨 Card 边框）── */
function PortDot({
  side,
  color,
  top,
}: {
  side: "left" | "right";
  color: string;
  /** 距 wrapper 顶部 px（按 Ardot 实测绝对位置） */
  top: number;
}) {
  const stroke =
    side === "right" ? "var(--color-card)" : "var(--color-border-strong)";
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute h-3 w-3 rounded-full"
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
function PortRowString({
  label,
  type,
  value,
}: {
  label: string;
  type: string;
  value: string;
}) {
  return (
    <div className="flex h-[86px] flex-col gap-[6px] py-[6px]">
      <div className="flex h-4 items-center justify-between gap-2.5 pr-[14px] pl-[14px]">
        <span
          className="text-ink-bright text-[12px] font-medium"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {label}
        </span>
        <PortChip type={type} />
      </div>
      <textarea
        readOnly
        rows={2}
        defaultValue={value}
        className="bg-canvas-deep text-ink-soft border-border-subtle text-ink-soft mx-[14px] h-[52px] resize-none rounded-md border px-2.5 py-2 text-[11px] leading-relaxed outline-none"
        style={{ fontFamily: "var(--font-sans)" }}
      />
    </div>
  );
}

/* ── INT/FLOAT 端口行（单行 33h：label + spacer + miniInput + chip） ── */
function PortRowInt({
  label,
  type,
  value,
}: {
  label: string;
  type: string;
  value: string;
}) {
  return (
    <div className="flex h-[33px] items-center gap-2.5 pr-[14px] pl-[14px]">
      <span
        className="text-ink-bright text-[12px] font-medium"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {label}
      </span>
      <div className="flex-1" />
      <input
        readOnly
        defaultValue={value}
        className="border-border-strong bg-canvas-deep text-ink-bright h-[21px] w-[140px] rounded border px-2 text-right text-[12px] tabular-nums outline-none"
        style={{ fontFamily: "var(--font-sans)" }}
      />
      <PortChip type={type} />
    </div>
  );
}

/* ── 输出端口行（28h：spacer + label + chip + pr 让出右端点位置） ── */
function PortRowOutput({ label, type }: { label: string; type: string }) {
  return (
    <div className="flex h-7 items-center gap-2.5 pr-[14px] pl-[14px]">
      <div className="flex-1" />
      <span
        className="text-ink-bright text-[12px] font-medium"
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
 *
 * 结构：
 *   <div wrapper 340x353>
 *     <Card overflow-hidden + rounded-[14] + 内容/>
 *     <端点层 absolute inset-0 />     ← 端点骑跨卡边
 *   </div>
 */
export function WorkflowNodeArdot() {
  return (
    <div className="relative w-[340px]">
      {/* ── Card 自身（overflow-hidden 保护底部 ActionBtn 圆角）── */}
      <div className="border-border-strong bg-card relative overflow-hidden rounded-[14px] border">
        {/* ── CardHeader 340×32 ── */}
        <div className="flex h-8 items-center justify-between gap-2.5 pr-[14px] pl-[14px]">
          <div className="flex items-center gap-2.5">
            <span
              aria-label="类型 工作流"
              className="text-primary flex h-7 w-7 items-center justify-center rounded-[14px] text-[14px] font-bold"
              style={{
                background: "var(--color-node-accent)",
                fontFamily: "var(--font-sans)",
              }}
            >
              W
            </span>
            <span
              className="text-ink-bright text-[14px] font-bold"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              自定义工作流
            </span>
          </div>
          <div className="bg-node-accent flex h-5 shrink-0 items-center gap-[5px] rounded-[11px] px-2">
            <span className="bg-primary h-1.5 w-1.5 rounded-full" />
            <span
              className="text-ink-soft text-[10px] font-medium"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              待开始
            </span>
          </div>
        </div>

        {/* ── Divider 340×1 ── */}
        <div className="bg-border-strong h-px" />

        {/* ── WorkflowChipRow 340×44（chip 24h 居中）── */}
        {/* 顺序：本机（位置）→ image_z_image_int8（名称）→ T2I（类型，最右） */}
        <div className="flex h-11 items-center gap-1.5 pr-[14px] pl-[14px]">
          {/* Chip 1：本机（位置）· 绿点+本机+▾ */}
          <Button
            variant="outline"
            className="border-primary/35 bg-node-accent flex h-6 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-normal"
          >
            <span
              aria-hidden
              className="bg-status-online inline-block h-1.5 w-1.5 shrink-0 rounded-full"
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
            variant="outline"
            className="border-primary/35 bg-node-accent flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-normal"
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
            variant="outline"
            className="border-primary/55 bg-node-accent flex h-6 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-normal"
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
          value={
            "1girl, silver hair, intricate white armor, soft cinematic lighting, highly detailed, masterpiece --ar 3:4"
          }
        />
        <PortRowString
          label="negative_prompt"
          type="STRING"
          value={
            "lowres, bad anatomy, worst quality, blurry, extra fingers, watermark, text"
          }
        />
        <PortRowInt label="seed" type="INT" value="378304737375764" />

        {/* ── 输出端口行 ── */}
        <PortRowOutput label="images" type="IMAGE" />

        {/* ── ActionBtn 340×43（紧贴端口行下沿，0 间距） ── */}
        <Button
          variant="primary-solid"
          className="from-primary to-accent flex h-[43px] w-full items-center justify-center gap-2 rounded-none bg-linear-to-r text-[13px] font-bold text-white hover:opacity-90"
          style={{
            fontFamily: "var(--font-sans)",
            boxShadow:
              "0 4px 12px color-mix(in srgb, var(--color-primary) 35%, transparent)",
          }}
        >
          ▶ 用此工作流生成
        </Button>
      </div>

      {/* ── 端点层（外层 wrapper 的 absolute 子元素，骑跨 Card 边框）──
          y 坐标按 Ardot 实测（3:161/3:162/3:163 + 输出行 y=282 h=28, 圆心 296） */}
      <div className="pointer-events-none absolute inset-0">
        <PortDot side="left" top={91} color={portColor("STRING")} />
        <PortDot side="left" top={177} color={portColor("STRING")} />
        <PortDot side="left" top={265} color={portColor("INT")} />
        <PortDot side="right" top={296} color={portColor("IMAGE")} />
      </div>
    </div>
  );
}

export default React.memo(WorkflowNodeArdot);
