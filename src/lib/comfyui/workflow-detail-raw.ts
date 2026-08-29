/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
/**
 * RAW (UI-format) workflow parsing helpers — extracted from
 * workflow-detail.ts (T12 batch 4).
 *
 * These pure functions turn a rawJson blob into the lookup tables the
 * detail builders need: per-node input metadata (`rawInputsById`), exact
 * ComfyUI box sizes (`sizeById`), sparse output metadata (`rawNodeMeta`),
 * class-type lookup (`nodeTypeById`) and the raw-view packet (`rawView`).
 */
import {
  extractPositions,
  fallbackRawToApi,
  fetchWidgetOrderTable,
  mapWidgetValuesByOrder,
  type RawWorkflow,
} from "@/lib/comfyui/raw";
import { inferInputType, inferIsMultiline } from "@/lib/comfyui/types";

/* IMAGE-input thumbnail preview (2026-08-10 R27, narrowed in R28).  ComfyUI's
 * LoadImage node keeps the uploaded filename in `widgets_values[0]`; we
 * surface that as an inline preview by stamping a synthetic `preview`-marked
 * entry onto the LoadImage node itself.  We DO NOT propagate `imageRef` to
 * downstream IMAGE inputs (ImageScale / CLIPVisionEncode / …) because those
 * renderings would always show the unscaled / un-encoded upstream image
 * (just a duplicate of the LoadImage preview), which is meaningless per
 * 2026-08-10 user feedback — only the source LoadImage node should paint
 * the thumbnail.  Empty LoadImage uploads (widgets_values[0] missing/empty)
 * still push the synthetic entry — without `imageRef` — so the renderer can
 * show a 「需要上传图片」 placeholder in the body, matching ComfyUI's empty
 * state. */
const LOAD_IMAGE_NODE_TYPES = new Set([
  "LoadImage", "LoadImageMasked", "ComfyUI LoadImage", "ComfyUI-LoadImage",
  "Load Image", "ImageLoader", "ComfyUI-ImageLoader",
]);

/**
 * Build per-node input metadata (`rawInputsById`) and exact ComfyUI box
 * sizes (`sizeById`) from the RAW (UI-format) json.
 *
 * The base parser walks every raw node's `inputs[]` array and stamps:
 *   - `isConnection` from `inp.link`
 *   - `widget: { name }` for inputs that expose an internal widget value
 *   - `widgetValue` drawn from `widgets_values[k]` with a running widget
 *     counter (seed / noise_seed bundle two slots — value + implicit
 *     `control_after_generate` partner)
 *   - `multiline` for STRING inputs flagged by `inferIsMultiline`
 *   - a synthetic `preview` entry on LoadImage-family nodes
 *
 * Then (2026-08-12 R73) subgraph wrapper nodes get their exposed widget
 * values enriched from `properties.proxyWidgets` — the wrapper's own
 * `widgets_values[]` is empty; the actual values live in the internal
 * nodes' arrays.  COMBO candidates are resolved via /api/object_info
 * (single fetch per resolver, cached) and stamped as `comboOptions`.
 */
export async function buildRawInputs(
  raw: any,
  comboOptionsForClassField: (
    classType: string | undefined,
    field: string
  ) => Promise<string[] | undefined>
): Promise<{
  rawInputsById: Record<
    string,
    {
      name: string;
      label?: string;
      localized?: string;
      type: string;
      isConnection: boolean;
      widget?: { name: string };
      widgetValue?: unknown;
      multiline?: boolean;
    }[]
  >;
  sizeById: Record<string, [number, number]>;
}> {
  /* Build a `rawInputs` lookup for every graph node.  In raw UI format, each
   * node carries an `inputs` array on the disk record where every entry has
   *   { name, localized_name, label?, type, link }
   * `localized_name` is the zh-CN display label (ComfyUI saves it per node)
   * and `type` is the ComfyUI data-type string used for both connections and
   * widget values.  When the workflow was imported as API JSON only, this
   * map is empty. */
  const rawInputsById: Record<string, {
    name: string;
    label?: string;
    localized?: string;
    type: string;
    isConnection: boolean;
    /** ComfyUI wrapper-node widget marker (only set on inputs that expose
     *  an internal widget value back to the author).  When present the
     *  parent paint can render a `VALUE` cell to the right of the label
     *  without reaching for rawJson again.  Subgraph proxy pins that are
     *  plain connections leave this `undefined`. */
    widget?: { name: string };
    /** The current value of the widget this input exposes, drawn from
     *  `widgets_values[k]` where `k` is the running count of widgets
     *  seen before this row in the inputs[] array.  Undefined when the
     *  input is a pure connection (no widget).  Type-as-strings keep the
     *  JSON round-trip lossless; the canvas decides how to colour it
     *  (bool=green/red, number=amber, string=indigo) via `valueCellColor`. */
    widgetValue?: unknown;
    /** 2026-08-10 R18: server-stamped `multiline` flag — TRUE when this
     *  STRING input should render as a textarea, regardless of value
     *  length.  Sourced from `inferIsMultiline(classType, name, value)`
     *  which combines a static table (ComfyUI's own known-multiline
     *  inputs) with a name heuristic + length heuristic.  API-format
     *  rawJson does not preserve the original `widgets[i].config
     *  .multiline` flag, so we backfill here.  Affects widgetEntries
     *  rendering (WorkflowNode / WorkflowSubgraphNode); the workflowIO enrichment
     *  below has its own parallel stamp via MULTILINE_HINT. */
    multiline?: boolean;
  }[]> = {};
  /* ComfyUI/litegraph node `size` ([w, h]) — forwarded so the canvas can
   *  paint each node box at its exact ComfyUI dimensions (the user expects
   *  the card to match the imported config, including oversized boxes with
   *  internal whitespace).  Raw API-format `tpl.graph` drops `size`, so we
   *  pull it back from `raw.nodes` (which still carries it) keyed by id. */
  const sizeById: Record<string, [number, number]> = {};
  /* 2026-08-29：控件顺序表（classType → 控件名数组，含 control_after_generate
   * 哨兵槽）。惰性拉取 —— 只有真的遇到「inputs[] 没覆盖到的控件值」时才请求
   * object_info，避免每个工作流都白跑一次；ComfyUI 未启动时 30s 负缓存生效，
   * 拿不到表也只是退回旧逻辑，不会拖慢。 */
  let widgetOrderTable: Record<string, string[]> | null = null;
  const ensureWidgetOrderTable = async (): Promise<Record<string, string[]>> => {
    widgetOrderTable ??= await fetchWidgetOrderTable();
    return widgetOrderTable;
  };
  if (raw && Array.isArray(raw.nodes)) {
    for (const rn of raw.nodes) {
      if (!rn) continue;
      /* Capture `size` for EVERY raw node, independent of whether the node
       *  carries an `inputs` array.  Some litegraph exports (and certain
       *  test fixtures) omit `inputs` on nodes that still have a `size`,
       *  so gating size on `inputs` would wrongly drop it.  (The
       *  rawInputsById pass below still needs `inputs`, hence the separate
       *  guard below.) */
      const rnSize =
        Array.isArray((rn).size) && (rn).size.length >= 2 ? (rn).size : undefined;
      if (rnSize) {
        sizeById[String((rn).id)] = [Number(rnSize[0]) || 0, Number(rnSize[1]) || 0];
      }
      if (!Array.isArray((rn).inputs)) continue;
      const list: {
        name: string;
        label?: string;
        localized?: string;
        type: string;
        isConnection: boolean;
        widget?: { name: string };
        widgetValue?: unknown;
        multiline?: boolean;
        imageRef?: { filename: string; subfolder: string; type: string };
        preview?: boolean;
      }[] = [];
      const rnWidgets = Array.isArray((rn).widgets_values)
        ? (rn).widgets_values
        : [];
      const rnClassType = typeof (rn).type === "string" ? (rn).type : "";

      /* ── 旧配对（兜底）：按 inputs[] 中控件出现的顺序，用游标依次取
       *  widgets_values。只在拿不到该类的控件顺序表时使用 —— 见下方 byOrder。 */
      const legacyByName = new Map<string, unknown>();
      let widgetCounter = 0;
      for (const inp of (rn).inputs) {
        if (!inp || typeof inp.name !== "string") continue;
        const widgetName = inp.widget && typeof inp.widget.name === "string" ? inp.widget.name : undefined;
        if (!widgetName || widgetCounter >= rnWidgets.length) continue;
        legacyByName.set(widgetName, rnWidgets[widgetCounter]);
        /* seed / noise_seed widgets carry an implicit `control_after_generate`
         * partner slot immediately after their own value (R94 fix). */
        const isSeedBundle =
          widgetName === "seed" ||
          widgetName === "noise_seed" ||
          inp.name === "seed" ||
          inp.name === "noise_seed";
        widgetCounter += isSeedBundle ? 2 : 1;
      }

      /* ── 顺序表配对（2026-08-29）：把整个 widgets_values 反查成「控件名 → 值」。
       *  ComfyUI 默认只把「转成输入」的控件写进 raw 节点的 inputs[]，其余控件的
       *  值仅存在于 widgets_values[]。仅靠 inputs[] 配对会整段漏掉它们
       *  （CLIPTextEncode 的提示词、SenseNovaU15Loader 的模型名…），节点上看
       *  不到任何参数。这里改用与 convertRawToApi 同源的控件顺序表反查下标。 */
      let byOrder: { name: string; value: unknown }[] | null = null;
      if (rnWidgets.length > 0 && (widgetCounter < rnWidgets.length || legacyByName.size === 0)) {
        const table = await ensureWidgetOrderTable();
        byOrder = mapWidgetValuesByOrder(table[rnClassType], rnWidgets);
      }
      const valueByName = new Map<string, unknown>();
      if (byOrder) for (const w of byOrder) valueByName.set(w.name, w.value);
      else for (const [name, value] of legacyByName) valueByName.set(name, value);

      /* 已被 inputs[] 占据的控件名 —— 下面补齐时不再重复生成。 */
      const usedWidgetNames = new Set<string>();

      for (const inp of (rn).inputs) {
        if (!inp || typeof inp.name !== "string") continue;
        const isConn = inp.link != null;
        /* ComfyUI bakes the widget handle as `{ widget: { name: "…" } }`
         *  on inputs that are "exposed widget proxies" — the value lives
         *  in `widgets_values` at the position of widgets seen so far in
         *  inputs[] order.  Without this counter, the API would only
         *  expose the flat widgets_values array and force every consumer
         *  to re-pair the indices (which was the previous source of the
         *  "<input name still showing no value>" regression). */
        const widgetName = inp.widget && typeof inp.widget.name === "string" ? inp.widget.name : undefined;
        let widgetValue: unknown = undefined;
        if (widgetName) {
          usedWidgetNames.add(widgetName);
          if (valueByName.has(widgetName)) widgetValue = valueByName.get(widgetName);
          else if (legacyByName.has(widgetName)) widgetValue = legacyByName.get(widgetName);
        }
        const entry: {
          name: string;
          imageRef?: { filename: string; subfolder: string; type: string };
          preview?: boolean;
          label?: string;
          localized?: string;
          type: string;
          isConnection: boolean;
          widget?: { name: string };
          widgetValue?: unknown;
          multiline?: boolean;
        } = {
          name: inp.name,
          label: typeof inp.label === "string" ? inp.label : undefined,
          localized: typeof inp.localized_name === "string" ? inp.localized_name : undefined,
          type: typeof inp.type === "string" ? inp.type : (isConn ? "*" : "STRING"),
          isConnection: isConn,
        };
        if (widgetName) entry.widget = { name: widgetName };
        if (widgetValue !== undefined) entry.widgetValue = widgetValue;
        /* 2026-08-10 R18: stamp `multiline` on every STRING input that
         *  the upstream `inferIsMultiline` helper flags.  The helper
         *  intentionally never stamps `multiline: false` (an opt-in
         *  only flag); the renderer treats absence as "no opinion"
         *  and falls back to its own heuristics. */
        if (typeof inp.type === "string" && inp.type === "STRING") {
          if (inferIsMultiline(typeof rn.type === "string" ? rn.type : undefined, inp.name, widgetValue)) {
            entry.multiline = true;
          }
        }
        list.push(entry);
      }

      /* 补齐「没有出现在 inputs[] 里的控件」—— 它们的值只存在于 widgets_values[]，
       * 之前整段丢失，画布上这类节点（各类 Loader / CLIPTextEncode …）看起来
       * 一个参数都没有。LoadImage 家族例外：它的 image 控件由下方合成的
       * preview 条目以缩略图呈现，不需要再重复一行文本。 */
      if (byOrder && !LOAD_IMAGE_NODE_TYPES.has(rnClassType)) {
        for (const w of byOrder) {
          if (usedWidgetNames.has(w.name) || w.value === undefined) continue;
          /* 数组值是连线元组（[nodeId, slot]），不是控件值 —— 跳过。 */
          if (Array.isArray(w.value)) continue;
          const type = inferInputType(rnClassType, w.name, w.value);
          list.push({
            name: w.name,
            type,
            isConnection: false,
            widget: { name: w.name },
            widgetValue: w.value,
            ...(type === "STRING" && inferIsMultiline(rnClassType, w.name, w.value)
              ? { multiline: true as const }
              : {}),
          });
        }
      }

      rawInputsById[String(rn.id)] = list;

      /* LoadImage-family nodes carry the uploaded filename in widgets_values[0]
       * but have NO IMAGE input (they *produce* IMAGE).  We synthesize one
       * preview entry — `preview: true` marker — so the canvas can paint the
       * uploaded thumbnail (or a 「需要上传图片」 placeholder when empty) on
       * the LoadImage node itself, which is exactly where ComfyUI paints it.
       *
       * 2026-08-10 R28: ALWAYS push for LoadImage-family, regardless of
       * whether an image is loaded.  The empty-image branch (widgets_values[0]
       * missing / empty) returns `imageRef: undefined` and the frontend
       * renders a placeholder.  This way the node always has its preview
       * area in the body — collapsing the body hides both, which is the
       * correct ComfyUI-parity shape.  The dedicated `preview: true` flag
       * is checked by the renderer's connEntries / widgetEntries filters
       * so this entry never lands in the port row or widget control list. */
      if (LOAD_IMAGE_NODE_TYPES.has(typeof (rn).type === "string" ? (rn).type : "")) {
        if (!list.some((list) => list.preview)) {
          const wv0 = (rn).widgets_values?.[0];
          const fname = typeof wv0 === "string" ? wv0.trim() : "";
          list.push({
            name: "__loadimage_preview__",
            label: "image",
            localized: "图像",
            type: "IMAGE",
            isConnection: false,
            preview: true,
            ...(fname
              ? { imageRef: { filename: fname, subfolder: "", type: "input" as const } }
              : {}),
          });
        }
      }
    }
  }

  /* 2026-08-12 R73: Subgraph wrapper widget value lookup.
   *
   * ComfyUI's exported subgraph workflows carry a `properties.proxyWidgets`
   * array on each wrapper node that maps wrapper.inputs[i] to an internal
   * node + widget field: `proxyWidgets[i] = [internalNodeId, fieldName]`.
   * The wrapper's own `widgets_values[]` is empty — the actual values
   * live in the corresponding internal nodes' `widgets_values[]`, indexed
   * by walking the internal node's `inputs[]` array to find the slot
   * for `fieldName` (counting widget slots seen so far, since
   * ComfyUI/LiteGraph stores widget values as a flat array in input
   * order).
   *
   * Special case: KSampler / KSamplerAdvanced bundle `seed` and
   * `control_after_generate` into TWO consecutive widget slots — the
   * `seed` input occupies slot 0, `control_after_generate` slots into
   * slot 1, so any slot counter that hits a seed widget advances by 2.
   *
   * The base parser (above) already stamps `widget: { name }` on inputs
   * that carry the widget marker (ComfyUI's exported wrappers always do),
   * `isConnection` from `inp.link`, and attempts `widgetValue` from
   * `rn.widgets_values[widgetCounter]` — but for wrapper nodes the latter
   * is empty, leaving every widget row blank until this enrichment runs. */
  if (raw?.definitions?.subgraphs) {
    const subs = raw.definitions.subgraphs as Record<string, any>;
    /* Index internal nodes per subgraph def by id for O(1) lookup. */
    const internalByIdByKey = new Map<string, Map<string, any>>();
    for (const subKey of Object.keys(subs)) {

      const subDef = subs[subKey];

      const map = new Map<string, any>();

      if (Array.isArray(subDef?.nodes)) {

        for (const inN of subDef.nodes) {

          if (inN?.id != null) map.set(String(inN.id), inN);

        }

      }

      internalByIdByKey.set(subKey, map);

    }

    /* Find the subgraph def that belongs to a wrapper's UUID classType. */
    const resolveSubDef = (classType: string): { key: string; def: any } | null => {
      if (subs[classType]) return { key: classType, def: subs[classType] };
      for (const k of Object.keys(subs)) {
        if (subs[k]?.id === classType) return { key: k, def: subs[k] };
      }
      return null;
    };
    /* Look up a widget field's current value on an internal node by
     * walking inputs[] to find the matching slot, then indexing
     * widgets_values[].  Handles the seed+control_after_generate
     * 2-slot bundle by advancing the slot counter twice wherever a
     * seed/ noise_seed widget is encountered (those inputs always
     * carry an implicit `control_after_generate` partner slot). */
    const lookupFieldValue = (internalNode: any, fieldName: string): unknown => {
      if (!internalNode || !Array.isArray(internalNode.inputs)) return undefined;
      const inputs = internalNode.inputs;
      const wv: unknown[] = Array.isArray(internalNode.widgets_values)
        ? internalNode.widgets_values
        : [];
      /* control_after_generate always sits in the slot AFTER seed. */
      if (fieldName === "control_after_generate") {
        const seedIdx = inputs.findIndex(
          (i: any) => i && (i.name === "seed" || i.name === "noise_seed")
        );
        if (seedIdx < 0) return undefined;
        let slot = 0;
        for (let k = 0; k <= seedIdx; k++) {
          if (inputs[k]?.widget) slot++;
        }
        return slot < wv.length ? wv[slot] : undefined;
      }
      /* Generic: count widget slots before the target input. */
      const inputIdx = inputs.findIndex(
        (i: any) => i?.name === fieldName
      );
      if (inputIdx < 0) return undefined;
      let slot = 0;
      for (let k = 0; k < inputIdx; k++) {
        const inp = inputs[k];
        if (inp?.widget) {
          slot++;
          /* seed bundle consumes an extra slot for control_after_generate */
          if (inp.name === "seed" || inp.name === "noise_seed") slot++;
        }
      }
      return slot < wv.length ? wv[slot] : undefined;
    };

    /* Precompute (subDefKey, proxyWidgets, internalById) per wrapper so
     * the inner map stays cheap when the workflow has many wrappers. */
    const wrapperNodeIds: string[] = [];
    for (const nodeId of Object.keys(rawInputsById)) {
      const rn = (raw)?.nodes?.find?.((n: any) => String(n?.id) === nodeId);
      if (!rn) continue;
      const classType = typeof rn.type === "string" ? rn.type : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType)) continue;
      wrapperNodeIds.push(nodeId);
    }

    for (const nodeId of wrapperNodeIds) {
      const rn = (raw).nodes.find((n: any) => String(n?.id) === nodeId);
      const classType = typeof rn.type === "string" ? rn.type : "";
      const resolved = resolveSubDef(classType);
      if (!resolved) continue;
      const internalById = internalByIdByKey.get(resolved.key);
      if (!internalById) continue;
      const proxyWidgets: Array<[string, string]> = Array.isArray(rn.properties?.proxyWidgets)
        ? (rn.properties.proxyWidgets as any[])
            .filter((p): p is [unknown, unknown] => Array.isArray(p) && p.length === 2)
            .map((pair) => [String(pair[0]), String(pair[1])])
        : [];
      if (proxyWidgets.length === 0) continue;

      const subNodeType =
        typeof resolved.def?.name === "string" && resolved.def.name.trim()
          ? resolved.def.name
          : classType;

      const existingList = rawInputsById[nodeId] ?? [];
      /* `proxyWidgets` is indexed by *widget-input order* (the i-th exposed
       *  widget slot), NOT by the raw input-array index — ComfyUI skips
       *  pure-connection ports when it builds the array.  So we must walk
       *  the widget slots with their own counter (`widgetSlot`) rather than
       *  reuse the map's `idx` (which counts every input, ports included).
       *  Reusing `idx` shifts the mapping whenever a wrapper has leading or
       *  trailing non-widget ports: every wrapped value lands on the wrong
       *  row, and the trailing widget inputs fall off the end of the array
       *  and render as blank placeholder cells. */
      let widgetSlot = 0;
      const updatedList = existingList.map((entry) => {
        /* Only enrich inputs that ALREADY have a widget marker (i.e.
         *  they're exposed widget slots, not pure-connection ports).
         *  Pure ports correctly stay in connInputs on the client side. */
        if (!entry.widget) return entry;
        const proxy = proxyWidgets[widgetSlot];
        widgetSlot += 1;
        if (!proxy) return entry;
        const [internalNodeId, fieldName] = proxy;
        const internalNode = internalById.get(internalNodeId);
        const updated: any = { ...entry };
        if (updated.widgetValue === undefined) {

          const value = lookupFieldValue(internalNode, fieldName);

          if (value !== undefined) updated.widgetValue = value;

        }

        /* Adopt the internal node's slot type as authoritative if our
         *  wrapper entry didn't carry one (defensive — usually already
         *  present from the raw JSON). */
        if (internalNode && Array.isArray(internalNode.inputs)) {
          const inp = internalNode.inputs.find(
            (i: any) => i?.name === fieldName
          );
          if (inp?.type) updated.type = inp.type;
          if (!updated.label && inp?.localized_name) {
            updated.label = inp.localized_name;
          }
          /* Stash the proxy target (internal node class + field) so the
           *  async COMBO-option pass below can resolve candidate lists from
           *  /api/object_info for any COMBO widget on this wrapper. */
          (updated).__comboClass = internalNode.type;
          (updated).__comboField = fieldName;
        }
        /* Re-stamp multiline if we just learned the value (the base
         *  parser ran before this pass and may have skipped it). */
        if (
          updated.type === "STRING" &&
          !updated.multiline &&
          inferIsMultiline(subNodeType, entry.name, updated.widgetValue)
        ) {
          updated.multiline = true;
        }
        return updated;
      });
      /* Resolve COMBO candidate lists from /api/object_info (single fetch
       *  per request, cached).  Only wrapper widget inputs that are COMBOs
       *  get a `comboOptions` array; everything else is left untouched.  If
       *  ComfyUI is unreachable the temp fields are just dropped and the
       *  consumer falls back to a plain text control. */
      for (const e of updatedList) {
        const ec = e;
        if (ec.type === "COMBO" && ec.__comboClass) {
          const opts = await comboOptionsForClassField(ec.__comboClass, ec.__comboField);
          if (opts) ec.comboOptions = opts;
        }
        delete ec.__comboClass;
        delete ec.__comboField;
      }
      rawInputsById[nodeId] = updatedList;
    }
  }

  return { rawInputsById, sizeById };
}

/**
 * Sparse raw-node metadata — only enough for the canvas editor to render
 * the OUTPUT port strip and to feed Subgraph UI nodes (which need
 * widget_values to label their fields).  Note nodes are excluded.
 */
export function buildRawNodeMeta(raw: any): {
  id: string;
  widgets_values: any[];
  outputs: { name: string; localized?: string; label?: string; type: string; links: number[] }[];
  flags: Record<string, any>;
  properties: Record<string, any>;
  mode: number;
}[] {
  const rawNodeMeta: { id: string; widgets_values: any[]; outputs: { name: string; localized?: string; label?: string; type: string; links: number[] }[]; flags: Record<string, any>; properties: Record<string, any>; mode: number }[] = [];
  if (raw && Array.isArray(raw.nodes)) {
    for (const rn of raw.nodes) {
      if (!rn || rn.type === "Note" || rn.type === "MarkdownNote") continue;
      const outputs: { name: string; localized?: string; label?: string; type: string; links: number[] }[] = [];
      if (Array.isArray((rn).outputs)) {
        for (const o of (rn).outputs) {
          if (!o || typeof o.name !== "string") continue;
          outputs.push({
            name: o.name,
            localized: typeof o.localized_name === "string" ? o.localized_name : undefined,
            /* Business label (e.g. `FRAMES` / `IMAGE_FINAL`).  Forwarded
             *  so the parent's WorkflowSubgraphNode outputs strip and the
             *  inner WorkflowIoPortNode display stay in lock-step. */
            label: typeof o.label === "string" ? o.label : undefined,
            type: typeof o.type === "string" ? o.type : "*",
            links: Array.isArray(o.links) ? o.links.map((n: any) => Number(n) || 0) : [],
          });
        }
      }
      // Forward `flags` so the editor can honour per-node flags such as
      //  `flags.collapsed === true` (a ComfyUI LiteGraph state used by
      //  SetNode / Fast Groups Muter / rgthree Compact etc.).  Only
      //  plain-object flags are kept; everything else is dropped to
      //  avoid leaking class-instances into the JSON payload.
      const flags =
        rn && typeof (rn).flags === "object" && (rn).flags !== null
          ? ((rn).flags as Record<string, any>)
          : {};
      rawNodeMeta.push({
        id: String(rn.id),
        widgets_values: Array.isArray((rn).widgets_values) ? (rn).widgets_values : [],
        outputs,
        flags,
        /* Custom-node `properties` (2026-08-09).  Forwarded so the canvas
         *  can replicate runtime UI driven by properties — the most
         *  prominent example is rgthree's `Fast Groups Bypasser`. */
        properties:
          rn && typeof (rn).properties === "object" && (rn).properties !== null
            ? ((rn).properties as Record<string, any>)
            : {},
        mode: typeof (rn).mode === "number" ? (rn).mode : 0,
      });
    }
  }
  return rawNodeMeta;
}

/** Map node id → ComfyUI class type (raw.nodes), used by the workflowIO
 *  enrichment to resolve direct (non-wrapper) COMBO candidates. */
export function buildNodeTypeMap(raw: any): Record<string, string> {
  const nodeTypeById: Record<string, string> = {};
  if (raw && Array.isArray((raw).nodes)) {
    for (const n of (raw).nodes) {
      if (n?.id != null) nodeTypeById[String(n.id)] = typeof n.type === "string" ? n.type : "";
    }
  }
  return nodeTypeById;
}

/** 2026-08-13 R82: raw 视图专用数据包。
 * 存库的 `graph`（即 `detail.nodes` 的来源）在某些工作流里被「拆平」成了
 * `N:xx` 节点（例如某工作流的 flat form，而其 `_t2i` 兄弟保留 wrapper）。
 * 这种情况下画布 RAW 布局会显示 17 个被炸开的节点，而用户期望的是 5 个
 * 原始 ComfyUI 节点（含 wrapper 紫色整卡）。这里直接从 rawJson 再派生一份
 * `rawView`（保留 subgraph wrapper），让 RAW 布局与 wrapper-form 兄弟、与
 * ComfyUI 自身画布一致。fallbackRawToApi 走离线启发式、不发网络请求。 */
export function buildRawView(
  raw: any,
  rawInputsById: Record<string, any[]>,
  sizeById: Record<string, [number, number]>
): {
  nodes: any[];
  positions: Record<string, [number, number]>;
  graph: any;
} | null {
  let rawView: { nodes: any[]; positions: Record<string, [number, number]>; graph: any } | null = null;
  if (raw && Array.isArray((raw).nodes)) {
    const rawConv = fallbackRawToApi(raw as RawWorkflow);
    const rawGraph = (rawConv.graph ?? {}) as Record<string, any>;
    const rawViewNodes = Object.entries(rawGraph).map(([nodeId, n]) => {
      const classType: string =
        (n?.class_type as string) || (n?.type as string) || "?";
      const isUuidClass = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType);
      let resolvedTitle: string | undefined;
      if (isUuidClass && raw?.definitions?.subgraphs) {
        const subs = raw.definitions.subgraphs as Record<string, any>;
        let def = subs[classType];
        if (!def) {
          const matchKey = Object.keys(subs).find((key) => subs[key]?.id === classType);
          if (matchKey) def = subs[matchKey];
        }
        if (def && typeof def.name === "string" && def.name.trim()) {
          resolvedTitle = def.name.trim();
        }
      }
      return {
        id: nodeId,
        class_type: classType,
        title:
          resolvedTitle ??
          (n)?._meta?.title ??
          (isUuidClass ? "" : classType) ??
          nodeId,
        is_subgraph: isUuidClass,
        raw_inputs: rawInputsById[nodeId] ?? [],
        size: sizeById[nodeId],
      };
    });
    const rawViewPositions =
      (rawConv.positions) ??
      extractPositions(raw as RawWorkflow);
    rawView = { nodes: rawViewNodes, positions: rawViewPositions, graph: rawGraph };
  }
  return rawView;
}
