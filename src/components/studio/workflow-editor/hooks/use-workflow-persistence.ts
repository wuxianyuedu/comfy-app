"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Node } from "@xyflow/react";
import type { WorkflowDetail, WorkflowIOParam } from "@/components/studio/workflow-types";
import { NODE_TITLE_H, extractNoteTitle } from "@/components/studio/workflow-utils";
import { MODE_KEY_PREFIX, runtimeNodeId } from "@/lib/workflow-param-mapping";
import { useToast } from "../../ToastProvider";
import type { WorkflowSaver } from "./use-workflow-save";

export interface WorkflowPersistenceArgs {
  workflowId: string;
  detail: WorkflowDetail | null;
  setDetail: Dispatch<SetStateAction<WorkflowDetail | null>>;
  scopeDetail: WorkflowDetail | null;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  paramMap: Record<string, unknown>;
  workflowIO: Record<string, WorkflowIOParam>;
  fitToContent: () => void;
  savePatch: WorkflowSaver;
  onSave?: () => void;
  onClose: () => void;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  /** 当前视图的宿主链路（顶层为空串，下钻一层是 `4`，再下钻是 `4:5`）。
   *  子图内部的节点 id 是**裸内部 id**（`1670`），而服务端 `positions` 列里
   *  同一批节点存的是**拼接键**（`4:1670`，见 `extractPositions` 里
   *  `${wId}:${iId}` 的写法）。两者不是同一套键：不拼上前缀，
   *  子图里的拖拽会写进一个顶层永远读不到的裸键、下钻回来时又拿它当
   *  「原始坐标」把真实位置盖掉 —— 这正是「改过位置的节点重置后回不到原始
   *  布局、再改一次却回归到一个错误位置」的来源。 */
  hostNodeId?: string;
}

/**
 * Layout snapshot / reset / save / drag-persist logic for the workflow
 * editor.  Extracted from wf-editor-inner.tsx (P4 split).
 */
export function useWorkflowPersistence({
  workflowId,
  detail,
  setDetail,
  scopeDetail,
  setNodes,
  paramMap,
  workflowIO,
  fitToContent,
  savePatch,
  onSave,
  setSaving,
  setError,
  hostNodeId = "",
}: WorkflowPersistenceArgs) {
  const toast = useToast();
  /* Snapshot the original layout for the current view (keyed by
   *  detail.id) the FIRST time we see each workflow / subgraph.  The
   *  "重置布局" (reset layout) button restores these so users can undo
   *  every manual drag and return to the workflow's as-loaded arrangement:
   *  raw imports → the imported coordinates; API-only workflows → `null`
   *  (which makes `initialNodes` fall through to the Kahn auto-layout, the
   *  original behaviour for those workflows).  Covers both graph-node
   *  `positions` and `notes` (notes are draggable too, so "所有节点"
   *  must reset them as well).  Captured once per detail.id so drilling
   *  into / back out of subgraphs keeps each view's own baseline. */
  const originalLayoutByIdRef = useRef<
    Record<
      string,
      {
        positions: Record<string, [number, number]> | null;
        notes: WorkflowDetail["notes"] | null;
      }
    >
  >({});
  useEffect(() => {
    /* 只读取 detail.id：整体引用 detail 会让本 effect 依赖整个对象（每次
     *  PATCH 后都是新引用），而这里只关心「换了另一份图」这一个信号。 */
    const detailId = detail?.id;
    if (!detailId) return;
    /* RAW / API 视图各有独立基线。RAW 视图按 rawView 的节点/
     *  位置快照，API 视图按 API 图的快照，互不干扰（避免 RAW 重置时误还原 API
     *  坐标，反之亦然）。 */
    const snapKey = `${detailId}`;
    if (!(snapKey in originalLayoutByIdRef.current)) {
      originalLayoutByIdRef.current[snapKey] = {
        positions: scopeDetail?.positions ?? null,
        notes: scopeDetail?.notes ?? null,
      };
    }
  }, [detail?.id, scopeDetail, hostNodeId]);

  /* Reset every node back to the layout as originally loaded for this view.
   *  - Restore `detail.positions` + `detail.notes` to the snapshot taken
   *    on entry, so the in-memory canvas (via the sync effect above)
   *    re-lays the nodes out to their original coordinates.
   *  - Persist the same to the server (`PATCH positions` + `PATCH notes`)
   *    so a reload keeps the reset.  `merge: true` is sent for BOTH the
   *    top-level and the subgraph view, so only the keys belonging to the
   *    current view's id-namespace are written and the other namespace
   *    (api-id coords vs raw-id / inner-subgraph coords) is preserved.
   *  - Detect a SPARSE snapshot — a snapshot that genuinely lacks
   *    coordinates for nodes of the CURRENT view.  If the snapshot is
   *    partial, do NOT write it back to the server — that would
   *    re-poison the column and the user's next open would be just as
   *    broken.  Instead, just clear the local `positions` to `null` so
   *    the in-memory canvas re-lays out via Kahn; the next manual drag
   *    will start populating the column properly.  Mirror the same logic
   *    for notes.
   *
   *  Sparse detection is scoped to the CURRENT view before counting.
   *  `detail.positions` is one flat map holding several id-namespaces at
   *  once (top-level node ids, `wrapperId:innerId` keys for inner nodes,
   *  `grp:bpin:*` rails).  Comparing its raw key count against the number
   *  of nodes in the current view conflates the two: a subgraph view with
   *  30 inner nodes and a snapshot holding 2 top-level keys reads as
   *  "2 < 30 ⇒ sparse", and the reset then silently degrades to "clear
   *  local positions + Kahn re-layout" — the dragged nodes keep their
   *  dragged coordinates and the button looks dead.  Filtering the
   *  snapshot down to the ids this view actually renders is what makes
   *  the count comparable. */
  const resetLayout = useCallback(() => {
    if (!detail) return;
    if (!scopeDetail) return;
    const snapKey = `${detail.id}`;
    const snap = originalLayoutByIdRef.current[snapKey] ?? null;
    const orig = snap?.positions ?? null;
    const origNotes = snap?.notes ?? null;
    /* 快照裁剪到「当前视图真正渲染的那些 id」再计数。
     *  - 图节点：scopeDetail.nodes 的 id（顶层是裸 id，下钻后是 `宿主:内部`
     *    形式，与服务端/拖拽侧写库的键同口径）。
     *  - 边界 pin 导轨 `grp:bpin:inputs|outputs` 是可拖动的，键不在
     *    scopeDetail.nodes 里，但同样属于本视图，单独放行，否则它们的坐标
     *    会被裁剪掉、拖过的导轨位置重置不回去。
     *  - 过滤后为空 = 快照里一个键都不属于本视图（典型的跨命名空间错配，
     *    如 RAW 视图快照 vs API 视图），按「无快照」处理（走 Kahn 兜底），
     *    不再拿别的命名空间的键数去冒充本视图的覆盖率。 */
    /* 本视图的节点 id 同时接受两种写法：快照一侧取决于数据来源 ——
     *  `buildSubgraphDetail` 的 `positions` 用**裸内部 id**（`1001`），
     *  而顶层列与拖拽落库用**拼接键**（`4:1001`）。两者指向同一个节点，
     *  过滤时都要认，否则「裁剪后为空」会被误判成本视图没有快照。 */
    const viewNodeIds = new Set<string>();
    for (const node of scopeDetail.nodes) {
      viewNodeIds.add(node.id);
      viewNodeIds.add(runtimeNodeId({ nodeId: node.id, hostNodeId }));
    }
    const isThisViewKey = (key: string) =>
      viewNodeIds.has(key) || key.startsWith("grp:bpin:");
    /* 还原时把裸内部 id 规范成与落库同口径的拼接键：拖拽写库用的是
     *  `宿主:内部`，若这里把快照里的裸 `1001` 原样写回，就等于往同一个节点的
     *  另一套键上写 —— 顶层读不到、下次进子图又读到旧值，越重置越乱。
     *  已经带前缀的键（顶层 `4:1001`、导轨 `grp:bpin:*`）原样保留。 */
    const normalizeKey = (key: string) =>
      hostNodeId && viewNodeIds.has(key) && !key.includes(":")
        ? runtimeNodeId({ nodeId: key, hostNodeId })
        : key;
    const origForView =
      orig === null
        ? null
        : Object.fromEntries(
            Object.entries(orig)
              .filter(([key]) => isThisViewKey(key))
              .map(([key, pos]) => [normalizeKey(key), pos])
          );
    const origForViewCount =
      origForView === null ? 0 : Object.keys(origForView).length;
    /* 本视图该有多少个坐标：全部图节点 + 快照里**实际存在**的导轨键。
     *  导轨数量按实到实算（不是硬编码 2）：只要第一条导轨被拖过就会落盘一条
     *  坐标，拿「2」当期望值会把这种正常情况误判成 sparse。 */
    const origRailCount =
      orig === null
        ? 0
        : Object.keys(orig).filter((key) => key.startsWith("grp:bpin:")).length;
    const expectedCount = scopeDetail.nodes.length + origRailCount;
    const isSparse =
      (orig !== null && origForViewCount > 0 && origForViewCount < expectedCount) ||
      (orig !== null && origForViewCount === 0 && scopeDetail.nodes.length > 0) ||
      (origNotes !== null &&
        scopeDetail.notes &&
        Array.isArray(origNotes) &&
        Array.isArray(scopeDetail.notes) &&
        origNotes.length < scopeDetail.notes.length);
    if (isSparse) {
      /* Snapshot is incomplete — keep the server's existing positions
       * untouched and just clear locally so the canvas re-lays out via
       * Kahn.  Subsequent drags will populate a fresh, complete map. */
      setDetail((prev) =>
        prev ? { ...prev, positions: null, notes: prev.notes ?? null } : prev
      );
      requestAnimationFrame(() => requestAnimationFrame(() => fitToContent()));
      return;
    }
    /* 只把「属于本视图」的键还原回内存与库：其余命名空间的键（另一视图的
     *  坐标）必须原样留着，否则重置一次就把另一套布局抹了。 */
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            positions: origForView ?? null,
            notes: origNotes ?? prev.notes,
          }
        : prev
    );
    const payload: Record<string, unknown> = {
      positions: origForView ?? {},
      notes: origNotes ?? [],
    };
    /* 快照含 raw-id / 内部节点坐标时，用顶层默认的 REPLACE
     *  写回会清空 tpl.positions 里并存的另一套坐标。统一走 merge:true，只把
     *  当前视图的键写回、保留另一视图的键，避免跨视图数据损坏。 */
    payload.merge = true;
    savePatch.mutate({
      id: workflowId,
      positions: payload.positions,
      notes: payload.notes,
      mergePositions: payload.merge === true,
    });
    requestAnimationFrame(() => requestAnimationFrame(() => fitToContent()));
  }, [detail, setDetail, workflowId, scopeDetail, fitToContent, savePatch, hostNodeId]);

  /* Re-sync nodes when paramMap changes (update assignedRole badges). 取角色时
   *  跳过 `mode:` 前缀的按模式连线表 —— 它的值不是节点 id，命中会把整张模式
   *  表当成某个节点的角色名。 */
  useEffect(() => {
    if (!detail) return;
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          assignedRole:
            Object.entries(paramMap).find(
              ([key, value]) => value === node.data.nodeId && !key.startsWith(MODE_KEY_PREFIX)
            )?.[0] ?? null,
        },
      }))
    );
  }, [paramMap, detail, setNodes]);

  /* Save paramMap + workflowIO (exposed inputs/outputs) */
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await savePatch.mutateAsync({
        id: workflowId,
        paramMap,
        workflowIO,
      });
      onSave?.();
      /* 保存后停留在当前工作流界面（不再 onClose 退出）——用户保存 IO /
       * 布局后通常还要继续调整；成功与否由 toast 反馈。 */
      toast.success("已保存", "画布修改与 IO 配置已落库，可继续编辑");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [workflowId, paramMap, workflowIO, onSave, savePatch, setError, setSaving, toast]);

  /* Persist a node's position after the user finishes dragging it.
   *  - Note nodes (`note:<id>`) → write back into rawJson.nodes[i].pos via
   *    the `notes` PATCH field, and reflect the new coord in local `detail`
   *    so the canvas stays consistent (no snap-back on the next render).
   *  - Real graph nodes → write into the `positions` column via the
   *    `positions` PATCH field, likewise mirrored into local `detail`.
   *  - Boundary-pin GROUPS (`grp:bpin:inputs|outputs`, late)
   *    → write the group rect into `positions` so the rail stays where the
   *    user dropped it after reload.  The children carry parentId +
   *    extent:"parent" and move automatically with the group, so we don't
   *    persist them individually — only the parent.
   *  - Individual `bpin:*` nodes are NOT draggable (`draggable: false` in
   *    the layout pass) so this branch never fires for them; if a future
   *    change makes them draggable we'd persist their position the same
   *    way as a real graph node.
   *  The write is fire-and-forget: it must NOT trigger a detail re-fetch, so
   *  the canvas never re-mounts or flashes. */
    const onNodeDragStop = useCallback(
      (_e: unknown, node: { id: string; type?: string; position: { x: number; y: number } }) => {
        /* `detail` may be null during the loading → ready transition
         * (e.g. user closes the editor mid-load); if so we have nowhere
         * to persist the new position.  Bail silently — the canvas
         * re-mounts with the persisted state on the next open. */
        if (!detail) return;
        const x = Math.round(node.position.x);
        /* Anchor inversion: wfNode / wfSubgraph cards paint a
         *  30 px title bar ABOVE their body, so the React Flow `position.y`
         *  is the CARD (title-bar) top, and the body sits `NODE_TITLE_H`
         *  below it.  The on-disk `positions[id]` must keep the ComfyUI
         *  body-top convention (what the user/other tools expect), so we
         *  ADD NODE_TITLE_H before persisting: bodyTop = cardTop + 30.
         *  Untitled notes, wfGroup and wfIoPort don't carry a title bar,
         *  so their `position` already equals the ComfyUI top-left. */
        const ANCHOR_BACK: Record<string, number> = {
          wfNode: NODE_TITLE_H,
          wfSubgraph: NODE_TITLE_H,
        };
        const back = node.type ? ANCHOR_BACK[node.type] ?? 0 : 0;
        const y = Math.round(node.position.y + back);
        if (node.id.startsWith("note:")) {
          const noteId = node.id.replace(/^note:/, "");
          /* Same anchor convention as the wfNode / wfSubgraph branch: a
           *  titled note's React Flow `position.y` is its CARD top
           *  (title-bar top), while the body sits NODE_TITLE_H below.  The
           *  on-disk `pos` keeps the ComfyUI body-top convention, so we
           *  ADD NODE_TITLE_H before persisting.  Untitled notes need no
           *  inversion because their React Flow box has no title bar. */
          const noteMeta = (detail.notes ?? []).find((nn) => String(nn.id) === noteId);
          const noteHasTitle = noteMeta ? !!extractNoteTitle(noteMeta.text, noteMeta.title) : false;
          const noteY = Math.round(node.position.y + (noteHasTitle ? NODE_TITLE_H : 0));
          setDetail((prev) =>
            prev
              ? { ...prev, notes: (prev.notes ?? []).map((note) => (note.id === noteId ? { ...note, pos: [x, noteY] } : note)) }
              : prev
          );
          savePatch.mutate({
            id: workflowId,
            notes: [{ id: noteId, pos: [x, noteY] }],
          });
        } else {
          /* 单一格式（不再区分 RAW / API 视图），图节点拖拽统一
           *  写回 detail.positions（覆盖 ComfyUI 原始布局）。
           *
           *  子图视图下的节点 id 是**裸内部 id**，而 `positions` 列存的是
           *  `宿主:内部` 拼接键（`runtimeNodeId` 就是这条约定的实现，预览/运行
           *  链路也用它）。不拼前缀就会出现两个各写各的键：子图里的拖拽落到
           *  `1670`、顶层链路只认 `4:1670`，两边的布局互相看不见 —— 下钻回来
           *  时那个裸键还会被当成「已保存坐标」把真正的原始位置盖掉。 */
          const nodeId = runtimeNodeId({ nodeId: node.id, hostNodeId });
          setDetail((prev) =>
            prev ? { ...prev, positions: { ...(prev.positions ?? {}), [nodeId]: [x, y] } } : prev
          );
          /* 一律走 `merge: true` 的单键合并：`positions` 是一张混装多套
           *  id 命名空间（顶层裸 id / 子图拼接键 / `grp:bpin:*` 导轨）的平表，
           *  顶层默认的 REPLACE 会把其它命名空间的坐标整片清掉。 */
          savePatch.mutate({
            id: workflowId,
            positions: { [nodeId]: [x, y] },
            mergePositions: true,
          });
        }
      },
      [detail, setDetail, workflowId, savePatch, hostNodeId]
    );

  return { resetLayout, handleSave, onNodeDragStop };
}
