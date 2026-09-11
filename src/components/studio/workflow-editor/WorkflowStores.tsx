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
} from "../workflow-types";
import type { WorkflowIOModeOverride } from "~/lib/workflow-io-types";
import { isStaleExposedAlias, type ExposedAliasBase } from "./io-exposure";
import { rectToAnchor } from "../workflow-utils";
import { NodeJsonPopover } from "../WorkflowNodeJsonPopover";
import { patchWorkflowSilently } from "@/lib/workflow-mutations";

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
  /** 服务端富化下发的别名判定基准（ioKey → 原始槽位名 + 本层作者名）。
   *
   *  只有它才能判定「本地存的名字是不是一串机器生成的槽位名」——判定基准必须
   *  来自富化（服务端 / 视图派生的同一份事实源），不能从本地条目推。没有它时
   *  `name` 会在加载时被解析好的名字覆盖，任何写入都会把旧名字固化回库
   *  （ISSUE #349 的复现路径）。空表 = 富化还没到，此时不做清理。
   *
   *  基准不只有槽位名：同名条目（本地 label 恰好等于槽位名本身）只靠名字比对
   *  永远判不出来，还得知道「本层槽位有没有另一个作者业务名」——
   *  见 `ExposedAliasBase` 与 `isStaleExposedAlias`。 */
  aliasBaseByKey: Record<string, ExposedAliasBase>;
}
export interface IOEditActions {
  setIoEditMode: (on: boolean) => void;
  setIoPreviewOpen: (open: boolean) => void;
  /** 同步富化下发的别名判定基准（只有内容真的变了才写，避免渲染回路）。 */
  setAliasBase: (next: Record<string, ExposedAliasBase>) => void;
  toggleIO: (ref: IoRef) => void;
  setIOLabel: (key: string, label: string) => void;
  toggleIORequired: (key: string) => void;
  setIOValues: (next: Record<string, unknown>) => void;
  /** seed 类参数的「控件后行为」（fixed / increment / decrement / random）。 */
  setIOSeedMode: (key: string, mode: string) => void;
  resetIOPreviewValues: () => void;
  reorderIO: (fromKey: string, beforeKey: string | null) => void;
  /** 多模式：写入 / 清除某个参数在某一模式下的覆盖项。
   *  `patch` 为 null 表示删除该模式的覆盖（回到「通用默认值 + 默认可见」）。
   *  与 setIOLabel / toggleIORequired 同路径持久化：下一次 PATCH 整体
   *  workflowIO 时一起落库，无需改表。 */
  setIOModeOverride: (
    key: string,
    mode: string,
    patch: WorkflowIOModeOverride | null
  ) => void;
  /** 批量摘掉所有 IO 条目上给定模式码的覆盖层（modes[mode]）。
   *  模式从工作流 `modes` 列移除后，条目里的覆盖必须跟着清掉，否则这些
   *  无主覆盖会一直跟着 workflowIO 落库往返（页签栏不再显示，纯脏数据）。
   *  返回清理后的 workflowIO 映射；没有任何覆盖命中时返回 null，调用方
   *  据此决定是否需要把清理结果落库。 */
  purgeModeOverrides: (codes: string[]) => Record<string, WorkflowIOParam> | null;
}
export type IOEditStore = IOEditState & IOEditActions;

export function createIOEditStore(workflowId: string): StoreApi<IOEditStore> {
  return createStore<IOEditStore>((set, get) => ({
    ioEditMode: false,
    workflowIO: {},
    ioPreviewOpen: false,
    aliasBaseByKey: {},

    setIoEditMode: (on) => set({ ioEditMode: on }),
    setIoPreviewOpen: (open) => set({ ioPreviewOpen: open }),

    setAliasBase: (next) =>
      set((state) => {
        const prev = state.aliasBaseByKey;
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        /* 逐键比 name + slotLabel：值对象每次都由富化重建，浅比引用会把每帧
         *  都当成变化 → setAliasBase → 重渲 → 再算一份基准（渲染回路）。 */
        const same =
          prevKeys.length === nextKeys.length &&
          nextKeys.every(
            (key) =>
              prev[key]?.name === next[key]?.name &&
              prev[key]?.slotLabel === next[key]?.slotLabel
          );
        if (same) return {};
        return { aliasBaseByKey: next };
      }),

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
              /* 下钻到子图内部勾选时，画布把「从哪一层钻进来」的宿主节点 id 一并
               * 带上：内部节点 id（`1670`）在顶层画布上不存在，运行期 comfy-cli
               * 展开后的 id 是 `4:1670`，两个 id 都存下来才能确定性还原。 */
              ...(ref.hostNodeId ? { hostNodeId: ref.hostNodeId } : {}),
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
        /* 只有本代画布勾选写入的 widget 条目可调「必填」；param（连线端口）
         *  与 output 不可调。存储自新格式起即正确区分 kind，此处直接以
         *  kind !== "widget" 拦截即可，无需旧数据特判。 */
        if (cur.kind !== "widget") return {};
        return { workflowIO: { ...state.workflowIO, [key]: { ...cur, required: !cur.required } } };
      }),

    setIOModeOverride: (key, mode, patch) =>
      set((state) => {
        const cur = state.workflowIO[key];
        if (!cur || !mode) return {};
        /* 写这个条目之前先把「存量机器名」清掉。
         *
         * 旧版勾选会把画布上的显示名写进本地 label，而修复前某些路径写进去的
         *  就是原始槽位名（封装节点的别名 `value_1`、普通节点的 pin 名
         *  `image`）。这串东西由 `resolveExposedLabel` 在**显示**上让位给服务端
         *  富化名，但本地 label 仍是老值：任何一次写入（切换 seed 的「随机值 /
         *  固定值」、改必填、改值、拖排序……）都会把老值当作「作者命名」整体
         *  落库，显示名随即退回 `value_1`（ISSUE #349 的复现路径）。
         *
         *  清掉本地 label 后，条目回到「未重命名」语义：显示名继续由富化名提供，
         *  落库也不再固化那串机器名。真正的作者命名（≠ pin 名）不受影响。 */
        const aliases = get().aliasBaseByKey[key];
        /* 判据需要的不只是槽位名：同名条目（本地 label 就是槽位名本身）要问
         *  「富化链现在给这个名字的显示名是什么」——富化名与别名不同就说明本层
         *  确实有作者命名，本地那串该让位；`slotLabel` 是富化名也停在别名时的
         *  第二判据。缺任一项时 isStaleExposedAlias 只按手头的信息判，不会乱清。 */
        const staleAlias =
          cur.label !== undefined &&
          isStaleExposedAlias(
            cur.label,
            aliases?.name,
            aliases?.enrichedLabel,
            aliases?.slotLabel
          );
        const modes: Record<string, WorkflowIOModeOverride> = { ...(cur.modes ?? {}) };
        if (patch === null) {
          if (!(mode in modes)) return {};
          delete modes[mode];
        } else {
          modes[mode] = { ...(modes[mode] ?? {}), ...patch };
        }
        /* modes 全空时把字段摘掉，避免往服务端 JSON 里塞一个空对象。 */
        const nextEntry: WorkflowIOParam =
          Object.keys(modes).length > 0 ? { ...cur, modes } : { ...cur, modes: undefined };
        return {
          workflowIO: {
            ...state.workflowIO,
            [key]: staleAlias ? { ...nextEntry, label: undefined } : nextEntry,
          },
        };
      }),

    purgeModeOverrides: (codes) => {
      let cleaned: Record<string, WorkflowIOParam> | null = null;
      set((state) => {
        const hit = codes.filter((code) =>
          Object.values(state.workflowIO).some(
            (entry) => entry?.modes != null && code in entry.modes
          )
        );
        if (hit.length === 0) return {};
        const next: Record<string, WorkflowIOParam> = {};
        for (const [key, entry] of Object.entries(state.workflowIO)) {
          const modes = entry?.modes;
          if (!modes || !hit.some((code) => code in modes)) {
            next[key] = entry;
            continue;
          }
          const rest = { ...modes };
          for (const code of hit) delete rest[code];
          /* 与 setIOModeOverride 的落库形态一致：modes 全空时摘掉字段。 */
          next[key] = { ...entry, modes: Object.keys(rest).length > 0 ? rest : undefined };
        }
        cleaned = next;
        return { workflowIO: next };
      });
      return cleaned;
    },

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

    setIOSeedMode: (key, mode) =>
      set((state) => {
        const cur = state.workflowIO[key];
        if (cur?.kind !== "widget") return {};
        if (cur.seedMode === mode) return {};
        return { workflowIO: { ...state.workflowIO, [key]: { ...cur, seedMode: mode } } };
      }),

    resetIOPreviewValues: () =>
      set((state) => {
        const nextMap: Record<string, WorkflowIOParam> = {};
        let changed = false;
        for (const [entryKey, entry] of Object.entries(state.workflowIO)) {
          if (entry?.kind === "widget" && entry.value !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- value 仅在本分支被剔除（widget 的运行时值不持久化到 IO 配置）
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
        patchWorkflowSilently({ id: workflowId, workflowIO: renumbered });
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
      patchWorkflowSilently({
        id: get().workflowId,
        groups: [{ id: groupId, bypass }],
      });
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
      const entry: unknown = detail.graph[nodeId];
      return entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    },

    getNodeView: (nodeId) => {
      const { detail, rawMetaById, positions, subgraphRawContext, subgraphStackLength } = get();
      if (!detail) return null;
      const rawEntry: unknown = detail.graph?.[nodeId];
      const entry =
        rawEntry && typeof rawEntry === "object"
          ? (rawEntry as Record<string, unknown>)
          : null;
      let rawNodesSource: Array<Record<string, unknown>> | null = null;
      const isSubView = subgraphStackLength > 0 && subgraphRawContext;
      if (isSubView) {
        const subs = (
          subgraphRawContext.parentRawJson as
            | { definitions?: { subgraphs?: Record<string, unknown> } }
            | null
        )?.definitions?.subgraphs;
        const targetUid = subgraphRawContext.subUid;
        // raw subgraph definitions are untyped server payloads; read only
        // the fields the viewer needs (id / nodes) through a narrow shape.
        type RawSubgraphDef = {
          id?: string;
          nodes?: Array<Record<string, unknown>>;
        };
        let subDef: RawSubgraphDef | undefined = subs?.[targetUid] as
          | RawSubgraphDef
          | undefined;
        if (!subDef || !Array.isArray(subDef.nodes)) {
          const matchKey = subs
            ? Object.keys(subs).find(
                (key) =>
                  (subs[key] as RawSubgraphDef | undefined)?.id === targetUid,
              )
            : undefined;
          if (matchKey && subs) subDef = subs[matchKey] as RawSubgraphDef;
        }
        if (subDef && Array.isArray(subDef.nodes)) {
          rawNodesSource = subDef.nodes;
        }
      }
      if (
        !rawNodesSource &&
        typeof detail.rawJson === "object" &&
        detail.rawJson !== null &&
        Array.isArray((detail.rawJson as { nodes?: unknown }).nodes)
      ) {
        rawNodesSource = (detail.rawJson as {
          nodes: Array<Record<string, unknown>>;
        }).nodes;
      }
      const rawNode = rawNodesSource
        ? (rawNodesSource.find(
            (rawNode) => String(rawNode?.id) === nodeId,
          ) ?? null)
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