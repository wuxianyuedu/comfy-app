/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
"use client";
/* ════════════════════════════════════════════════════════════════════════
 *  wf-stores.ts — Zustand 状态层（P2：替代 3 个 React Context）
 * ────────────────────────────────────────────────────────────────────────
 *  把 wf-contexts.tsx 里的 3 个画布 Context（IOEditContext、
 *  RgthreeGroupsContext、NodeJsonViewerContext）从 React Context 迁移到
 *  Zustand，同时保留它们原有的「按编辑器实例隔离」语义。
 *
 *  为什么不是模块级单例？
 *    工作流编辑器（WorkflowCanvasEditor）与项目画布（ProjectCanvas）都挂载
 *    同一套 wf-editor-inner，且可同时存活（还有 drill-in 子图栈）。若用
 *    顶层单例 store，两个编辑器的 workflowIO/viewer/bypass overrides 会互相
 *    串态——这正是 React Context 当初提供隔离的原因。
 *
 *  采用的模式：createStore 工厂 + useStore，经「薄 React Context 容器」下发。
 *    • createStore(factory)     每实例一份 StoreApi（内容可突变，非 hook）
 *    • <StoreCtx.Provider value={store}>  只做“传递 store 引用”，不触发重渲
 *    • useStore(storeCtx, selector)       按 selector 订阅，避免无谓重渲
 *  这是 zustand v4/v5 官方推荐的组件级作用域 store 写法（非废弃的
 *  zustand/context.createContext：v4 已标记 deprecated，迁移用 createStore）。
 *
 *  Shape 约束：对外暴露的 API 与原 Context value 保持等价，
 *  消费方（wf-node / wf-subgraph-node / NodeIdChip …）无需改动行为。
 * ════════════════════════════════════════════════════════════════════════ */
import React, { createContext, useContext } from "react";
import { createStore, useStore as useZustandStore, type StoreApi } from "zustand";
import type {
  WorkflowDetail,
  WorkflowGroup,
  RawMetaEntry,
  IoRef,
  WorkflowIOParam,
  RgthreeGroupsContextValue,
  NodeJsonViewerRequest,
  NodeJsonViewerContextValue,
} from "./workflow-types";
import { rectToAnchor } from "./workflow-utils";
import { NodeJsonPopover } from "./workflow-node-json-popover";
import { vanillaApi } from "~/trpc/vanilla";

/* ───────────────────────────────────────────────────────────────────────
 *  IOEdit store
 * ───────────────────────────────────────────────────────────────────────
 *  原先由 wf-editor-inner.tsx 以 useState + useCallback 声明、经
 *  `IOEditContext.Provider value={{ ioEditMode, workflowIO, toggleIO, … }}`
 *  下发。现把「状态 + 动作」一起收进 store；消费方按需订阅。
 *
 *  注意：reorderIO 会 PATCH 服务端，依赖 workflowId；故工厂参数携带
 *  workflowId。其余动作（toggleIO / setIOLabel / toggleIORequired /
 *  setIOValues / resetIOPreviewValues）都是纯状态更新，与编辑器其它 30+
 *  个画布 state 解耦。 */
export interface IOEditState {
  ioEditMode: boolean;
  workflowIO: Record<string, WorkflowIOParam>;
  ioPreviewOpen: boolean;
}
export interface IOEditActions {
  setIoEditMode: (on: boolean) => void;
  setIoPreviewOpen: (open: boolean) => void;
  toggleIO: (ref: IoRef) => void;
  setIOLabel: (key: string, label: string) => void;
  toggleIORequired: (key: string) => void;
  setIOValues: (next: Record<string, unknown>) => void;
  resetIOPreviewValues: () => void;
  reorderIO: (fromKey: string, beforeKey: string | null) => void;
}
export type IOEditStore = IOEditState & IOEditActions;

export function createIOEditStore(workflowId: string): StoreApi<IOEditStore> {
  return createStore<IOEditStore>((set) => ({
    ioEditMode: false,
    workflowIO: {},
    ioPreviewOpen: false,

    setIoEditMode: (on) => set({ ioEditMode: on }),
    setIoPreviewOpen: (open) => set({ ioPreviewOpen: open }),

    toggleIO: (ref) => {
      const key = `${ref.nodeId}::${ref.kind}::${ref.name}`;
      set((state) => {
        if (state.workflowIO[key]) {
          const next = { ...state.workflowIO };
          delete next[key];
          return { workflowIO: next };
        }
        return {
          workflowIO: {
            ...state.workflowIO,
            [key]: {
              direction: ref.direction,
              kind: ref.kind,
              nodeId: ref.nodeId,
              name: ref.name,
              label: ref.label,
            },
          },
        };
      });
    },

    setIOLabel: (key, label) =>
      set((state) => {
        const next = label.trim();
        const cur = state.workflowIO[key];
        if (!cur) return {};
        if (!next)
          return { workflowIO: { ...state.workflowIO, [key]: { ...cur, label: undefined } } };
        if (next === cur.label) return {};
        return { workflowIO: { ...state.workflowIO, [key]: { ...cur, label: next } } };
      }),

    toggleIORequired: (key) =>
      set((state) => {
        const cur = state.workflowIO[key];
        if (!cur) return {};
        if (cur.kind !== "widget") return {}; /* only widget inputs are tunable */
        return { workflowIO: { ...state.workflowIO, [key]: { ...cur, required: !cur.required } } };
      }),

    setIOValues: (next) =>
      set((state) => {
        const nextMap = { ...state.workflowIO } as Record<string, WorkflowIOParam>;
        let changed = false;
        for (const [ioKey, value] of Object.entries(next)) {
          const cur = nextMap[ioKey];
          if (cur?.kind !== "widget") continue;
          nextMap[ioKey] = { ...cur, value };
          changed = true;
        }
        return changed ? { workflowIO: nextMap } : {};
      }),

    resetIOPreviewValues: () =>
      set((state) => {
        const nextMap: Record<string, WorkflowIOParam> = {};
        let changed = false;
        for (const [entryKey, entry] of Object.entries(state.workflowIO)) {
          if (entry?.kind === "widget" && entry.value !== undefined) {
            const { value, ...rest } = entry;
            nextMap[entryKey] = rest;
            changed = true;
          } else {
            nextMap[entryKey] = entry;
          }
        }
        return changed ? { workflowIO: nextMap } : {};
      }),

    reorderIO: (fromKey, beforeKey) => {
      if (fromKey === beforeKey) return;
      set((state) => {
        const prev = state.workflowIO;
        const fromEntry = prev[fromKey];
        if (!fromEntry) return {};
        const groupOf = (e: WorkflowIOParam): "wire" | "widget" | "output" => {
          if (e.direction === "output") return "output";
          return e.kind === "widget" ? "widget" : "wire";
        };
        const movingGroup = groupOf(fromEntry);
        const ordered = Object.entries(prev)
          .map(([entryKey, entry]) => ({ entryKey, entry }))
          .filter(({ entry }) => entry && groupOf(entry) === movingGroup)
          .sort((itemA, itemB) => {
            const ao = itemA.entry.displayOrder;
            const bo = itemB.entry.displayOrder;
            if (ao === bo) return 0;
            if (ao === undefined) return 1;
            if (bo === undefined) return -1;
            return ao - bo;
          });
        const without = ordered.filter(({ entryKey }) => entryKey !== fromKey);
        let targetIdx = without.length;
        if (beforeKey) {
          const i = without.findIndex(({ entryKey }) => entryKey === beforeKey);
          if (i >= 0) targetIdx = i;
        }
        without.splice(targetIdx, 0, { entryKey: fromKey, entry: fromEntry });
        const renumbered: Record<string, WorkflowIOParam> = { ...prev };
        for (let i = 0; i < without.length; i++) {
          const { entryKey, entry } = without[i]!;
          renumbered[entryKey] = { ...entry, displayOrder: i + 1 };
        }
        /* Ship to the server (same call shape as before). */
        vanillaApi.workflow.update.mutate({
          id: workflowId,
          workflowIO: renumbered,
        }).catch(() => undefined);
        return { workflowIO: renumbered };
      });
    },
  }));
}

/* ───────────────────────────────────────────────────────────────────────
 *  单一 Carrier —— 由持有者（WorkflowEditorInner）创建 3 个 store 实例并下发。
 *  之所以用「单一 context 容器」而非 3 个独立 Provider：store 实例需在
 *  「状态判断逻辑（owner）」与「渲染子树（canvas + 叶子消费方）」两侧都能取到，
 *  owner 在容器之上创建 store 并用 api.getState/setState 直写，子树经 useStore
 *  订阅。这既消除 React Context 的「value 对象每次重渲重建 → 全子树重渲」问题，
 *  又保留每实例隔离。
 * ─────────────────────────────────────────────────────────────────────── */
export interface WFStores {
  io: StoreApi<IOEditStore>;
  rgthree: StoreApi<RgthreeGroupsStore>;
  viewer: StoreApi<NodeJsonViewerStore>;
}
export const WFStoresContext = createContext<WFStores | null>(null);

/** 取 IOEdit store 的 api —— 供 owner（WorkflowEditorInner）在容器上方直写。
 *  消费方请用 useIOEditStore(selector)。 */
export function getIOEditApi(): StoreApi<IOEditStore> {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- 设计如此：仅在组件渲染期间调用
  const ctx = useContext(WFStoresContext);
  if (!ctx) throw new Error("getIOEditApi 必须在 <WFStoresContext.Provider> 内使用");
  return ctx.io;
}
export function getRgthreeApi(): StoreApi<RgthreeGroupsStore> {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- 设计如此：仅在组件渲染期间调用
  const ctx = useContext(WFStoresContext);
  if (!ctx) throw new Error("getRgthreeApi 必须在 <WFStoresContext.Provider> 内使用");
  return ctx.rgthree;
}
export function getViewerApi(): StoreApi<NodeJsonViewerStore> {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- 设计如此：仅在组件渲染期间调用
  const ctx = useContext(WFStoresContext);
  if (!ctx) throw new Error("getViewerApi 必须在 <WFStoresContext.Provider> 内使用");
  return ctx.viewer;
}

export function useIOEditStore<U>(selector: (s: IOEditStore) => U): U {
  const ctx = useContext(WFStoresContext);
  if (!ctx) throw new Error("useIOEditStore 必须在 <WFStoresContext.Provider> 内使用");
  return useZustandStore(ctx.io, selector);
}

/* 便捷子选择器 —— 消费方直接用，避免手写 selector 样板。 */
export const selectIoEditMode = (s: IOEditStore) => s.ioEditMode;
export const selectWorkflowIO = (s: IOEditStore) => s.workflowIO;
export const selectIoPreviewOpen = (s: IOEditStore) => s.ioPreviewOpen;

/* ───────────────────────────────────────────────────────────────────────
 *  RgthreeGroups store
 * ───────────────────────────────────────────────────────────────────────
 *  乐观 overrides（groupId → bypass）优先于 detail.groups[].bypass，
 *  直到一次成功的 PATCH + detail refetch 调和。工厂参数携带 workflowId +
 *  detail（读 groups 的 fallback）。 */
export interface RgthreeGroupsState {
  /** 乐观 overrides（groupId → bypass），优先于 detail.groups[].bypass。 */
  overrides: Record<string, boolean>;
  /** 运行时同步进来的有效 detail / workflowId —— getBypass 每次从 get() 读，确切
   *  detail 到达（而非首次 factory 的 null）后仍反射最新 groups。 */
  detail: WorkflowDetail | null;
  workflowId: string;
}
export interface RgthreeGroupsActions {
  getBypass: (groupId: string) => boolean;
  setBypass: (groupId: string, bypass: boolean) => void;
}
export type RgthreeGroupsStore = RgthreeGroupsState & RgthreeGroupsActions;
export type RgthreeGroupsStoreParams = { workflowId: string; detail: WorkflowDetail | null };

export function createRgthreeGroupsStore(
  params: RgthreeGroupsStoreParams
): StoreApi<RgthreeGroupsStore> {
  return createStore<RgthreeGroupsStore>((set, get) => ({
    overrides: {},
    detail: params.detail,
    workflowId: params.workflowId,

    getBypass: (groupId) => {
      if (Object.prototype.hasOwnProperty.call(get().overrides, groupId)) {
        return get().overrides[groupId]!;
      }
      const g = get().detail?.groups?.find((x: WorkflowGroup) => x.id === groupId);
      return !!g?.bypass;
    },

    setBypass: (groupId, bypass) => {
      set((state) => ({ overrides: { ...state.overrides, [groupId]: bypass } }));
      vanillaApi.workflow.update.mutate({
        id: get().workflowId,
        groups: [{ id: groupId, bypass }],
      }).catch(() => undefined);
    },
  }));
}

export function useRgthreeGroupsStore<U>(selector: (s: RgthreeGroupsStore) => U): U {
  const ctx = useContext(WFStoresContext);
  if (!ctx) throw new Error("useRgthreeGroupsStore 必须在 <WFStoresContext.Provider> 内使用");
  return useZustandStore(ctx.rgthree, selector);
}
/* 返回 getBypass/setBypass —— 与 RgthreeGroupsContextValue 等价。 */
export function useRgthreeGroups(): RgthreeGroupsContextValue {
  const ctx = useContext(WFStoresContext);
  if (!ctx) throw new Error("useRgthreeGroups 必须在 <WFStoresContext.Provider> 内使用");
  const getBypass = useZustandStore(ctx.rgthree, (state) => state.getBypass);
  const setBypass = useZustandStore(ctx.rgthree, (state) => state.setBypass);
  return { getBypass, setBypass };
}

/* ───────────────────────────────────────────────────────────────────────
 *  NodeJsonViewer store
 * ───────────────────────────────────────────────────────────────────────
 *  requestShow（捕获 chip rect + nodeId + kind → viewer），dismiss，
 *  getNodeJson / getNodeView（detail / rawMeta / positions / 子图 raw def）。
 *  popover 本体（NodeJsonPopover）仍由 Provider 渲染并通过 context 提供，
 *  但状态/动作全部收进 store。 */
export interface NodeJsonViewerState {
  viewer: NodeJsonViewerRequest | null;
}
export interface NodeJsonViewerActions {
  getNodeJson: NodeJsonViewerContextValue["getNodeJson"];
  getNodeView: NodeJsonViewerContextValue["getNodeView"];
  requestShow: NodeJsonViewerContextValue["requestShow"];
  dismiss: () => void;
}
export type NodeJsonViewerStore = NodeJsonViewerState & NodeJsonViewerActions & NodeJsonViewerLookup;
export type NodeJsonViewerStoreParams = {
  detail: WorkflowDetail | null;
  rawMetaById: Record<string, RawMetaEntry>;
  positions: Record<string, [number, number]> | null;
  subgraphRawContext: { parentRawJson: unknown; subUid: string } | null;
  subgraphStackLength: number;
};

/* 可变查找上下文 —— getNodeJson/getNodeView 每次调用都从 get() 读最新值，
 * 由 Provider 在 params 变化时同步，确保 drill-in 子图视图仍反射最新 detail。 */
export interface NodeJsonViewerLookup {
  detail: WorkflowDetail | null;
  rawMetaById: Record<string, RawMetaEntry>;
  positions: Record<string, [number, number]> | null;
  subgraphRawContext: { parentRawJson: unknown; subUid: string } | null;
  subgraphStackLength: number;
}

export function createNodeJsonViewerStore(
  params: NodeJsonViewerStoreParams
): StoreApi<NodeJsonViewerStore> {
  return createStore<NodeJsonViewerStore>((set, get) => ({
    viewer: null,
    detail: params.detail,
    rawMetaById: params.rawMetaById,
    positions: params.positions,
    subgraphRawContext: params.subgraphRawContext,
    subgraphStackLength: params.subgraphStackLength,

    getNodeJson: (nodeId) => {
      const { detail } = get();
      if (!detail?.graph) return null;
      const entry = detail.graph[nodeId];
      return entry && typeof entry === "object" ? (entry as Record<string, any>) : null;
    },

    getNodeView: (nodeId) => {
      const { detail, rawMetaById, positions, subgraphRawContext, subgraphStackLength } = get();
      if (!detail) return null;
      const rawEntry = detail.graph?.[nodeId];
      const entry =
        rawEntry && typeof rawEntry === "object" ? (rawEntry as Record<string, any>) : null;
      let rawNodesSource: any[] | null = null;
      const isSubView = subgraphStackLength > 0 && subgraphRawContext;
      if (isSubView) {
        const subs = (
          subgraphRawContext.parentRawJson as
            | { definitions?: { subgraphs?: Record<string, any> } }
            | null
        )?.definitions?.subgraphs;
        const targetUid = subgraphRawContext.subUid;
        let subDef: any = subs?.[targetUid];
        if (!subDef || !Array.isArray(subDef.nodes)) {
          const matchKey = subs
            ? Object.keys(subs).find((key) => subs[key]?.id === targetUid)
            : undefined;
          if (matchKey && subs) subDef = subs[matchKey];
        }
        if (subDef && Array.isArray(subDef.nodes)) {
          rawNodesSource = subDef.nodes as any[];
        }
      }
      if (!rawNodesSource && Array.isArray((detail.rawJson as any)?.nodes)) {
        rawNodesSource = (detail.rawJson as any).nodes as any[];
      }
      const rawNode = rawNodesSource
        ? (rawNodesSource.find((rawNodesSource) => String(rawNodesSource?.id) === nodeId) ?? null)
        : null;
      return {
        entry,
        raw: rawMetaById?.[nodeId],
        rawNode,
        pos: positions?.[nodeId] ?? null,
      };
    },

    requestShow: (anchorEl, nodeId, kind) => {
      const rect = anchorEl.getBoundingClientRect();
      set({ viewer: { anchorRect: rectToAnchor(rect), nodeId, kind } });
    },

    dismiss: () => set({ viewer: null }),
  }));
}

export function useNodeJsonViewerStore<U>(selector: (s: NodeJsonViewerStore) => U): U {
  const ctx = useContext(WFStoresContext);
  if (!ctx) throw new Error("useNodeJsonViewerStore 必须在 <WFStoresContext.Provider> 内使用");
  return useZustandStore(ctx.viewer, selector);
}
/* 便捷访问 —— 与原 NodeJsonViewerContextValue 等价，供 NodeIdChip 等使用。 */
export function useNodeJsonViewer(): NodeJsonViewerContextValue {
  const ctx = useContext(WFStoresContext);
  if (!ctx) throw new Error("useNodeJsonViewer 必须在 <WFStoresContext.Provider> 内使用");
  const getNodeJson = useZustandStore(ctx.viewer, (state) => state.getNodeJson);
  const getNodeView = useZustandStore(ctx.viewer, (state) => state.getNodeView);
  const requestShow = useZustandStore(ctx.viewer, (state) => state.requestShow);
  const dismiss = useZustandStore(ctx.viewer, (state) => state.dismiss);
  const viewer = useZustandStore(ctx.viewer, (state) => state.viewer);
  return { getNodeJson, getNodeView, requestShow, dismiss, viewer };
}

/* ════════════════════════════════════════════════════════════════════════
 *  WFStoresProvider —— 由持有者（WorkflowEditorInner）在组件体内创建 3 个
 *  store 实例并一次性下发。持有者自身用 getIOEditApi()/getRgthreeApi()/
 *  getViewerApi() 直写；渲染子树经 useStore(selector) 订阅。
 * ════════════════════════════════════════════════════════════════════════ */
export function WFStoresProvider({
  stores,
  children,
}: {
  stores: WFStores;
  children: React.ReactNode;
}) {
  return (
    <WFStoresContext.Provider value={stores}>
      {children}
      <NodeJsonViewerPortal store={stores.viewer} />
    </WFStoresContext.Provider>
  );
}

function NodeJsonViewerPortal({ store }: { store: StoreApi<NodeJsonViewerStore> }) {
  const viewer = useZustandStore(store, (state) => state.viewer);
  const getNodeJson = useZustandStore(store, (state) => state.getNodeJson);
  const getNodeView = useZustandStore(store, (state) => state.getNodeView);
  const dismiss = useZustandStore(store, (state) => state.dismiss);
  if (!viewer) return null;
  return (
    <NodeJsonPopover
      key={`${viewer.nodeId}-${viewer.kind}`}
      request={viewer}
      getJson={getNodeJson}
      getView={getNodeView}
      onDismiss={dismiss}
    />
  );
}