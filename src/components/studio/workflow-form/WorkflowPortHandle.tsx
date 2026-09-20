"use client";

import { upperToken } from "~/lib/upper-token";
import React from "react";
import { Handle, Position, useNodeId } from "@xyflow/react";

/* ── 工作流画布端点样式（紧凑画布模式） ──
 * 端口配色按已定稿的设计规范：STRING/INT → 中性灰，
 * IMAGE → 紫，VIDEO → 粉，连线型（MODEL/CLIP/LATENT）→ 青。
 * 描边是中灰，在卡片（#16161C）与
 * 页面（#0A0A0F）背景上都读得出来。句柄 12px，骑在卡片
 * 边框上，一半露在节点外，与工作流画布完全一致。 */
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
  const t = upperToken(type);
  if (PORT_IMG.has(t)) return "#7C5CFC";
  if (PORT_VID.has(t)) return "#FF5CA8";
  if (t === "STRING" || t === "INT" || t === "FLOAT" || t === "NUMBER")
    return "#9A9AAD";
  if (t === "BOOLEAN" || t === "BOOL") return "#67E89D";
  return "#5BC6FF";
}

/** 端口行标签（每行右侧）的类型章样式。
 *  对齐 Ardot v2：STRING/INT/FLOAT → 中性表面 + `#9A9AAD` 文字；
 *  IMAGE/MASK → `--color-chip-type-image-bg` + `#7C5CFC` 0.4 描边 + `#7C5CFC` 文字；
 *  VIDEO/AUDIO → `--color-chip-type-video-bg` + `#FF5CA8` 0.4 描边 + `#FF5CA8` 文字。
 *  底色随主题（浅色档见 globals.css 的 `--color-chip-type-*-bg`）。
 *
 *  `type` 同时会提前归一化：当工作流原件里缺少声明、富化回落到 JS 类型推导时，
 *  原始的 `e.type` 可能漏出非 ComfyUI 的
 *  值（`"*"`、`""`，或历史上残留的
 *  `control_after_generate` 字符串如 `"fixed"`/`"randomize"`）。
 *  调用方已归类为数值的行（紧凑 WirePortRows 路径）上出现任何
 *  非 {INT,FLOAT,NUMBER} 类型，
 *  都强制成 INT，好让章对该行的编辑语义保持诚实。 */
/** 章视为已知 ComfyUI 数据类型的类型集合。任何别的已声明类型
 *（自定义节点的 `IMAGEUPLOAD`、厂商枚举 …）也**原样**渲染 ——
 * 用户规则：「type 是什么就显示什么类型」。`fallback` 只在
 * 元数据完全没带类型时启用（IO 整理时 ComfyUI 离线），
 * 那时调用方传入它渲染的控件所隐含的类型。 */
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

/* 导出 PortHandle —— WorkflowNode 的 outputs 行
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
  /** 覆盖 / 并入默认定位（如定高行用 { top: 14 }）。
   *  Ardot v2 锚点默认值仍然生效，除非
   *  在这里覆盖。 */
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
