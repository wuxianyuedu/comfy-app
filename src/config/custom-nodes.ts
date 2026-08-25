/**
 * customNodes.ts — Loads the generated custom-node manifest and exposes it as
 * `NodeTypeConfig` entries for the workflow canvas.
 *
 * The manifest (`src/generated/customNodes.manifest.json`) is produced by the
 * read-only AST parser (`scripts/parse_custom_nodes.py`) from the directories
 * configured via CUSTOM_NODES_PATH. The source custom_node packages are NEVER
 * imported or modified at runtime.
 *
 * IMPORTANT: We DELIBERATELY do NOT `import` the manifest at build time.
 * Turbopack treats that .json as a module, and HMR breaks whenever the parser
 * rewrites it (HMR can no longer match the original module pattern after the
 * file is replaced). Instead we lazily populate `CUSTOM_NODE_TYPES` from
 * the on-disk manifest via `refreshCustomNodes()` (called on canvas mount and
 * after every parse from CustomNodesSettings). The raw file is also served
 * directly via `/api/custom-nodes/manifest`.
 */

import type {
  NodeTypeConfig,
  PortSpec,
  FieldDef,
  FieldType,
} from "@/components/workflow-canvas/types";

/** Map a raw ComfyUI category string → accent color. Exported so the UI can
 *  render the same category colour for node-preview cards without having to
 *  bootstrap a full `NodeTypeConfig`. */
export const CATEGORY_COLORS: Record<string, string> = {
  loaders: "#F59E0B",
  loader: "#F59E0B",
  model: "#F59E0B",
  conditioners: "#8B5CF6",
  conditioner: "#8B5CF6",
  condition: "#8B5CF6",
  samplers: "#06B6D4",
  sampler: "#06B6D4",
  latent: "#10B981",
  image: "#3B82F6",
  images: "#3B82F6",
  video: "#10B981",
  audio: "#A855F7",
  mask: "#64748B",
  custom: "#7C5CFC",
  utils: "#6B7280",
  utility: "#6B7280",
};

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 62%)`;
}

export function colorFor(category: string | undefined): string {
  if (!category) return "#7C5CFC";
  const parts = category.replace(/\/$/, "").split("/");
  for (const p of parts) {
    const c = CATEGORY_COLORS[p.toLowerCase()];
    if (c) return c;
  }
  return hashColor(category);
}

/** Convert a manifest PortSpec into a FieldDef for the parameter editor. */
export function specToField(s: PortSpec): FieldDef {
  return {
    key: s.name,
    label: s.name,
    type: (s.widget as FieldType) ?? "string",
    options: s.options,
    placeholder:
      s.default !== undefined && s.default !== null ? String(s.default) : undefined,
    group: "参数",
    // Connection-only ports are rendered as handles, not editor fields.
    hidden: !s.widget,
  };
}

/** All custom node types, keyed by class_type. MUTABLE — `refreshCustomNodes`
 *  repopulates it from the on-disk manifest so the canvas updates live. */
export const CUSTOM_NODE_TYPES: Record<string, NodeTypeConfig> = {};

/** Package origin for each custom node type, keyed by class_type. MUTABLE —
 *  repopulated on every `refreshCustomNodes()` call. The value is the package
 *  directory name (e.g. "DaSiWa-Nodes", "ComfyMath") parsed from the on-disk
 *  manifest. Used by ComfyNode to render the ComfyUI-native bottom-left
 *  "package source" footer on every canvas node. */
export const CUSTOM_NODE_PACKAGE: Record<string, string> = {};

interface RawManifest {
  nodes?: Record<string, ManifestNode>;
}

interface ManifestInput {
  name: string;
  type: string;
  widget?: string | null;
  options?: string[] | null;
  default?: any;
  required?: boolean;
}

interface ManifestNode {
  classType: string;
  displayName?: string;
  category?: string;
  outputNode?: boolean;
  frontend_only?: boolean;
  function?: string | null;
  description?: string | null;
  inputs?: ManifestInput[];
  outputs?: Array<{ type: string; name: string }>;
  /** Source file on disk (informational only). */
  source?: string;
  /** Originating package directory name (e.g. "ComfyMath", "DaSiWa-Nodes").
   *  Populated by the parser from the package's top-level __init__ folder.
   *  Stored separately in CUSTOM_NODE_PACKAGE so the canvas bottom-left
   *  footer can look it up without re-parsing the manifest. */
  package?: string;
}

function buildInto(
  target: Record<string, NodeTypeConfig>,
  manifest: RawManifest,
  packages?: Record<string, string>,
): number {
  let count = 0;
  for (const [ct, n] of Object.entries(manifest.nodes ?? {})) {
    if (!n) continue;
    const inputs: PortSpec[] = (n.inputs ?? []).map((input) => ({
      name: input.name,
      type: input.type,
      widget: (input.widget as FieldType) || undefined,
      options: input.options || undefined,
      default: input.default,
      required: !!input.required,
    }));
    const outputs: PortSpec[] = (n.outputs ?? []).map((output) => ({
      name: output.name,
      type: output.type,
      required: true,
    }));
    target[ct] = {
      label: n.displayName ?? ct,
      color: colorFor(n.category),
      icon: "\u{1F4E6}", // 📦 package — signals a custom node package
      category: "custom",
      rawCategory: n.category,
      custom: true,
      // ⚠️ 概念澄清：OUTPUT_NODE（终端节点，后端仍执行）与 properties.frontend_only
      // （纯前端节点，后端不执行）是**两个不同概念**，此处必须分开。
      outputNode: !!n.outputNode,
      frontendOnly: !!n.frontend_only,
      description: n.description ?? undefined,
      width: 240,
      height: 90,
      inputsSpec: inputs,
      outputsSpec: outputs,
      defaultFields: inputs.map(specToField),
    };
    // Stash the package origin (e.g. "DaSiWa-Nodes", "ComfyMath") so the
    // canvas can render the ComfyUI-native bottom-left footer. Falls back
    // to the raw category string when the manifest didn't ship a package
    // name (older parser versions / hand-edited manifests).
    if (packages && n.package) packages[ct] = n.package;
    count++;
  }
  return count;
}

/** Look up the package source for a custom node class type. Returns undefined
 *  for built-in nodes or for custom types whose manifest entry lacks a
 *  `package` field. ComfyNode uses this to render the bottom-left footer; for
 *  built-in nodes the footer falls back to a literal "ComfyUI" instead. */
export function getCustomNodePackage(classType: string): string | undefined {
  return CUSTOM_NODE_PACKAGE[classType];
}

// NOTE: no static seed — see file header. `CUSTOM_NODE_TYPES` is populated
// on canvas mount via `refreshCustomNodes()` from `/api/custom-nodes/manifest`.

export function isCustomNode(classType: string): boolean {
  return classType in CUSTOM_NODE_TYPES;
}

/** Event name broadcast whenever `refreshCustomNodes()` finishes applying a
 *  fresh manifest. Components that render a registry-dependent view (e.g.
 *  `WorkflowCanvas`'s add-node menu) subscribe to this and bump their own
 *  version state so React re-runs `getAllNodeTypes()`. Without this the canvas
 *  would only see changes mounted at first-load — parsed-from-settings updates
 *  would be invisible until a hard reload. */
export const CUSTOM_NODES_UPDATED_EVENT = "custom-nodes:updated";

/** Raw shape of a single node from `/api/custom-nodes/manifest.nodes`. The
 *  custom-node settings panel uses this directly so it can render mini-previews
 *  even when the registry hasn't been built yet (e.g. right after a parse,
 *  before any consumer has called `refreshCustomNodes`). */
export interface ManifestNodeRaw {
  classType: string;
  displayName?: string;
  category?: string;
  outputNode?: boolean;
  function?: string | null;
  description?: string | null;
  inputs?: Array<{
    name: string;
    type: string;
    widget?: string | null;
    options?: string[] | null;
    default?: any;
    required?: boolean;
  }>;
  outputs?: Array<{ type: string; name: string }>;
  source?: string;
  package?: string;
}

/** Fetch the raw manifest straight from disk. Returns null on missing/empty
 *  manifest (e.g. nothing parsed yet). Cheap on the server side — the file is
 *  already cached after the first parse. */
export async function getCustomNodesManifest(
  base = "",
): Promise<{ nodes: Record<string, ManifestNodeRaw> } | null> {
  try {
    const res = await fetch(`${base}/api/custom-nodes/manifest`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== "object" || !data.nodes) return null;
    return data as { nodes: Record<string, ManifestNodeRaw> };
  } catch {
    return null;
  }
}

/**
 * Live-refresh the registry from the on-disk manifest (via /api/custom-nodes/manifest).
 * Returns the number of custom node types now loaded. Safe to call after a parse.
 */
export async function refreshCustomNodes(base = ""): Promise<number> {
  try {
    const res = await fetch(`${base}/api/custom-nodes/manifest`);
    if (!res.ok) return 0;
    const manifest = (await res.json()) as RawManifest;
    const next: Record<string, NodeTypeConfig> = {};
    const nextPackages: Record<string, string> = {};
    const count = buildInto(next, manifest, nextPackages);
    // Replace contents of the exported const map (consumers hold the reference).
    for (const k of Object.keys(CUSTOM_NODE_TYPES)) delete CUSTOM_NODE_TYPES[k];
    Object.assign(CUSTOM_NODE_TYPES, next);
    // Mirror the package origin map so ComfyNode can render the bottom-left
    // footer without re-parsing the manifest.
    for (const k of Object.keys(CUSTOM_NODE_PACKAGE)) delete CUSTOM_NODE_PACKAGE[k];
    Object.assign(CUSTOM_NODE_PACKAGE, nextPackages);
    // Notify live views (canvas menu, etc.) that the registry mutated.
    // Guarded for SSR — the broadcaster and the subscribers only run in the
    // browser, where `CustomEvent` exists and listeners can render.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(CUSTOM_NODES_UPDATED_EVENT, { detail: { count } }),
      );
    }
    return count;
  } catch {
    return 0;
  }
}
