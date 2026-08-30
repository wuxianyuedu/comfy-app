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
 */

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { NodeData, NodeTypeConfig } from "../types";
import { getNodeConfig } from "../node-registry";
import { PackageFooter } from "./PackageFooter";
import { DebugChainFooter } from "../../studio/debug/DebugChainFooter";
import { getWorkflowCanvasRenderChain } from "../../studio/canvas/workflow-canvas-render-chain";

/* ── Layout constants for the custom card (keep handles aligned to rows) ── */
const HEADER_H = 38;
const PAD_TOP = 6;
const ROW_H = 26;

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
          {previewFields.map((previewField) =>
(
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

/* ── Custom node card (extension-package style) ── */
function ComfyNodeCustom({
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
    ...inputs.map((input) =>({ kind: "in" as const, spec: input, idx: 0 })),
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

/** Render connection handles for inputs/outputs (default node path) */
function renderHandles(d: NodeData, type: "target" | "source") {
  if (type === "target") {
    const wiredInputs = Object.entries(d.inputs ?? {}).filter(([, v]) => Array.isArray(v));
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
      return 2;
    case "CLIPTextEncode":
    case "CLIPTextEncodeSDXL":
      return 1;
    case "KSampler":
    case "KSamplerAdvanced":
      return 1;
    case "VAEDecode":
      return 1;
    case "SaveImage":
      return 0;
    case "EmptyLatentImage":
      return 1;
    case "LoadImage":
      return 2;
    default:
      return 1;
  }
}

export const ComfyNode = memo(ComfyNodeInner);
