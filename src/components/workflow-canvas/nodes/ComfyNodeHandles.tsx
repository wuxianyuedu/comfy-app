"use client";

/**
 * Connection-handle rendering for the default (built-in) ComfyNode card.
 * Extracted from ComfyNode.tsx so the node file stays focused on layout.
 */

import { Handle, Position } from "@xyflow/react";
import type { NodeData } from "../types";

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

/** Render connection handles for inputs/outputs (default node path) */
export function renderHandles(d: NodeData, type: "target" | "source") {
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
