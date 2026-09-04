"use client";

/**
 * ComfyNode — Custom ReactFlow node for every ComfyUI class_type
 *
 * Two visual modes:
 *  - Default: themed card with accent bar + icon + label + role badge.
 *  - Custom (config.custom === true): the "extension package" style shown in
 *    the product screenshot — solid rounded header, uppercase port-type labels,
 *    dark value chips for defaults, and a "前端专属" pill for OUTPUT_NODE nodes.
 *    Driven entirely by the read-only AST manifest (customNodes.manifest.json).
 *
 * The custom-card layout lives in ./ComfyNodeCustom; default-node connection
 * handles live in ./ComfyNodeHandles (kept out of this file to stay focused).
 */

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { NodeData } from "../types";
import { getNodeConfig } from "../node-registry";
import { PackageFooter } from "./PackageFooter";
import { DebugChainFooter } from "../../studio/debug/DebugChainFooter";
import { getWorkflowCanvasRenderChain } from "../../studio/canvas/workflow-canvas-render-chain";
import { ComfyNodeCustom } from "./ComfyNodeCustom";
import { renderHandles } from "./ComfyNodeHandles";

function ComfyNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const config = getNodeConfig(d.classType);

  if (config.custom) {
    return <ComfyNodeCustom d={d} config={config} selected={!!selected} />;
  }

  // ── Default (built-in) rendering ──
  const roleLabel: Record<string, string> = {
    positive: "正向",
    negative: "负向",
    checkpoint: "模型",
    sampler: "采样",
    lora: "LoRA",
    output: "输出",
    input: "输入",
  };

  const previewFields = d.fields?.filter((field) => !field.hidden).slice(0, 2) ?? [];
  const getPreviewValue = (key: string) => {
    const v = (d.inputs as Record<string, unknown> | undefined)?.[key];
    if (typeof v !== "string") return "";
    if (v.length > 30) return v.slice(0, 28) + "...";
    return v;
  };

  return (
    <div
      className={`comfy-node ${selected ? "comfy-node--selected" : ""}`}
      data-node-id={d.comfyId}
      data-class-type={d.classType}
      style={{
        minWidth: config.width,
        background: "rgba(15, 10, 30, 0.95)",
        border: `1px solid ${selected ? config.color : "rgba(255,255,255,0.1)"}`,
        borderRadius: 12,
        boxShadow: selected
          ? `0 0 20px ${config.color}33, 0 4px 16px rgba(0,0,0,0.5)`
          : "0 2px 8px rgba(0,0,0,0.3)",
        transition: "box-shadow 0.2s, border-color 0.2s",
        overflow: "hidden",
        position: "relative",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ height: 3, background: config.color }} />

      <div style={{
        padding: "8px 12px 4px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <span style={{
          fontSize: 16,
          width: 24,
          height: 24,
          display: "grid",
          placeItems: "center",
          background: `${config.color}22`,
          borderRadius: 6,
          flexShrink: 0,
        }}>
          {config.icon ?? "\u2699"}
        </span>

        <span style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#F4EEFF",
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {d.label}
        </span>

        {d.role && (
          <span style={{
            fontSize: 10,
            padding: "1px 7px",
            borderRadius: 999,
            background: `${config.color}33`,
            color: config.color,
            border: `1px solid ${config.color}55`,
            whiteSpace: "nowrap",
            fontWeight: 600,
          }}>
            {roleLabel[d.role] ?? d.role}
          </span>
        )}
      </div>

      {previewFields.length > 0 && (
        <div style={{
          padding: "0 12px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}>
          {previewFields.map((previewField) => (
            <div key={previewField.key} style={{ fontSize: 11, color: "#A99BC7" }}>
              <span style={{ color: "#6B7280", marginRight: 4 }}>{previewField.label}:</span>
              <span style={{
                color: "#D4CFF9",
                fontFamily: "var(--font-mono)",
                wordBreak: "break-all",
              }}>
                {getPreviewValue(previewField.key) || (
                  <span style={{ fontStyle: "italic", opacity: 0.5 }}>{previewField.placeholder ?? "..."}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ComfyUI-native bottom-left package source footer
          (replaces the older debug-only classType footer line). */}
      {renderHandles(d, "target")}
      {renderHandles(d, "source")}
      <PackageFooter config={config} classType={d.classType} />
      {/* 调试模式：渲染链路模块标签（仅 debugMode 开启时显示） */}
      <DebugChainFooter modules={getWorkflowCanvasRenderChain(d.classType)} />
    </div>
  );
}

export const ComfyNode = memo(ComfyNodeInner);
