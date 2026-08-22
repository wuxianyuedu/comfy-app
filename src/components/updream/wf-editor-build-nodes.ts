/* Extracted initialNodes builder from WorkflowEditorInner (wf-editor-inner.tsx).
 *  Pure function — takes the derived context object and returns the React
 *  Flow node array.  No hooks / no component state: the caller owns the
 *  useMemo (see buildInitialNodes usage in wf-editor-inner.tsx). */
import type { Node } from "@xyflow/react";
import { friendlyNodeTitle } from "@/lib/comfyui/node-titles";
import type {
  WfNodeData, WfSubgraphData, WfGroupData, WfIoPortData, WfNoteData,
  RawInputMeta, RawOutputMeta, ComfyGraphNode, WorkflowDetail,
} from "./wf-types";
import {
  NODE_TITLE_H, computeKahnLayout, buildInputSources,
  buildConnectedOutputs, computeGroupDepths, extractNoteTitle,
  isNoteType,
} from "./wf-utils";
import {
  IO_PORT_WIDTH, IO_PORT_HEIGHT, PORT_ROW_GAP, GROUP_PAD_X,
  GROUP_TITLE_BAR, GROUP_PAD_Y_BOTTOM, GROUP_RAIL_COLOR,
} from "./wf-editor-nodes";

export interface BuildInitialNodesCtx {
  detail: WorkflowDetail | null;
  scopeDetail: WorkflowDetail | null;
  rawMetaById: Record<
    string,
    {
      widgets_values: any[];
      outputs: RawOutputMeta[];
      flags: Record<string, any>;
      properties: Record<string, any>;
      mode: number;
    }
  >;
  outSlotNameById: Record<string, string[]>;
  paramMap: Record<string, string>;
  viewMode: "raw" | "api";
  apiLayoutOverrides: Record<string, [number, number]>;
  onEnterSubgraph?: (id: string, classType: string, title: string) => void;
}

export function buildInitialNodes(ctx: BuildInitialNodesCtx): Node[] {
  const {
    detail, scopeDetail, rawMetaById, outSlotNameById,
    paramMap, viewMode, apiLayoutOverrides, onEnterSubgraph,
  } = ctx;

    if (!detail) return [];
    if (!scopeDetail) return [];
    const colW = 300;
    const rowH = 220;
    const padX = 80;
    const padY = 80;

    // Index nodes by id so we can resolve [srcId, slot] inputs to source titles.
    const nodesById: Record<string, ComfyGraphNode> = {};
    for (const n of scopeDetail.nodes) nodesById[n.id] = n;

    /* Look up the raw input metadata per node by id (for the graph view) */
    const rawById: Record<string, RawInputMeta[]> = {};
    for (const n of scopeDetail.nodes) rawById[n.id] = n.raw_inputs ?? [];

    /* Source-independent view of "this node's OUTPUT slots feed a
     *  subgraph boundary" — derived directly from detail.boundaryLinks
     *  where bl.kind === "output".  Used as a backup signal in WfNode's
     *  hasDownstream check so boundary wires keep rendering even if the
     *  server's rawOutputs[].isBoundary stamp hasn't propagated yet
     *  (e.g. due to an older sessionStorage cache shape — 2026-08-06
     *  fix after v4 cache still masked the output handles for
     *  RandomNoise's NOISE slot).  Top-level (non-subgraph) workflows
     *  leave `detail.boundaryLinks` undefined → returns empty map. */
    const boundaryOutputsByNodeId: Record<string, Set<string>> = {};
    /* Mirror for input side: bl.kind === "input" maps an outer pin to an
     *  inner node + input slot name.  Used by WfNode to mark widget rows
     *  (no `link` in rawInputs) as boundary, so the wire still anchors
     *  when isBoundary stamp is missing from a stale cache. */
    const boundaryInputsByNodeId: Record<string, Set<string>> = {};
    if (Array.isArray(detail.boundaryLinks)) {
      for (const bl of detail.boundaryLinks) {
        const nid = String(bl.innerNodeId);
        const slot = String(bl.innerSlotName || "");
        if (!nid || !slot) continue;
        if (bl.kind === "output") {
          (boundaryOutputsByNodeId[nid] ??= new Set()).add(slot);
        } else if (bl.kind === "input") {
          (boundaryInputsByNodeId[nid] ??= new Set()).add(slot);
        }
      }
    }

    /* rawMetaById + outSlotNameById are hoisted above (used by edges). */

    /* rawMetaById + outSlotNameById are hoisted above (used by edges). */

    /* Pre-compute which outputs of every node are wired downstream.  We
     *  do this once on detail load so each WfNode/WfSubgraphNode can ask
     *  "is this output connected?" and hide its dot when it isn't. */
    const connectedOutputsById = buildConnectedOutputs(scopeDetail, nodesById, rawMetaById, outSlotNameById);

    // Shared builder for a real ComfyUI graph node.
    //
    // 2026-08-07 — anchor convention: the React Flow `position` is the
    // *card's* top-left (i.e. the title bar top), and the body is painted
    // NODE_TITLE_H (=30px) *below* it.  The user wants the node BODY's
    // top to land exactly on the ComfyUI config `pos[1]` (the imported
    // coordinate), so we SUBTRACT NODE_TITLE_H here: cardTop = bodyTop − 30.
    // onNodeDragStop inverts this by ADDING NODE_TITLE_H before persisting,
    // so the on-disk `positions[id]` keeps the ComfyUI body-top convention
    // and a drag never accumulates a 30px offset on every save.
    //
    // When `n.size` is provided we force the node box to the exact
    // ComfyUI dimensions: width = size[0], height = `size[1] + NODE_TITLE_H`
    // (the raw `size[1]` is the BODY CONTENT height per the R49 rule —
    // see the NODE_TITLE_H comment for the full rationale).  The body
    // content height carried in `data.size.h` is exactly `size[1]`.
    const NODE_ANCHOR_OFFSET_Y = NODE_TITLE_H;
    const buildWfNode = (n: ComfyGraphNode, pos: { x: number; y: number }): Node => ({
      id: n.id,
      type: "wfNode",
      position: { x: pos.x, y: pos.y - NODE_ANCHOR_OFFSET_Y },
      style: n.size
        ? { width: n.size[0], height: n.size[1] + NODE_TITLE_H }
        : undefined,
      zIndex: 10,
      data: {
        nodeId: n.id,
        classType: n.class_type,
        title: n.title,
        inputs: (detail.graph[n.id]?.inputs ?? {}) as Record<string, any>,
        inputSources: buildInputSources(detail.graph[n.id]?.inputs, nodesById),
        assignedRole: Object.entries(paramMap).find(([, nid]) => nid === n.id)?.[0] ?? null,
        rawInputs: n.raw_inputs ?? [],
        rawOutputs: rawMetaById[n.id]?.outputs ?? [],
        rawWidgetValues: rawMetaById[n.id]?.widgets_values ?? [],
        connectedOutputs: connectedOutputsById[n.id],
        /* Backup source (2026-08-06 fix): stamped from detail.boundaryLinks
         *  so the output Handle still mounts for nodes that don't carry
         *  the rawOutputs[].isBoundary stamp yet (e.g. cached detail
         *  shape from before the schema change).  Independent channel
         *  → hasDownstream reads it via `data.boundaryOutputs.has`. */
        boundaryOutputs: boundaryOutputsByNodeId[n.id],
        boundaryInputs: boundaryInputsByNodeId[n.id],
        flags: rawMetaById[n.id]?.flags ?? {},
        mode: rawMetaById[n.id]?.mode ?? 0,
        /* Boundary stamps from the subgraph route (2026-08-05).  Outer
         *  (top-level) workflows always leave both false — sentinel
         *  nodes only exist inside a subgraph.  The client uses these
         *  flags to draw an INPUTS / OUTPUTS wfGroup around each cluster
         *  so the user can see where the wrapper's exposed ports end up
         *  on the canvas. */
        isInputEndpoint: !!n.is_input_endpoint,
        isOutputEndpoint: !!n.is_output_endpoint,
        /* LiteGraph `properties` (2026-08-09).  Fed through to WfNode so
         *  rgthree's `Fast Groups Bypasser` can read `matchTitle` etc.
         *  and render its runtime toggle list.  Forwarded verbatim. */
        properties: rawMetaById[n.id]?.properties ?? {},
        /* Workflow groups (2026-08-09).  Passed to WfNode so the
         *  rgthree runtime body can match against them; other nodes
         *  ignore this field.  The reference is shared (not cloned) so
         *  the cost stays O(1) per node regardless of workflow size. */
        groups: detail.groups ?? [],
        size: n.size ? { w: n.size[0], h: n.size[1] } : undefined,
      } as WfNodeData,
    });

    /* Subgraph wrapper node: class_type is a UUID and ComfyUI exposed
     *  inputs via proxyWidgets + a localised_name per slot.
     *
     *  2026-08-05 evening — IO rows REMOVED from the parent chip.
     *  The parent card is now a compact "stats + drill-in CTA" chip
     *  (see WfSubgraphNode).  Drilling in (via double-click or the
     *  header expand button) loads the subgraph's inner graph where
     *  IO member nodes get wrapped in INPUTS / OUTPUTS wfGroups.
     */
    const buildSubgraphNode = (n: ComfyGraphNode, pos: { x: number; y: number }): Node => {
      /* Inputs of this subgraph that have an *external* edge are the
       *  ones the parent workflow wires into it.  We pull this from
       *  detail.graph[subgraph_node_id].inputs — anything keyed here
       *  whose value is a [srcId, slot] tuple is connected. */
      const subgraphInp = (detail.graph?.[n.id]?.inputs ?? {}) as Record<string, any>;
      const connectedInputs = new Set<string>();
      for (const [name, v] of Object.entries(subgraphInp)) {
        if (Array.isArray(v) && typeof v[0] === "string") connectedInputs.add(name);
      }
      return {
        id: n.id,
        type: "wfSubgraph",
        // Same anchor convention as buildWfNode (see comment above the
        // builder): card top = config body top − NODE_TITLE_H, so the body
        // lands exactly on the imported pos.y.
        position: { x: pos.x, y: pos.y - NODE_ANCHOR_OFFSET_Y },
        zIndex: 11, // render above regular nodes so the purple outline reads
        style: n.size
          ? { width: n.size[0], height: n.size[1] + NODE_TITLE_H }
          : undefined,
        data: {
          nodeId: n.id,
          title: friendlyNodeTitle(n.class_type, n.title, "zh"),
          uid: n.class_type.slice(0, 8),
          inputs: n.raw_inputs ?? [],
          outputs: rawMetaById[n.id]?.outputs ?? [],
          widgetValues: rawMetaById[n.id]?.widgets_values ?? [],
          connectedOutputs: connectedOutputsById[n.id],
          connectedInputs,
          size: n.size ? { w: n.size[0], h: n.size[1] } : undefined,
          mode: rawMetaById[n.id]?.mode ?? 0,
          onEnter: () => onEnterSubgraph?.(n.id, n.class_type, n.title),
        } as WfSubgraphData,
      };
    };

    /* ── Group frames (background, behind everything) ── */
    const groups = detail.groups ?? [];
    const groupDepth = computeGroupDepths(groups);
    /* ComfyUI group ids are bare integers ("1", "2", "32") and can collide
     *  BOTH with graph-node ids AND with each other (a sub-workflow's
     *  `groups` array may legitimately contain two entries with the same
     *  `id`, e.g. id="32" appearing twice in the same inner graph — the
     *  outer `group:` prefix protects against node-id collision but does
     *  nothing for group-vs-group, which produced
     *  `Encountered two children with the same key, "group:32"` from
     *  React Flow's <MiniMapNodes>).  We dedupe here by tracking used ids
     *  and appending `-${i}` on collision.  `groupDepth` (keyed by the
     *  raw g.id) is untouched, as is the WfGroupNode's data.title/color. */
    const usedGroupIds = new Set<string>();
    const groupNodes: Node[] = groups
      .filter((g) => g.bounding[2] > 0 && g.bounding[3] > 0)
      .map((g) => {
        const [x, y, w, h] = g.bounding;
        let nodeId = `group:${g.id}`;
        let dupIdx = 0;
        while (usedGroupIds.has(nodeId)) {
          dupIdx += 1;
          nodeId = `group:${g.id}-${dupIdx}`;
        }
        usedGroupIds.add(nodeId);
        return {
          id: nodeId,
          type: "wfGroup",
          position: { x, y },
          // deeper nesting → higher zIndex, but always below notes/nodes
          zIndex: 1 + Math.min(groupDepth[g.id] ?? 0, 3),
          draggable: false,
          selectable: false,
          connectable: false,
          data: { title: g.title, color: g.color } as WfGroupData,
          style: { width: w, height: h, pointerEvents: "none" },
        } as Node;
      });

    /* ── Note / MarkdownNote annotations ── */
    const notes = detail.notes ?? [];
    const noteNodes: Node[] = notes.map((n) => {
      const title = extractNoteTitle(n.text, n.title);
      /* Anchor convention (2026-08-07, same as graph nodes): the React
       *  Flow `position` is the card top (title-bar top), body is NODE_TITLE_H
       *  below it.  To land the BODY top on the imported `pos[1]` we SUBTRACT
       *  NODE_TITLE_H for titled notes; untitled notes render no bar so their
       *  body IS the whole card and need no offset.  The onNodeDragStop for
       *  notes ADDS NODE_TITLE_H back before persisting. */
      const noteHasTitle = !!title;
      return {
        id: `note:${n.id}`,
        type: "wfNote",
        position: {
          x: n.pos[0],
          y: n.pos[1] - (noteHasTitle ? NODE_ANCHOR_OFFSET_Y : 0),
        },
        zIndex: 5,
        draggable: true,
        selectable: true,
        connectable: false,
        data: { title, text: n.text, color: n.color } as WfNoteData,
        /* `size` in the ComfyUI/litegraph payload stores the BODY CONTENT
         *  height (the 30 px title bar is NOT included in `size[1]` per the
         *  R49 rule — see the NODE_TITLE_H comment).  Titled notes add the
         *  title bar on top of the raw content size, so the React Flow box
         *  is `size[1] + NODE_TITLE_H` for titled notes.  Untitled notes
         *  render no bar so their `size[1]` is already the full height. */
        style: {
          width: n.size[0],
          height: n.size[1] + (noteHasTitle ? NODE_TITLE_H : 0),
        },
      } as Node;
    });

    // Real graph nodes only (note-class nodes are rendered separately above).
    const realNodes = scopeDetail.nodes.filter((n) => !isNoteType(n.class_type));

    /* IO port node dimensions live as module-level constants at the top of
     *  this file (IO_PORT_HEIGHT / PORT_ROW_GAP / GROUP_*) so both the
     *  layout pass below and the WfIoPortNode renderer stay in sync. */

    /* ── Boundary pins → wfGroup(wfIoPort …) (2026-08-06 late) ──
     *
     *  The user asked: "子工作流的输入节点和输出参数节点不需要可用单独拖动，
     *  支持整体拖动即可，参数间的距离没必要那么大，紧凑些，再像图中那样
     *  加个边框就行了".  So:
     *    • Each rail (inputs / outputs) is now wrapped in its OWN wfGroup
     *      rectangle with the purple draggable style (draggable: true +
     *      pointerEvents: auto + cursor: move).  Users grab the group once
     *      and the whole column slides.
     *    • The individual wfIoPort children carry parentId: <groupId> +
     *      extent: "parent" + draggable: false, so React Flow keeps them
     *      inside the group frame and moves them automatically with the
     *      parent's transform.
     *    • Vertical spacing is the new PORT_ROW_GAP (4 px) with the new
     *      IO_PORT_HEIGHT (22 px) → rows are tight without labels
     *      touching.
     *    • Group position is persisted via `detail.positions["grp:bpin:…
     *      "]`.  A saved override (left over from a previous session) is
     *      preferred over the rail-layout fallback that anchors to the
     *      inner bbox.  The previous single-pin-per-card render dropped
     *      positions to positionsById which is a no-op, so reload
     *      always reset to bbox-anchored rail; persisting the group
     *      position is what makes a moved column stay put. */
    const buildBoundaryPinNode = (
      pin: any,
      kind: "input" | "output",
      parentId: string,
      relY: number,
      relX: number
    ): Node => ({
      id: `bpin:${pin.id}`,
      type: "wfIoPort",
      parentId,
      extent: "parent",
      position: { x: relX, y: relY },
      zIndex: 11,
      draggable: false,
      selectable: true,
      connectable: false,
      style: { width: IO_PORT_WIDTH, height: IO_PORT_HEIGHT },
      data: {
        /* Display label chain (2026-08-06 fix): the boundary pin's
         *  `label` is the author-set business name (`FRAMES`,
         *  `IMAGE_FINAL`, `MODEL_HIGH_1st`) and is the *primary* read.
         *  Falls back to `localized` (ComfyUI's i18n) then to `name`
         *  so we never ship an empty title.  Same chain as
         *  WfSubgraphNode.outputs.display so both layers render the
         *  same string; the tooltip adds the resolved type for
         *  disambiguation when `name === type`. */
        title: pin.label ?? pin.localized ?? pin.name ?? "",
        type: pin.type,
        direction: kind,
        parentNodeId: null as any,
        parentNodeTitle: "",
        connectsTo: null as any,
        connectsFrom: null as any,
      } as WfIoPortData,
    });

    /* X-anchor for a wfIoPort child inside its rail group (2026-08-08
     *  fixed).  Both rails now anchor the port from the wfGroup's
     *  top-right / top-left CORNER, not from the same (left) edge —
     *  the previous input layout pushed the port flush against the
     *  wfGroup's right border (`relX = 2 * GROUP_PAD_X`), which made
     *  the handle `right:-4` stick OUTSIDE the box — visible in the
     *  screenshot as green dots leaking past the red Inputs frame.
     *
     *   - input  pin: name on right side of port (justify-end → label
     *                 hugs the right edge); port anchored from the
     *                 wfGroup's RIGHT-TOP corner so its right edge
     *                 sits GROUP_PAD_X inside the wfGroup border.
     *                 Handle (`right:-4`) ends up 6 px INSIDE the
     *                 box, mirroring the output row exactly.
     *                 ⇒ relX = wfGroupWidth - IO_PORT_WIDTH - GROUP_PAD_X.
     *   - output pin: name on left side of port (justify-start → label
     *                 hugs the left edge); port anchored from the
     *                 wfGroup's LEFT-TOP corner so its left edge sits
     *                 GROUP_PAD_X inside the wfGroup border.  Handle
     *                 (`left:-4`) ends up 6 px inside the box.
     *                 ⇒ relX = GROUP_PAD_X. */
    const wfGroupWidth = IO_PORT_WIDTH + 2 * GROUP_PAD_X;
    const inputRelX = wfGroupWidth - IO_PORT_WIDTH - GROUP_PAD_X;
    const outputRelX = GROUP_PAD_X;

    /* Build a wfGroup node for the whole rail.  `draggable: true` flips
     *  WfGroupNode into interaction mode (pointerEvents: auto, cursor:
     *  move) and React Flow moves the children declared with
     *  extent:"parent" along automatically.  Height is supplied directly
     *  (the variable pin-row offsets below don't fit the old
     *  `pinCount * IO_PORT_HEIGHT + (n-1)*PORT_ROW_GAP` formula). */
    const buildBoundaryGroup = (
      id: string,
      title: string,
      pos: { x: number; y: number },
      height: number
    ): Node | null => {
      if (height <= 0) return null;
      return {
        id,
        type: "wfGroup",
        position: pos,
        zIndex: 0,
        draggable: true,
        selectable: true,
        connectable: false,
        data: { title, color: GROUP_RAIL_COLOR, draggable: true } as WfGroupData,
        style: { width: IO_PORT_WIDTH + 2 * GROUP_PAD_X, height },
      } as Node;
    };

    /* Compute rail-anchor positions and (when needed) fall back to
     *  bbox-anchored defaults.  `savedGroupPos` may already contain a
     *  user-moved position from a previous session — honour it.
     *
     *  2026-08-06 (final): instead of forcing both rails into a
     *  bbox-aligned vertical column, anchor each group at the raw
     *  coordinates ComfyUI stored on `boundaryPins.inputs[i].pos` /
     *  `boundaryPins.outputs[i].pos`.  These are the absolute canvas
     *  coords where the corresponding inner-slot port sits in the
     *  unmodified workflow — exactly what the user pointed at in
     *  screenshot #2 ("这里有子图的输入节点和输出节点的位置，要按照
     *  这个来").  The fallback (bbox-anchored) only kicks in when those
     *  raw positions are absent or all-zero, e.g. older or hand-rolled
     *  workflows.  Pin y-coords are derived as `rawPinY - groupY` so
     *  variable vertical spacing is preserved. */
    const layoutBoundaryPins = (
      middlePos: Record<string, { x: number; y: number }>
    ): Node[] => {
      if (!detail.boundaryPins) return [];
      const mIds = Object.keys(middlePos);
      if (mIds.length === 0) return [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity;
      for (const id of mIds) {
        const p = middlePos[id];
        if (p!.x < minX) minX = p!.x;
        if (p!.x > maxX) maxX = p!.x;
        if (p!.y < minY) minY = p!.y;
      }
      /* Reference layout: ┃ leftInputColumn ┃ middleCanvasColumn ┃
       *  rightOutputColumn ┃.  The gap between each rail and the
       *  middle bbox must be ≥ one middle-node width (~280 px) +
       *  breathing room so the wfIoPort label is never buried inside
       *  a middle WfNode card.  The raw-pin-anchored default below
       *  WINS when the workflow carries real pin.pos coords (the
       *  common path); this 360 px bbox fallback only fires for
       *  workflow files where every pin.pos is missing or zero. */
      const RAIL_GAP = 360;
      const leftRailX = minX - RAIL_GAP;
      const rightRailX = maxX + RAIL_GAP;

      const rawPosOf = (pin: any): [number, number] | null => {
        if (Array.isArray(pin.pos) && pin.pos.length >= 2) {
          const x = Number(pin.pos[0]) || 0;
          const y = Number(pin.pos[1]) || 0;
          /* Treat (0,0) as "not provided" — happens for workflows
           *  imported without UI positions (API-only).  Falling back
           *  to the bbox-anchored rail is safer than popping every
           *  pin at the canvas origin. */
          if (x !== 0 || y !== 0) return [x, y];
        }
        return null;
      };
      const inputsRaw = (detail.boundaryPins.inputs ?? []).map(rawPosOf);
      const outputsRaw = (detail.boundaryPins.outputs ?? []).map(rawPosOf);
      /* Group default anchor: take the smallest (= leftmost for inputs,
       *  rightmost for outputs) x of all pins with a real raw pos, and
       *  the minimum y, then shift the group origin up-and-left so the
       *  topmost pin sits inside the title bar + ~ GROUP_PAD_X.  Inputs
       *  and outputs face inward so left uses minX, right uses maxX. */
      const computeGroupDefault = (
        list: ([number, number] | null)[],
        side: "left" | "right"
      ): { x: number; y: number } | null => {
        let anchorX = side === "left" ? Infinity : -Infinity;
        let minRy = Infinity;
        let any = false;
        for (const p of list) {
          if (!p) continue;
          any = true;
          if (side === "left" ? p[0] < anchorX : p[0] > anchorX) anchorX = p[0];
          if (p[1] < minRy) minRy = p[1];
        }
        if (!any) return null;
        return {
          x: anchorX - GROUP_PAD_X,
          y: minRy - GROUP_TITLE_BAR - GROUP_PAD_X,
        };
      };
      const inputsDefault = computeGroupDefault(inputsRaw, "left");
      const outputsDefault = computeGroupDefault(outputsRaw, "right");

      const positionsById = detail.positions ?? {};
      const savedIn: [number, number] | undefined = positionsById["grp:bpin:inputs"];
      const savedOut: [number, number] | undefined = positionsById["grp:bpin:outputs"];

      const inputsGroupPos = savedIn
        ? { x: savedIn[0], y: savedIn[1] }
        : inputsDefault
        ? inputsDefault
        : { x: leftRailX - GROUP_PAD_X, y: minY - GROUP_TITLE_BAR };
      const outputsGroupPos = savedOut
        ? { x: savedOut[0], y: savedOut[1] }
        : outputsDefault
        ? outputsDefault
        : { x: rightRailX - GROUP_PAD_X, y: minY - GROUP_TITLE_BAR };

      const stackRel = (i: number) => GROUP_TITLE_BAR + i * (IO_PORT_HEIGHT + PORT_ROW_GAP);
      const inputsRelYs = detail.boundaryPins.inputs.map((_p: any, i: number) => {
        const r = inputsRaw[i];
        return r ? r[1] - inputsGroupPos.y : stackRel(i);
      });
      const outputsRelYs = detail.boundaryPins.outputs.map((_p: any, i: number) => {
        const r = outputsRaw[i];
        return r ? r[1] - outputsGroupPos.y : stackRel(i);
      });
      const minHeight = GROUP_TITLE_BAR + GROUP_PAD_Y_BOTTOM;
      const computedHeight = (relYs: number[]): number => {
        if (relYs.length === 0) return 0;
        return Math.max(minHeight, Math.max(...relYs) + IO_PORT_HEIGHT + GROUP_PAD_Y_BOTTOM);
      };

      const out: Node[] = [];

      const inputsGroup = buildBoundaryGroup(
        "grp:bpin:inputs",
        "Inputs",
        inputsGroupPos,
        computedHeight(inputsRelYs)
      );
      if (inputsGroup) {
        out.push(inputsGroup);
        detail.boundaryPins.inputs.forEach((pin: any, i: number) => {
          out.push(
            buildBoundaryPinNode(pin, "input", "grp:bpin:inputs", inputsRelYs[i]!, inputRelX)
          );
        });
      }

      const outputsGroup = buildBoundaryGroup(
        "grp:bpin:outputs",
        "Outputs",
        outputsGroupPos,
        computedHeight(outputsRelYs)
      );
      if (outputsGroup) {
        out.push(outputsGroup);
        detail.boundaryPins.outputs.forEach((pin: any, i: number) => {
          out.push(
            buildBoundaryPinNode(pin, "output", "grp:bpin:outputs", outputsRelYs[i]!, outputRelX)
          );
        });
      }

      return out;
    };

    /* All inner graph nodes render as full WfNode / WfSubgraphNode cards
     *  (we no longer convert any of them to wfIoPort based on
     *  is_input_endpoint / is_output_endpoint — that approach collapsed
     *  for subgraphs where every node has both flags, and the
     *  reference layout wants the inner nodes to STAY as full cards). */
    /* ── 1) Saved positions ──
     *  Guard against an empty `{}` (which a "重置布局" (reset layout) can
     *  write to the server when the original workflow had NO saved
     *  positions, e.g. an API-only import).  An empty object is truthy,
     *  so without this guard every node would fall through to the
     *  `{padX, padY}` default and stack at the origin.  With the guard,
     *  empty → treated as "no positions" → Kahn auto-layout, which is the
     *  original behaviour for API-only workflows.
     *
     *  2026-08-06: also guard against PARTIAL positions (count less than
     *  realNodes.length).  This workflow can land in a state where the
     *  user has only placed a couple of nodes by hand (e.g. the workflow
     *  was imported as JSON-only and the user dragged 1-2 of them
     *  before opening the editor); the saved-positions branch would
     *  then place every un-positioned node at `{padX, padY}` = (80, 80)
     *  and visually stack 100+ nodes behind a single card.  Detection:
     *  Object.keys(detail.positions).length < realNodes.length →
     *  treat the snapshot as "absent" and run Kahn on the WHOLE graph
     *  for a predictable, grid-like starting layout.  Users can still
     *  drag nodes after to fine-tune.  The opposite (mixed: some nodes
     *  on saved pos, rest on Kahn) would be technically better but
     *  gives a chaotic result because the auto-layout assumes a
     *  blank canvas — half-placed nodes disrupt the longest-path
     *  levels and produce a worse-looking fallback. */
    // 2026-08-12 R78.2: 视图模式决定中部图节点的布局来源。
    //  - "api": 强制 Kahn 拓扑布局（忽略 rawJson 导入位置，呈现执行图形态）；
    //           叠加会话级 apiLayoutOverrides（API 视图下的拖拽，不写 DB）。
    //  - "raw": 优先用 detail.positions（已含 rawJson 原始位置 + 用户拖拽覆盖），
    //           不足时退回 Kahn（API-only 导入的历史兜底行为）。
    const kahn = computeKahnLayout(realNodes, scopeDetail.graph ?? {}, colW, rowH, padX, padY);

    if (viewMode === "api") {
      const middleNodes = realNodes.map((n) => {
        const ov = apiLayoutOverrides[n.id];
        const pos = ov ? { x: ov[0], y: ov[1] } : kahn[n.id] ?? { x: padX, y: padY };
        return n.is_subgraph ? buildSubgraphNode(n, pos) : buildWfNode(n, pos);
      });
      const middlePosById = Object.fromEntries(
        middleNodes.map((m) => [m.id, m.position])
      ) as Record<string, { x: number; y: number }>;
      return [...groupNodes, ...noteNodes, ...middleNodes, ...layoutBoundaryPins(middlePosById)];
    }

    const positionsCount = Object.keys(scopeDetail.positions ?? {}).length;
    const useSavedPositions =
      scopeDetail.positions != null &&
      positionsCount > 0 &&
      positionsCount >= realNodes.length;
    if (useSavedPositions) {
      const positionsById = scopeDetail.positions as Record<string, [number, number]>;
      const middleNodes = realNodes.map((n) => {
        const p = positionsById[n.id];
        return n.is_subgraph
          ? buildSubgraphNode(n, p ? { x: p[0], y: p[1] } : { x: padX, y: padY })
          : buildWfNode(n, p ? { x: p[0], y: p[1] } : { x: padX, y: padY });
      });
      const middlePosById = Object.fromEntries(
        middleNodes.map((m) => [m.id, m.position])
      ) as Record<string, { x: number; y: number }>;
      return [...groupNodes, ...noteNodes, ...middleNodes, ...layoutBoundaryPins(middlePosById)];
    }

    /* 2026-08-13 R78.3: hybrid — 客户端 RAW 视图的「部分 saved-positions」兜底
     *  当 detail.positions 数量不足以覆盖所有 realNodes（典型场景：含子图
     *  wrapper 的工作流 —— 服务端早期只提了顶层节点 pos，wrapper 内部 17 个
     *  节点 pos 漏了；现在服务端 extractPositions 已修，理论上不会再走到这里），
     *  不要粗暴地把整图退回 Kahn 自动布局。改为：
     *    - 已匹配的节点 → 用真实 LiteGraph pos；
     *    - 未匹配的节点 → 复用上面算好的 kahn 排到一块独立区域（紧贴第一行下方）。
     *  这样至少已定位的节点不会"乱跳"，新增的 subgraph 内层节点也不会堆在 (padX, padY)。*/
    if (positionsCount > 0) {
      const positionsById = scopeDetail.positions as Record<string, [number, number]>;
      const middleNodes = realNodes.map((n) => {
        const saved = positionsById[n.id];
        const kahnPos = kahn[n.id];
        let pos: { x: number; y: number };
        if (saved) {
          pos = { x: saved[0], y: saved[1] };
        } else if (kahnPos) {
          pos = kahnPos;
        } else {
          pos = { x: padX, y: padY };
        }
        return n.is_subgraph ? buildSubgraphNode(n, pos) : buildWfNode(n, pos);
      });
      const middlePosById = Object.fromEntries(
        middleNodes.map((m) => [m.id, m.position])
      ) as Record<string, { x: number; y: number }>;
      return [...groupNodes, ...noteNodes, ...middleNodes, ...layoutBoundaryPins(middlePosById)];
    }

    /* ── 2) Auto-layout via Kahn longest-path ── (raw 视图兜底，复用上面算好的 kahn) */
    const middleNodes = realNodes.map((n) => {
      const pos = kahn[n.id] ?? { x: padX, y: padY };
      return n.is_subgraph ? buildSubgraphNode(n, pos) : buildWfNode(n, pos);
    });
    const middlePosById = Object.fromEntries(
      middleNodes.map((m) => [m.id, m.position])
    ) as Record<string, { x: number; y: number }>;
    return [...groupNodes, ...noteNodes, ...middleNodes, ...layoutBoundaryPins(middlePosById)];
}
