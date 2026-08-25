"use client";

/**
 * PackageFooter — ComfyUI-native bottom-left package source label.
 *
 * ComfyUI draws a tiny dim label in the bottom-left of every canvas node
 * showing which package the node originated from ("DaSiWa-Nodes",
 * "ComfyMath", "rgthree-comfy", ...). This is invaluable for debugging
 * "where did this node come from?" questions and matches the native UX, so
 * we mirror it on every node the editor renders.
 *
 * Resolution order (per `classType`):
 *   1. CUSTOM_NODE_PACKAGE map populated by `refreshCustomNodes()` — the
 *      exact directory name from the on-disk manifest ("DaSiWa-Nodes",
 *      "ComfyMath", "rgthree-comfy", ...). Empty when the manifest hasn't
 *      been fetched yet (e.g. before mount).
 *   2. config.rawCategory — ComfyUI's own `CATEGORY` attribute, used when
 *      the parser shipped an entry but no `package` field.
 *   3. "Custom" — generic fallback for any custom node we can't classify.
 *
 * Display rules:
 *   - Built-in nodes (no custom package) used to show the literal prefix
 *     "ComfyUI". Per user request that prefix is no longer shown — the
 *     footer is hidden entirely for built-in nodes.
 *   - Custom packages commonly carry a "ComfyUI-" directory prefix
 *     (e.g. "ComfyUI-DaSiWa-Nodes"). That prefix is stripped, so the label
 *     reads "DaSiWa-Nodes". Packages without the prefix are shown verbatim.
 *   - The label is rendered as a small bordered pill (1px hairline border)
 *     so the source name is visually distinguishable.
 *
 * IMPORTANT: rendered inline as a static child of the node card (NOT
 * absolute-positioned). This lets it flow naturally under the I/O rows so
 * no row overlap, and lets ReactFlow's auto-measurement handle the new
 * height. `pointer-events:none` so it never intercepts drag gestures.
 */

import type { NodeTypeConfig } from "@/components/workflow-canvas/types";
import { getCustomNodePackage } from "@/config/custom-nodes";

export function PackageFooter({
  config,
  classType,
  name,
}: {
  /** Optional — pass `config.custom`/`config.rawCategory` for richer fallback
   *  resolution.  Callers that don't have a `NodeTypeConfig` (e.g. WorkflowNode in
   *  the workspace editor) can omit it and supply `name` directly. */
  config?: NodeTypeConfig;
  classType: string;
  /** Override the resolved name.  When provided, used verbatim (e.g. when the
   *  caller already computed the right package from `getCustomNodePackage()`). */
  name?: string;
}) {
  const resolved =
    name ??
    (config?.custom
      ? (getCustomNodePackage(classType) ?? config.rawCategory ?? "Custom")
      : "ComfyUI");

  // Built-in nodes only ever resolve to the literal "ComfyUI" prefix — per
  // request we don't show that, so hide the footer. Custom packages drop the
  // "ComfyUI-" directory prefix for a cleaner label.
  const display =
    resolved === "ComfyUI"
      ? ""
      : resolved.startsWith("ComfyUI-")
        ? resolved.slice("ComfyUI-".length)
        : resolved;

  if (!display) return null;

  return (
    <div
      className="comfy-node__package"
      data-package={resolved}
      style={{
        display: "inline-block",
        alignSelf: "flex-start",
        marginTop: 4,
        marginLeft: 2,
        padding: "2px 6px",
        fontSize: 9,
        lineHeight: 1.2,
        fontFamily: '"SF Mono", ui-monospace, monospace',
        color: "rgba(255, 255, 255, 0.5)",
        letterSpacing: 0.3,
        border: "1px solid rgba(255, 255, 255, 0.22)",
        borderRadius: 4,
        pointerEvents: "none",
        userSelect: "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "calc(100% - 4px)",
      }}
      title={`来源包: ${resolved}`}
    >
      {display}
    </div>
  );
}
