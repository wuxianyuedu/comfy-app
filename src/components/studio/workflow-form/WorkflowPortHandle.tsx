"use client";

import React from "react";
import { Handle, Position, useNodeId } from "@xyflow/react";

/* ── Workflow-canvas endpoint styling (compact canvas mode) ──
 * Port colours per the landed design spec: STRING/INT → neutral grey,
 * IMAGE → violet, VIDEO → pink, link types (MODEL/CLIP/LATENT) → cyan.
 * The stroke is a mid-grey that reads on both the card (#16161C) and the
 * page (#0A0A0F) backgrounds. Handles are 12px and straddle the card
 * border so half sits outside the node, exactly like the workflow canvas. */
const PORT_STROKE = "#4D4D59";
const PORT_IMG = new Set(["IMAGE", "MASK"]);
const PORT_VID = new Set([
  "VIDEO",
  "VHS_FILENAMES",
  "VHS_VIDEOINFO",
  "VHS_AUDIO",
  "AUDIO",
]);

function portColorFor(type?: string): string {
  const t = (type ?? "").toUpperCase();
  if (PORT_IMG.has(t)) return "#7C5CFC";
  if (PORT_VID.has(t)) return "#FF5CA8";
  if (t === "STRING" || t === "INT" || t === "FLOAT" || t === "NUMBER")
    return "#9A9AAD";
  if (t === "BOOLEAN" || t === "BOOL") return "#67E89D";
  return "#5BC6FF";
}

/** Type-chip styling for the port-row label (right side of each row).
 *  Matches Ardot v2: STRING/INT/FLOAT → neutral surface + `#9A9AAD` text;
 *  IMAGE/MASK → `--color-chip-type-image-bg` + `#7C5CFC` 0.4 stroke + `#7C5CFC` text;
 *  VIDEO/AUDIO → `--color-chip-type-video-bg` + `#FF5CA8` 0.4 stroke + `#FF5CA8` text.
 *  底色随主题（浅色档见 globals.css 的 `--color-chip-type-*-bg`）。
 *
 *  `type` is also normalised up-front: the raw `e.type` can leak through
 *  non-ComfyUI values (`"*"`, `""`, or, historically, stray
 *  `control_after_generate` strings like `"fixed"`/`"randomize"`) when
 *  the workflow was imported as API-only and the enrichment fell back
 *  to JS-type inference.  Any non-{INT,FLOAT,NUMBER} type on a row the
 *  caller already classified as numeric (compact WirePortRows path)
 *  is coerced to INT so the chip is honest about the row's edit semantics. */
/** Types the chip treats as known ComfyUI data types.  Any other declared type
 *  (custom-node `IMAGEUPLOAD`, vendor enums, …) is ALSO rendered verbatim —
 *  user rule:「type 是什么就显示什么类型」.  `fallback` only kicks in when the
 *  metadata carries no type at all (ComfyUI was offline during IO curation),
 *  where the caller passes the type implied by the control it renders. */
const KNOWN_CHIP_TYPES = new Set([
  "INT",
  "FLOAT",
  "NUMBER",
  "STRING",
  "BOOLEAN",
  "BOOL",
  "COMBO",
  "IMAGE",
  "MASK",
  "VIDEO",
  "AUDIO",
  "IMAGEUPLOAD",
  "*",
]);

export function normalizeTypeChip(
  raw: string | undefined,
  fallback = "INT",
): string {
  const rawTrimmed = (raw ?? "").trim();
  const t = rawTrimmed.toUpperCase();
  if (t.length === 0) return fallback;
  if (KNOWN_CHIP_TYPES.has(t)) return t;
  /* 未在白名单里的自定义类型：只有明显非类型值的脏数据（如 control_after_generate
   *  漏进来的 "fixed" / "randomize" 小写枚举）才回退，其余原样展示。 */
  return rawTrimmed === t ? fallback : t;
}

export function portChipStyle(type?: string): {
  background: string;
  color: string;
  border?: string;
} {
  const t = normalizeTypeChip(type);
  /* 底色是**表面**（随主题），只有文字是类型色（类型色例外，见 globals.css
     的「固定暗色清单」）。写死 `#1E1A2E` / `#331A28` / `#26262E` 时，浅色主题下这颗
     chip 是「深底 + 深类型字」，叠在浅色面板上整块读不出来（ISSUE #609
     「浅色下预览 IO 这些看不清」——红框圈的就是它）。两态化后浅色拿极浅
     紫 / 粉 / 中性底，深色观感不变。 */
  if (PORT_IMG.has(t))
    return {
      background: "var(--color-chip-type-image-bg)",
      color: "#7C5CFC",
      border: "1px solid color-mix(in srgb, #7C5CFC 40%, transparent)",
    };
  if (PORT_VID.has(t))
    return {
      background: "var(--color-chip-type-video-bg)",
      color: "#FF5CA8",
      border: "1px solid color-mix(in srgb, #FF5CA8 40%, transparent)",
    };
  return { background: "var(--color-border-strong)", color: "#9A9AAD" };
}

/* export PortHandle — WorkflowNode outputs row
 *  现在也要复用这个端点。要避免飘移，handle 几何参数 / 锚点
 *  / 描边色规则都还在这里维护。 */
export function PortHandle({
  id,
  dir,
  type,
  style: extraStyle,
}: {
  id: string;
  dir: "in" | "out";
  type?: string;
  /** Override / merge into the default positioning (e.g. { top: 14 } for
   *  fixed-height rows).  Ardot v2 anchor defaults still apply unless
   *  overridden here. */
  style?: React.CSSProperties;
}) {
  /* React Flow 的 <Handle> 只能在自定义 Node 内渲染——它内部靠 useNodeId
   * 取宿主节点 id，拿不到就抛 error#010（"No node id found"）。IO 预览
   * 面板、工作流库预览这类「非节点」表面复用同一套行组件时没有该上下文，
   * 此时退化为几何完全一致的装饰圆点（预览不可连线，视觉不变）。 */
  const nodeId = useNodeId();
  const color = portColorFor(type);
  // Ardot v2：输入端点描边 `#4D4D59`（卡片/页面底色上都可读），
  // 输出端点描边用卡片底色 `#16161C` 形成「半圆在外/半圆在内」观感。
  const stroke = dir === "out" ? "#16161C" : PORT_STROKE;
  const dotStyle: React.CSSProperties = {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 9999,
    background: color,
    border: `1px solid ${stroke}`,
    // Ardot 稿：`DROP_SHADOW` rgba(0,0,0,0.25) y4 blur4，节点下方轻投影。
    boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
    // v3: Handle 圆心必须挂在 subrow 中心才能精确对齐
    // Ardot 稿 y=91/177/265（PortRow h=86 + PortRow3 h=33 单行结构）。
    // 父元素 (subrow) 必须 `relative`，否则会找更外层的 row wrapper，
    // 圆心落在 row 50% 而不是 subrow 50%，导致圆点偏下。
    ...(dir === "in"
      ? { left: -6, top: "50%", transform: "translateY(-50%)" }
      : { right: -6, top: "50%", transform: "translateY(-50%)" }),
    // v4: 行高被严格固定后，Handle 圆心由 caller 用
    // 像素级 top 直接锁（PortRow subrow 圆心 y_in_row=14；PortRowInt
    // 单行圆心 y_in_row=16.5；OutputRow y_in_row=14）。
    ...extraStyle,
  };

  /* 端点圆点带一个稳定的数据属性：工作流库那层只读连线要量它的**圆心**
   *  （行的左沿 + 行高中线并不等于圆点位置 —— 组合控件折叠后行是两行结构，
   *  圆点锁在标签行中线，按整行 50% 量就会把线画到圆点下方十几像素处，表现为
   *  「线没有连接到端点上」）。 */
  if (!nodeId) {
    return <span aria-hidden style={dotStyle} data-port-dot={id} />;
  }

  return (
    <Handle
      type={dir === "in" ? "target" : "source"}
      position={dir === "in" ? Position.Left : Position.Right}
      id={id}
      style={dotStyle}
      data-port-dot={id}
    />
  );
}
