"use client";

/**
 * ComfyNode — Custom ReactFlow node for every ComfyUI class_type
 *
 * Renders a themed card with:
 *  - Colored accent bar (by node category/color)
 *  - Icon + label
 *  - Role badge (positive/negative/checkpoint/sampler)
 *  - Input handles (left) and output handles (right)
 *  - Compact field preview (first 2 fields)
 */

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { NodeData } from "../types";
import { getNodeConfig } from "../node-registry";

function ComfyNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const config = getNodeConfig(d.classType);

  // Determine role display
  const roleLabel: Record<string, string> = {
    positive: "正向",
    negative: "负向",
    checkpoint: "模型",
    sampler: "采样",
    lora: "LoRA",
    output: "输出",
    input: "输入",
  };

  // Show first few non-hidden fields as preview text
  const previewFields = d.fields?.filter((f) => !f.hidden).slice(0, 2) ?? [];
  const getPreviewValue = (key: string) => {
    const v = d.inputs?.[key];
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
        fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif',
      }}
    >
      {/* Accent bar top */}
      <div style={{ height: 3, background: config.color }} />

      {/* Header */}
      <div style={{
        padding: "8px 12px 4px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        {/* Icon */}
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
          {config.icon || "\u2699"}
        </span>

        {/* Label */}
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

        {/* Role badge */}
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

      {/* Field previews */}
      {previewFields.length > 0 && (
        <div style={{
          padding: "0 12px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}>
          {previewFields.map((f) => (
            <div key={f.key} style={{ fontSize: 11, color: "#A99BC7" }}>
              <span style={{ color: "#6B7280", marginRight: 4 }}>{f.label}:</span>
              <span style={{
                color: "#D4CFF9",
                fontFamily: '"SF Mono", ui-monospace, monospace',
                wordBreak: "break-all",
              }}>
                {getPreviewValue(f.key) || (
                  <span style={{ fontStyle: "italic", opacity: 0.5 }}>{f.placeholder || "..."}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Class type hint */}
      <div style={{
        padding: "2px 12px 6px",
        fontSize: 9,
        color: "#555",
        borderTop: "1px solid rgba(255,255,255,0.04)",
      }}>
        {d.classType}
      </div>

      {/* Input handles (left side) — one per input that accepts connections */}
      {renderHandles(d, "target")}
      {/* Output handles (right side) */}
      {renderHandles(d, "source")}
    </div>
  );
}

/** Render connection handles for inputs/outputs */
function renderHandles(
  d: NodeData,
  type: "target" | "source"
) {
  if (type === "target") {
    // Target handles for each wired input
    const wiredInputs = Object.entries(d.inputs ?? {})
      .filter(([, v]) => Array.isArray(v));
    if (!wiredInputs.length) return null;

    return (
      <>
        {wiredInputs.map(([key], i) => (
          <Handle
            key={`in-${key}`}
            type="target"
            position={Position.Left}
            id={`in-${key}`}
            style={{
              background: "#8B5CF6",
              width: 8,
              height: 8,
              top: 28 + i * 18,
              left: -4,
            }}
          />
        ))}
        {/* Generic fallback handle */}
        <Handle
          type="target"
          position={Position.Left}
          id="in-generic"
          style={{
            background: "rgba(255,255,255,0.2)",
            width: 8,
            height: 8,
            top: "50%",
            left: -4,
          }}
        />
      </>
    );
  }

  // Source handles (outputs)
  const outputCount = countOutputs(d.classType);
  return (
    <>
      {Array.from({ length: outputCount }, (_, i) => (
        <Handle
          key={`out-${i}`}
          type="source"
          position={Position.Right}
          id={`out-${i}`}
          style={{
            background: "#06B6D4",
            width: 8,
            height: 8,
            top: 28 + i * 18,
            right: -4,
          }}
        />
      ))}
    </>
  );
}

/** Approximate number of outputs for common node types */
function countOutputs(classType: string): number {
  switch (classType) {
    case "CheckpointLoaderSimple":
    case "LoraLoader":
      return 2; // model(0), clip(1)
    case "CLIPTextEncode":
    case "CLIPTextEncodeSDXL":
      return 1; // conditioning
    case "KSampler":
    case "KSamplerAdvanced":
      return 1; // latent
    case "VAEDecode":
      return 1; // image
    case "SaveImage":
      return 0;
    case "EmptyLatentImage":
      return 1; // latent
    case "LoadImage":
      return 2; // image, mask
    default:
      return 1;
  }
}

export const ComfyNode = memo(ComfyNodeInner);
