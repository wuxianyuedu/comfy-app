"use client";

import React from "react";
import { Handle, Position } from "@xyflow/react";

/* ── Workflow-canvas endpoint styling (compact canvas mode) ──
 * Port colours per the landed design spec: STRING/INT → neutral grey,
 * IMAGE → violet, VIDEO → pink, link types (MODEL/CLIP/LATENT) → cyan.
 * The stroke is a mid-grey that reads on both the card (#16161C) and the
 * page (#0A0A0F) backgrounds. Handles are 12px and straddle the card
 * border so half sits outside the node, exactly like the workflow canvas. */
const PORT_STROKE = "#4D4D59";
const PORT_IMG = new Set(["IMAGE", "MASK"]);
const PORT_VID = new Set(["VIDEO", "VHS_FILENAMES", "VHS_VIDEOINFO", "VHS_AUDIO", "AUDIO"]);

function portColorFor(type?: string): string {
  const t = (type ?? "").toUpperCase();
  if (PORT_IMG.has(t)) return "#7C5CFC";
  if (PORT_VID.has(t)) return "#FF5CA8";
  if (t === "STRING" || t === "INT" || t === "FLOAT" || t === "NUMBER") return "#9A9AAD";
  if (t === "BOOLEAN" || t === "BOOL") return "#67E89D";
  return "#5BC6FF";
}

/** Type-chip styling for the port-row label (right side of each row).
 *  Matches Ardot v2: STRING/INT/FLOAT → `#26262E` solid + `#9A9AAD` text;
 *  IMAGE/MASK → `#1E1A2E` + `#7C5CFC` 0.4 stroke + `#7C5CFC` text;
 *  VIDEO/AUDIO → `#331A28` + `#FF5CA8` 0.4 stroke + `#FF5CA8` text.
 *
 *  `type` is also normalised up-front: the raw `e.type` can leak through
 *  non-ComfyUI values (`"*"`, `""`, or, historically, stray
 *  `control_after_generate` strings like `"fixed"`/`"randomize"`) when
 *  the workflow was imported as API-only and the enrichment fell back
 *  to JS-type inference.  Any non-{INT,FLOAT,NUMBER} type on a row the
 *  caller already classified as numeric (compact WirePortRows path)
 *  is coerced to INT so the chip is honest about the row's edit semantics. */
export function normalizeTypeChip(raw: string | undefined, fallback: "INT" | "FLOAT" = "INT"): string {
  const t = (raw ?? "").toUpperCase();
  if (t === "INT" || t === "FLOAT" || t === "NUMBER" || t === "STRING" || t === "BOOLEAN" || t === "BOOL" || t === "COMBO" || t === "IMAGE" || t === "MASK" || t === "VIDEO" || t === "AUDIO" || t === "*") return t;
  return fallback;
}

export function portChipStyle(type?: string): { background: string; color: string; border?: string } {
  const t = normalizeTypeChip(type);
  if (PORT_IMG.has(t)) return { background: "#1E1A2E", color: "#7C5CFC", border: "1px solid rgba(124,92,252,0.4)" };
  if (PORT_VID.has(t)) return { background: "#331A28", color: "#FF5CA8", border: "1px solid rgba(255,92,168,0.4)" };
  return { background: "#26262E", color: "#9A9AAD" };
}

/* R-ardot53 (2026-08-15): export PortHandle — WorkflowNode outputs row
 *  (2026-08-15) 现在也要复用这个端点。要避免飘移，handle 几何参数 / 锚点
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
  const color = portColorFor(type);
  // Ardot v2：输入端点描边 `#4D4D59`（卡片/页面底色上都可读），
  // 输出端点描边用卡片底色 `#16161C` 形成「半圆在外/半圆在内」观感。
  const stroke = dir === "out" ? "#16161C" : PORT_STROKE;
  return (
    <Handle
      type={dir === "in" ? "target" : "source"}
      position={dir === "in" ? Position.Left : Position.Right}
      id={id}
      style={{
        position: "absolute",
        width: 12,
        height: 12,
        borderRadius: 9999,
        background: color,
        border: `1px solid ${stroke}`,
        // Ardot 稿：`DROP_SHADOW` rgba(0,0,0,0.25) y4 blur4，节点下方轻投影。
        boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
        // v3 (R-ardot12): Handle 圆心必须挂在 subrow 中心才能精确对齐
        // Ardot 稿 y=91/177/265（PortRow h=86 + PortRow3 h=33 单行结构）。
        // 父元素 (subrow) 必须 `relative`，否则会找更外层的 row wrapper，
        // 圆心落在 row 50% 而不是 subrow 50%，导致圆点偏下。
        ...(dir === "in"
          ? { left: -6, top: "50%", transform: "translateY(-50%)" }
          : { right: -6, top: "50%", transform: "translateY(-50%)" }),
        // v4 (R-ardot16): 行高被严格固定后，Handle 圆心由 caller 用
        // 像素级 top 直接锁（PortRow subrow 圆心 y_in_row=14；PortRowInt
        // 单行圆心 y_in_row=16.5；OutputRow y_in_row=14）。
        ...extraStyle,
      }}
    />
  );
}
