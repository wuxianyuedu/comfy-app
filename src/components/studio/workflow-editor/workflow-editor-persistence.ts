"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Node } from "@xyflow/react";
import { type api } from "~/trpc/react";
import type { WorkflowDetail, WorkflowIOParam } from "../workflow-types";
import { NODE_TITLE_H, extractNoteTitle } from "../workflow-utils";

export interface WorkflowPersistenceArgs {
  workflowId: string;
  detail: WorkflowDetail | null;
  setDetail: Dispatch<SetStateAction<WorkflowDetail | null>>;
  scopeDetail: WorkflowDetail | null;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  paramMap: Record<string, string>;
  workflowIO: Record<string, WorkflowIOParam>;
  fitToMiddle: () => void;
  savePatch: ReturnType<typeof api.workflow.update.useMutation>;
  subgraphStack: { uid: string; name: string }[];
  onSave?: () => void;
  onClose: () => void;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
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
  fitToMiddle,
  savePatch,
  subgraphStack,
  onSave,
  onClose,
  setSaving,
  setError,
}: WorkflowPersistenceArgs) {
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
    if (!detail) return;
    /* 2026-08-13 R82: RAW / API 视图各有独立基线。RAW 视图按 rawView 的节点/
     *  位置快照，API 视图按 API 图的快照，互不干扰（避免 RAW 重置时误还原 API
     *  坐标，反之亦然）。 */
    const snapKey = `${detail.id}`;
    if (!(snapKey in originalLayoutByIdRef.current)) {
      originalLayoutByIdRef.current[snapKey] = {
        positions: scopeDetail?.positions ?? null,
        notes: scopeDetail?.notes ?? null,
      };
    }
  }, [detail?.id, scopeDetail]);

  /* Reset every node back to the layout as originally loaded for this view.
   *  - Restore `detail.positions` + `detail.notes` to the snapshot taken
   *    on entry, so the in-memory canvas (via the sync effect above)
   *    re-lays the nodes out to their original coordinates.
   *  - Persist the same to the server (`PATCH positions` + `PATCH notes`)
   *    so a reload keeps the reset.  For API-only workflows the snapshot
   *    `positions` is `null` → we send `{}`; with the `Object.keys>0`
   *    guard in `initialNodes` the reload falls back to the Kahn
   *    auto-layout (the original behaviour).
   *  - Subgraph view: send `merge: true` so the inner-subgraph node ids
   *    in `positions` are merged into `tpl.positions` instead of replacing
   *    it.  The top-level workflow's positional data (a different
   *    id-namespace) stays intact.  Top-level view keeps the default
   *    REPLACE behaviour, which is what the previous top-level reset
   *    did and the snapshot contains the complete saved layout.
   *  - 2026-08-06: detect a SPARSE snapshot (positions count < node
   *    count).  If the snapshot is partial, do NOT write it back to the
   *    server — that would re-poison the column and the user's next
   *    open would be just as broken.  Instead, just clear the local
   *    `positions` to `null` so the in-memory canvas re-lays out via
   *    Kahn; the next manual drag will start populating the column
   *    properly.  Mirror the same logic for notes. */
  const resetLayout = useCallback(() => {
    if (!detail) return;
    if (!scopeDetail) return;
    const snapKey = `${detail.id}`;
    const snap = originalLayoutByIdRef.current[snapKey] ?? null;
    const orig = snap?.positions ?? null;
    const origNotes = snap?.notes ?? null;
    const isSparse =
      (orig !== null && Object.keys(orig).length < scopeDetail.nodes.length) ||
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
      requestAnimationFrame(() => requestAnimationFrame(() => fitToMiddle()));
      return;
    }
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            positions: orig ?? null,
            notes: origNotes ?? prev.notes,
          }
        : prev
    );
    const payload: Record<string, unknown> = {
      positions: orig ?? {},
      notes: origNotes ?? [],
    };
    /* 2026-08-13 R82: RAW 视图的快照只含 raw-id 坐标，若用顶层默认的 REPLACE
     *  写回会清空 tpl.positions 里并存的 api-id 坐标。统一走 merge:true，只把
     *  当前视图的键写回、保留另一视图的键，避免跨视图数据损坏。 */
    payload.merge = true;
    savePatch.mutate({
      id: workflowId,
      positions: payload.positions,
      notes: payload.notes,
      mergePositions: payload.merge === true,
    });
    requestAnimationFrame(() => requestAnimationFrame(() => fitToMiddle()));
  }, [detail?.id, subgraphStack.length, workflowId, scopeDetail, fitToMiddle, savePatch]);

  /* Re-sync nodes when paramMap changes (update assignedRole badges) */
  useEffect(() => {
    if (!detail) return;
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          assignedRole:
            Object.entries(paramMap).find(([, nid]) => nid === node.data.nodeId)?.[0] ?? null,
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
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [workflowId, paramMap, workflowIO, onSave, onClose, savePatch]);

  /* Persist a node's position after the user finishes dragging it.
   *  - Note nodes (`note:<id>`) → write back into rawJson.nodes[i].pos via
   *    the `notes` PATCH field, and reflect the new coord in local `detail`
   *    so the canvas stays consistent (no snap-back on the next render).
   *  - Real graph nodes → write into the `positions` column via the
   *    `positions` PATCH field, likewise mirrored into local `detail`.
   *  - Boundary-pin GROUPS (`grp:bpin:inputs|outputs`, 2026-08-06 late)
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
        /* Anchor inversion (2026-08-07): wfNode / wfSubgraph cards paint a
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
          /* 2026-08-25: 单一格式（不再区分 RAW / API 视图），图节点拖拽统一
           * 写回 detail.positions（覆盖 ComfyUI 原始布局）。 */
          const nodeId = node.id;
          setDetail((prev) =>
            prev ? { ...prev, positions: { ...(prev.positions ?? {}), [nodeId]: [x, y] } } : prev
          );
          /* Subgraph view: write with `merge: true` so a single inner-node
           *  drag doesn't overwrite the entire top-level `tpl.positions`
           *  column.  Top-level view keeps the default REPLACE behaviour
           *  (it never touches other namespaces).  `subgraphStack` is the
           *  canonical "are we inside a subgraph" signal — empty array
           *  when browsing the root workflow. */
          const payload: Record<string, unknown> = { positions: { [nodeId]: [x, y] } };
          /* 2026-08-13 R82: RAW 视图（顶层）拖拽也走 merge:true。tpl.positions
           *  现在并存 api-id（来自 API 图）与 raw-id（来自 RAW 视图）两套坐标，
           *  顶层默认 REPLACE 会把另一套坐标清空。单键合并既能落盘当前节点，
           *  又保留另一视图的键。 */
          payload.merge = true;
          savePatch.mutate({
            id: workflowId,
            positions: payload.positions,
            mergePositions: payload.merge === true,
          });
        }
      },
      [workflowId, subgraphStack.length, savePatch]
    );

  return { resetLayout, handleSave, onNodeDragStop };
}
