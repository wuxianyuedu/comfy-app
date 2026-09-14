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
import React from "react";

/* ── 类型 chip ── */
function PortChip({ type }: { type: string }) {
  const t = type.toUpperCase();
  const isImg = t === "IMAGE" || t === "MASK";
  const isVid = t === "VIDEO" || t.startsWith("VHS") || t === "AUDIO";
  const style = isImg
    ? { background: "#1E1A2E", color: "#7C5CFC", border: "1px solid rgba(124,92,252,0.4)" }
    : isVid
      ? { background: "#331A28", color: "#FF5CA8", border: "1px solid rgba(255,92,168,0.4)" }
      : { background: "#26262E", color: "#9A9AAD", border: "1px solid rgba(255,255,255,0.06)" };
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ fontFamily: "var(--font-sans)", ...style }}
    >
      {type}
    </span>
  );
}

const portColor = (type?: string) => {
  const t = (type ?? "").toUpperCase();
  if (t === "IMAGE" || t === "MASK") return "#7C5CFC";
  if (t === "VIDEO" || t.startsWith("VHS") || t === "AUDIO") return "#FF5CA8";
  if (t === "BOOLEAN" || t === "BOOL") return "#67E89D";
  return "#9A9AAD";
};

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
  const stroke = side === "right" ? "#16161C" : "#4D4D59";
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute h-3 w-3 rounded-full"
      style={{
        background: color,
        border: `1px solid ${stroke}`,
        boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
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
      <div className="flex h-4 items-center justify-between gap-2.5 pl-[14px] pr-[14px]">
        <span
          className="text-[12px] font-medium text-ink-bright"
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
        className="bg-canvas-deep text-ink-soft mx-[14px] h-[52px] resize-none rounded-md border border-border-subtle px-2.5 py-2 text-[11px] leading-relaxed text-ink-soft outline-none"
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
    <div className="flex h-[33px] items-center gap-2.5 pl-[14px] pr-[14px]">
      <span
        className="text-[12px] font-medium text-ink-bright"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {label}
      </span>
      <div className="flex-1" />
      <input
        readOnly
        defaultValue={value}
        className="h-[21px] w-[140px] rounded border border-border-strong bg-canvas-deep px-2 text-right text-[12px] tabular-nums text-ink-bright outline-none"
        style={{ fontFamily: "var(--font-sans)" }}
      />
      <PortChip type={type} />
    </div>
  );
}

/* ── 输出端口行（28h：spacer + label + chip + pr 让出右端点位置） ── */
function PortRowOutput({
  label,
  type,
}: {
  label: string;
  type: string;
}) {
  return (
    <div className="flex h-7 items-center gap-2.5 pl-[14px] pr-[14px]">
      <div className="flex-1" />
      <span
        className="text-[12px] font-medium text-ink-bright"
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
      <div className="relative rounded-[14px] border border-border-strong bg-card overflow-hidden">
        {/* ── CardHeader 340×32 ── */}
        <div className="flex h-8 items-center justify-between gap-2.5 pl-[14px] pr-[14px]">
          <div className="flex items-center gap-2.5">
            <span
              aria-label="类型 工作流"
              className="flex h-7 w-7 items-center justify-center rounded-[14px] text-[14px] font-bold text-(--color-primary)"
              style={{ background: "#2A1F4A", fontFamily: "var(--font-sans)" }}
            >
              W
            </span>
            <span
              className="text-[14px] font-bold text-ink-bright"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              自定义工作流
            </span>
          </div>
          <div
            className="flex h-5 shrink-0 items-center gap-[5px] rounded-[11px] bg-(--color-node-accent) px-2"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-(--color-primary)" />
            <span
              className="text-[10px] font-medium text-ink-soft"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              待开始
            </span>
          </div>
        </div>

        {/* ── Divider 340×1 ── */}
        <div className="h-px bg-(--color-border-strong)" />

        {/* ── WorkflowChipRow 340×44（chip 24h 居中）── */}
        {/* 顺序：本机（位置）→ image_z_image_int8（名称）→ T2I（类型，最右） */}
        <div className="flex h-11 items-center gap-1.5 pl-[14px] pr-[14px]">
          {/* Chip 1：本机（位置）· 绿点+本机+▾ */}
          <button
            type="button"
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-lg border border-(--color-primary)/35 bg-(--color-node-accent) px-2.5 text-[12px]"
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: "#33D499" }}
            />
            <span
              className="text-[#33D499] font-semibold"
              style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
            >
              本机
            </span>
            <span aria-hidden className="shrink-0 text-(--color-ink-icon)" style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}>▾</span>
          </button>
          {/* Chip 2：image_z_image_int8（具体工作流名）· flex-1 撑满中间 */}
          <button
            type="button"
            className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-(--color-primary)/35 bg-(--color-node-accent) px-2.5 text-[12px]"
          >
            <span
              className="min-w-0 flex-1 truncate text-left font-semibold text-ink-bright"
              style={{ fontFamily: "var(--font-sans)", fontSize: 11 }}
            >
              image_z_image_int8
            </span>
            <span aria-hidden className="shrink-0 text-(--color-ink-icon)" style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}>▾</span>
          </button>
          {/* Chip 3：T2I（类型，单独下拉，最右）· 紫描边加深强调可切换 */}
          <button
            type="button"
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-lg border border-(--color-primary)/55.00000000000001 bg-(--color-node-accent) px-2.5 text-[12px]"
          >
            <span
              className="font-medium text-ink-bright"
              style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
            >
              T2I
            </span>
            <span aria-hidden className="shrink-0 text-ink-muted" style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}>▾</span>
          </button>
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
        <button
          type="button"
          className="flex h-[43px] w-full items-center justify-center gap-2 bg-linear-to-r from-(--color-primary) to-(--color-accent) text-[13px] font-bold text-white"
          style={{
            fontFamily: "var(--font-sans)",
            boxShadow: "0 4px 12px rgba(124,92,252,0.35)",
          }}
        >
          ▶ 用此工作流生成
        </button>
      </div>

      {/* ── 端点层（外层 wrapper 的 absolute 子元素，骑跨 Card 边框）──
          y 坐标按 Ardot 实测（3:161/3:162/3:163 + 输出行 y=282 h=28, 圆心 296） */}
      <div className="pointer-events-none absolute inset-0">
        <PortDot side="left"  top={91}  color={portColor("STRING")} />
        <PortDot side="left"  top={177} color={portColor("STRING")} />
        <PortDot side="left"  top={265} color={portColor("INT")} />
        <PortDot side="right" top={296} color={portColor("IMAGE")} />
      </div>
    </div>
  );
}

export default React.memo(WorkflowNodeArdot);
