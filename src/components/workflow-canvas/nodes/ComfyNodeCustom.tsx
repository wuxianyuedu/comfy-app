"use client";

/**
 * ComfyNodeCustom — "extension package" style card (config.custom === true).
 *
 * Solid rounded header, uppercase port-type labels, dark value chips for
 * defaults, and a "前端专属" pill for OUTPUT_NODE nodes. Driven entirely by
 * the read-only AST manifest (customNodes.manifest.json).
 */

import { Handle, Position } from "@xyflow/react";
import type { NodeData, NodeTypeConfig } from "../types";
import { PackageFooter } from "./PackageFooter";
import { DebugChainFooter } from "../../studio/debug/DebugChainFooter";
import { getWorkflowCanvasRenderChain } from "../../studio/canvas/workflow-canvas-render-chain";

/* ── Layout constants for the custom card (keep handles aligned to rows) ── */
const HEADER_H = 38;
const PAD_TOP = 6;
const ROW_H = 26;

export function ComfyNodeCustom({
  d,
  config,
  selected,
}: {
  d: NodeData;
  config: NodeTypeConfig;
  selected: boolean;
}) {
  const inputs = config.inputsSpec ?? [];
  const outputs = config.outputsSpec ?? [];

  const rows = [
    ...inputs.map((input) => ({ kind: "in" as const, spec: input, idx: 0 })),
    ...outputs.map((spec, idx) => ({ kind: "out" as const, spec, idx })),
  ];

  return (
    <div
      className={`comfy-node comfy-node--custom ${selected ? "comfy-node--selected" : ""}`}
      data-node-id={d.comfyId}
      data-class-type={d.classType}
      style={{
        minWidth: config.width,
        background: "rgba(15, 10, 30, 0.95)",
        border: `1px solid ${selected ? config.color : "rgba(255,255,255,0.55)"}`,
        borderRadius: 12,
        boxShadow: selected
          ? `0 0 22px ${config.color}55, 0 4px 16px rgba(0,0,0,0.5)`
          : "0 2px 10px rgba(0,0,0,0.35)",
        overflow: "hidden",
        position: "relative",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Solid rounded header */}
      <div style={{
        height: HEADER_H,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px",
        background: config.color,
        color: "#fff",
        borderTopLeftRadius: 11,
        borderTopRightRadius: 11,
        fontWeight: 700,
        fontSize: 13,
      }}>
        <span style={{ fontSize: 14 }}>{config.icon ?? "\u{1F4E6}"}</span>
        <span style={{
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {d.label}
        </span>
        {config.outputNode && (
          <span style={{
            fontSize: 9,
            background: "rgba(0,0,0,0.28)",
            padding: "1px 6px",
            borderRadius: 999,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}>
            终端节点
          </span>
        )}
        {config.frontendOnly && (
          <span style={{
            fontSize: 9,
            background: "rgba(0,0,0,0.28)",
            padding: "1px 6px",
            borderRadius: 999,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}>
            前端专属
          </span>
        )}
      </div>

      {/* I/O rows */}
      <div style={{ paddingTop: PAD_TOP }}>
        {rows.map((r, ri) => {
          const top = HEADER_H + PAD_TOP + ri * ROW_H + ROW_H / 2;
          if (r.kind === "in") {
            return (
              <div
                key={`in-${r.spec.name}`}
                style={{
                  position: "relative",
                  height: ROW_H,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 12px",
                  fontSize: 11,
                }}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`in-${r.spec.name}`}
                  style={{ background: "#8B5CF6", width: 8, height: 8, left: -4, top }}
                />
                <span style={{
                  fontSize: 8.5,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  color: config.color,
                  border: `1px solid ${config.color}66`,
                  borderRadius: 4,
                  padding: "0 4px",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}>
                  {r.spec.type}
                </span>
                <span style={{ color: "#E7E2FB", fontWeight: 600 }}>{r.spec.name}</span>
                {r.spec.default !== undefined && r.spec.default !== null && (
                  <span style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    background: "rgba(0,0,0,0.4)",
                    color: "#C9C2E8",
                    borderRadius: 5,
                    padding: "1px 6px",
                    maxWidth: 90,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {/* 与 String(default) 运行时一致（JSON 值无 symbol），收窄以满足 no-base-to-string */}
                    {(r.spec.default as { toString(): string }).toString()}
                  </span>
                )}
              </div>
            );
          }
          return (
            <div
              key={`out-${ri}`}
              style={{
                position: "relative",
                height: ROW_H,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 6,
                padding: "0 12px",
                fontSize: 11,
              }}
            >
              <span style={{ color: "#CFE9FF", fontWeight: 600 }}>{r.spec.name}</span>
              <span style={{
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: 0.4,
                color: config.color,
                border: `1px solid ${config.color}66`,
                borderRadius: 4,
                padding: "0 4px",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}>
                {r.spec.type}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={`out-${r.idx}`}
                style={{ background: "#06B6D4", width: 8, height: 8, right: -4, top }}
              />
            </div>
          );
        })}
      </div>

      {/* ComfyUI-native bottom-left package source footer (custom card). */}
      <PackageFooter config={config} classType={d.classType} />
      {/* 调试模式：渲染链路模块标签（仅 debugMode 开启时显示） */}
      <DebugChainFooter modules={getWorkflowCanvasRenderChain(d.classType)} />
    </div>
  );
}
