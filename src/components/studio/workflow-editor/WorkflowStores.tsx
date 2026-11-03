"use client";
/* ═══ WorkflowStores.tsx — Zustand 状态层（3 个画布 store 的唯一出口）═══
 * 按编辑器实例隔离的 IOEditStore / RgthreeGroupsStore / NodeJsonViewerStore，经薄
 * React Context 下发。**不用模块级单例**：编辑器与项目画布可同时挂载同一套
 * wf-editor-inner（还有 drill-in 子图栈），单例会互相串态。模式：`createStore` 工厂 +
 * Provider（只传引用）+ `useStore(storeCtx, selector)` 订阅（zustand v4/v5 官方写法）。 */
import React, { createContext, useContext } from "react";
import { createStore, useStore as useZustandStore, type StoreApi } from "zustand";
import type {
  WorkflowDetail,
  WorkflowGroup,
  RawMetaEntry,
  IoRef,
  IOParamSlot,
  WorkflowIOParam,
  RgthreeGroupsContextValue,
  NodeJsonViewerRequest,
  NodeJsonViewerContextValue,
  WorkflowIODropPosition,
} from "../workflow-types";
import type { WorkflowIOModeOverride } from "~/lib/workflow/workflow-io-types";
import { rectToAnchorRect } from "~/lib/dom-rect";
import { NodeJsonPopover } from "../WorkflowNodeJsonPopover";
import { patchWorkflowSilently } from "~/lib/workflow/workflow-mutations";
import { reportStaleStoreAction } from "~/lib/shell/stale-store-notify";

/* ─── IOEdit store ─── 原先在 wf-editor-inner 用 useState + useCallback 声明、
 * 经 IOEditContext.Provider 下发 ioEditMode / workflowIO / toggleIO 等；现把「状态 +
 * 动作」一起收进 store，消费方按需订阅。注意 `reorderIO` 会 PATCH 服务端、依赖
 * workflowId（故工厂参数携带它）；其余动作（toggleIO / setIOLabel / toggleIORequired /
 * setIOModeOverride / purgeModeOverrides）都是纯状态更新，与其它 30+ 画布 state 解耦。 */
export type IOEditState = {
  ioEditMode: boolean;
  ioPreviewOpen: boolean;
  workflowIO: Record<string, WorkflowIOParam>;
  /** 本地勾选态里的作者重命名（`label`）只由 `setIOLabel` 写入；勾选 / 取消
   *  勾选不再抄画布的显示名进库，因此这里没有「既不是作者命名、又要保留」的
   *  中间态，也不需要任何机器名判定。 */
};
export type IOEditActions = {
  /** 批量摘掉所有 IO 条目上给定模式码的覆盖层（modes[mode]）。
   *  模式从工作流 `modes` 列移除后，条目里的覆盖必须跟着清掉，否则这些
   *  无主覆盖会一直跟着 workflowIO 落库往返（页签栏不再显示，纯脏数据）。
   *  返回清理后的 workflowIO 映射；没有任何覆盖命中时返回 null，调用方
   *  据此决定是否需要把清理结果落库。 */
  purgeModeOverrides: (codes: Array<string>) => Record<string, WorkflowIOParam> | null;
  reorderIO: (fromKey: string, targetKey: string | null, position: WorkflowIODropPosition) => void;
  /** 开关 IO 编辑模式。关闭时**一并关掉 IO 预览**（见下一条的耦合说明）；
   *  打开时不动预览。 */
  setIoEditMode: (on: boolean) => void;
  setIOLabel: (key: string, label: string) => void;
  /** 多模式：写入 / 清除某个参数在某一模式下的覆盖项。
   *  `patch` 为 null 表示删除该模式的覆盖（回到「通用默认值 + 默认可见」）。
   *  与 setIOLabel / toggleIORequired 同路径持久化：下一次 PATCH 整体
   *  workflowIO 时一起落库，无需改表。 */
  setIOModeOverride: (key: string, mode: string, patch: WorkflowIOModeOverride | null) => void;
  /** 开关 IO 预览面板。关闭时**一并退出 IO 编辑模式**：面板消失后再留着勾选框，作者
   *  只剩「看不到结果、只看到选择器」的半截状态；打开时**一并进入编辑模式**，让勾选
   *  框与面板同时可用。两个方向都收在这里，不在视图层手写 setState —— 顶栏与画布按钮
   *  都只调这一个动作（源码级守卫见 `workflow-editor-topbar-config.test.ts`）。 */
  setIoPreviewOpen: (open: boolean) => void;
  /** seed 类参数的「控件后行为」（fixed / increment / decrement / random）。 */
  setIOSeedMode: (key: string, mode: string) => void;
  toggleIO: (ref: IoRef) => void;
  toggleIORequired: (key: string) => void;
};
export type IOEditStore = IOEditState & IOEditActions;

export function createIOEditStore(workflowId: string): StoreApi<IOEditStore> {
  return createStore<IOEditStore>((set) => ({
    ioEditMode: false,
    workflowIO: {},
    ioPreviewOpen: false,

    setIoEditMode: (on) => {
      set(on ? { ioEditMode: true } : { ioEditMode: false, ioPreviewOpen: false });
    },
    setIoPreviewOpen: (open) => {
      set(
        open
          ? { ioPreviewOpen: true, ioEditMode: true }
          : { ioPreviewOpen: false, ioEditMode: false },
      );
    },

    toggleIO: (ref) => {
      const key = `${ref.nodeId}::${ref.kind}::${ref.name}`;
      /* `direction` 由 `kind` 决定（output → output，其余 → input），
       *  先合成判别联合的 `slot`，再展开进记录 —— 这样 `WorkflowIOParam`
       *  的非法组合（output+param 等）在类型层面就不可能构造出来。 */
      const slot: IOParamSlot =
        ref.kind === "output"
          ? { direction: "output", kind: "output" }
          : { direction: "input", kind: ref.kind };
      set((state) => {
        if (state.workflowIO[key]) {
          const next = { ...state.workflowIO };
          delete next[key];
          return { workflowIO: next };
        }
        /* 只记身份字段：画布勾选那一刻透传的显示名**不进库**（它本来就是画布
         *  从同一个 raw 槽位读出来的名字，由富化链一处算）。`label` 从此只由
         *  `setIOLabel` 写入，含义单一 = 作者重命名。 */
        return {
          workflowIO: {
            ...state.workflowIO,
            [key]: {
              ...slot,
              nodeId: ref.nodeId,
              name: ref.name,
              /* 下钻到子图内部勾选时，画布把「从哪一层钻进来」的宿主节点 id 一并
               * 带上：内部节点 id（`1670`）在顶层画布上不存在，运行期 comfy-cli
               * 展开后的 id 是 `4:1670`，两个 id 都存下来才能确定性还原。 */
              ...(ref.hostNodeId ? { hostNodeId: ref.hostNodeId } : {}),
            },
          },
        };
      });
    },

    setIOLabel: (key, label) => {
      set((state) => {
        const cur = state.workflowIO[key];
        if (!cur) {
          return {};
        }
        /* 清空 = 恢复默认（取消这条参数的重命名），显示名回到富化链。
         * 写什么就存什么：不再有「这个名字像机器名，所以不让存」的判定 ——
         * 作者的显式命名是唯一真相（ISSUE #349 的「改了也不行」不会再出现）。 */
        const kept = label.trim() || undefined;
        if (kept === cur.label) {
          return {};
        }
        return {
          workflowIO: { ...state.workflowIO, [key]: { ...cur, label: kept } },
        };
      });
    },

    toggleIORequired: (key) => {
      set((state) => {
        const cur = state.workflowIO[key];
        if (!cur) {
          return {};
        }
        /* 只有本代画布勾选写入的 widget 条目可调「必填」；param（连线端口）
         *  与 output 不可调。存储自新格式起即正确区分 kind，此处直接以
         *  kind !== "widget" 拦截即可，无需旧数据特判。 */
        if (cur.kind !== "widget") {
          return {};
        }
        return {
          workflowIO: {
            ...state.workflowIO,
            [key]: { ...cur, required: !cur.required },
          },
        };
      });
    },

    setIOModeOverride: (key, mode, patch) => {
      set((state) => {
        const cur = state.workflowIO[key];
        if (!cur || !mode) {
          return {};
        }
        const modes: Record<string, WorkflowIOModeOverride> = {
          ...cur.modeOverrides,
        };
        if (patch === null) {
          if (!(mode in modes)) {
            return {};
          }
          delete modes[mode];
        } else {
          modes[mode] = { ...modes[mode], ...patch };
        }
        /* modes 全空时把字段摘掉，避免往服务端 JSON 里塞一个空对象。 */
        const nextEntry: WorkflowIOParam =
          Object.keys(modes).length > 0
            ? { ...cur, modeOverrides: modes }
            : { ...cur, modeOverrides: undefined };
        return {
          workflowIO: {
            ...state.workflowIO,
            [key]: nextEntry,
          },
        };
      });
    },

    purgeModeOverrides: (codes) => {
      let cleaned: Record<string, WorkflowIOParam> | null = null;
      set((state) => {
        const hit = codes.filter((code) =>
          Object.values(state.workflowIO).some(
            // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
            (entry) => entry?.modeOverrides != null && code in entry.modeOverrides,
          ),
        );
        if (hit.length === 0) {
          return {};
        }
        const next: Record<string, WorkflowIOParam> = {};
        for (const [key, entry] of Object.entries(state.workflowIO)) {
          const modes = entry?.modeOverrides;
          if (!modes || !hit.some((code) => code in modes)) {
            next[key] = entry;
            continue;
          }
          const rest = { ...modes };
          for (const code of hit) {
            delete rest[code];
          }
          /* 与 setIOModeOverride 的落库形态一致：modes 全空时摘掉字段。 */
          next[key] = {
            ...entry,
            modeOverrides: Object.keys(rest).length > 0 ? rest : undefined,
          };
        }
        cleaned = next;
        return { workflowIO: next };
      });
      return cleaned;
    },

    setIOSeedMode: (key, mode) => {
      set((state) => {
        const cur = state.workflowIO[key];
        if (cur?.kind !== "widget") {
          return {};
        }
        if (cur.seedMode === mode) {
          return {};
        }
        return {
          workflowIO: {
            ...state.workflowIO,
            [key]: { ...cur, seedMode: mode },
          },
        };
      });
    },

    /* 拖拽排序：把 `fromKey` 移到 `targetKey` 的位置。契约：`targetKey` 是**松手时
     *  鼠标所在那行**（`null` = 移到末尾）；插到它前还是后由 `position` **显式**给出
     *  （指针在目标行上半区 = before、下半区 = after，与指示线同源）。旧版按拖动方向
     *  猜插入点、指示线却永远画在行顶，两者打架时用户看到「拖了但顺序没变」。 */
    reorderIO: (fromKey, targetKey, position) => {
      if (fromKey === targetKey) {
        return;
      }
      set((state) => {
        const prev = state.workflowIO;
        const fromEntry = prev[fromKey];
        if (!fromEntry) {
          return {};
        }
        const groupOf = (e: WorkflowIOParam): "wire" | "widget" | "output" => {
          if (e.direction === "output") {
            return "output";
          }
          return e.kind === "widget" ? "widget" : "wire";
        };
        const movingGroup = groupOf(fromEntry);
        const ordered = Object.entries(prev)
          .map(([entryKey, entry]) => ({ entryKey, entry }))
          .filter(({ entry }) => entry && groupOf(entry) === movingGroup)
          .sort((itemA, itemB) => {
            const ao = itemA.entry.displayOrder;
            const bo = itemB.entry.displayOrder;
            if (ao === bo) {
              return 0;
            }
            if (ao === undefined) {
              return 1;
            }
            if (bo === undefined) {
              return -1;
            }
            return ao - bo;
          });
        const without = ordered.filter(({ entryKey }) => entryKey !== fromKey);
        let targetIdx = without.length;
        if (targetKey) {
          const i = without.findIndex(({ entryKey }) => entryKey === targetKey);
          if (i !== -1) {
            targetIdx = position === "after" ? i + 1 : i;
          }
        }
        without.splice(targetIdx, 0, { entryKey: fromKey, entry: fromEntry });
        const renumbered: Record<string, WorkflowIOParam> = { ...prev };
        for (const [i, { entryKey, entry }] of without.entries()) {
          renumbered[entryKey] = { ...entry, displayOrder: i + 1 };
        }
        /* 发往服务端（调用形状与之前一致）。 */
        patchWorkflowSilently({ id: workflowId, workflowIO: renumbered });
        return { workflowIO: renumbered };
      });
    },
  }));
}

/* ─── 单一 Carrier ─── 由持有者（WorkflowEditorInner）创建 3 个 store 实例并下发。
 * 用「单一 context 容器」而非 3 个独立 Provider：store 实例需在状态判断逻辑（owner）
 * 与渲染子树两侧都能取到 —— owner 在容器之上创建并 `getState/setState` 直写，子树经
 * `useStore` 订阅。这消除「value 对象每次重渲重建 → 全子树重渲」，又保留每实例隔离。 */
export type WFStores = {
  io: StoreApi<IOEditStore>;
  rgthree: StoreApi<RgthreeGroupsStore>;
  viewer: StoreApi<NodeJsonViewerStore>;
};
export const WFStoresContext = createContext<WFStores | null>(null);

/** 取 IOEdit store 的 api —— 供 owner（WorkflowEditorInner）在容器上方直写。
 *  内部调 useContext，是 hook，只能在组件渲染期调用。
 *  消费方请用 useIOEditStore(selector)。 */
export function useIOEditApi(): StoreApi<IOEditStore> {
  const ctx = useContext(WFStoresContext);
  if (!ctx) {
    throw new Error("useIOEditApi 必须在 <WFStoresContext.Provider> 内使用");
  }
  return ctx.io;
}
export function useRgthreeApi(): StoreApi<RgthreeGroupsStore> {
  const ctx = useContext(WFStoresContext);
  if (!ctx) {
    throw new Error("useRgthreeApi 必须在 <WFStoresContext.Provider> 内使用");
  }
  return ctx.rgthree;
}
export function useViewerApi(): StoreApi<NodeJsonViewerStore> {
  const ctx = useContext(WFStoresContext);
  if (!ctx) {
    throw new Error("useViewerApi 必须在 <WFStoresContext.Provider> 内使用");
  }
  return ctx.viewer;
}

/** 调用 store 实例上的动作，**缺失时降级而非抛错**。实例挂载时创建一次，动作集合是
 *  那一刻取到的函数，而动作是本模块成员、会被 HMR 整体替换：dev server 长开或编辑器
 *  先已挂载时，`getState()` 返回旧实例、可能缺新动作，直接调用抛
 *  `xxx is not a function` → ErrorBoundary 把编辑器降级成错误页。故跳过本次调用并在
 *  `~/lib/stale-store-notify` 弹「重载即可恢复」通知 —— 降级**不得静默**（§10.1 L1）。 */
export function callStoreAction<S extends object>(
  store: StoreApi<S>,
  action: keyof S & string,
  call: (state: S) => void,
): boolean {
  const state = store.getState();
  if (typeof state[action] !== "function") {
    console.warn(
      `[wf-stores] 动作 ${action} 在当前 store 实例上不存在，已跳过本次调用` +
        `（多为热更新后未重载的陈旧实例，重载页面即恢复）`,
    );
    reportStaleStoreAction("missing-store-action");
    return false;
  }
  call(state);
  return true;
}

export function useIOEditStore<U>(selector: (s: IOEditStore) => U): U {
  const ctx = useContext(WFStoresContext);
  if (!ctx) {
    throw new Error("useIOEditStore 必须在 <WFStoresContext.Provider> 内使用");
  }
  return useZustandStore(ctx.io, selector);
}

/* 便捷子选择器 —— 消费方直接用，避免手写 selector 样板。 */
export const selectIoEditMode = (s: IOEditStore) => s.ioEditMode;
export const selectWorkflowIO = (s: IOEditStore) => s.workflowIO;
export const selectIoPreviewOpen = (s: IOEditStore) => s.ioPreviewOpen;

/* ─── RgthreeGroups store ───
 * 乐观 overrides（groupId → bypass）优先于 detail.groups[].bypass，直到一次成功的
 * PATCH + detail refetch 调和。工厂参数携带 workflowId + detail（读 groups 的
 * fallback）。 */
export type RgthreeGroupsState = {
  /** 运行时同步进来的有效 detail / workflowId —— getBypass 每次从 get() 读，确切
   *  detail 到达（而非首次 factory 的 null）后仍反射最新 groups。 */
  detail: WorkflowDetail | null;
  /** 乐观 overrides（groupId → bypass），优先于 detail.groups[].bypass。 */
  overrides: Record<string, boolean>;
  workflowId: string;
};
export type RgthreeGroupsActions = {
  getBypass: (groupId: string) => boolean;
  setBypass: (groupId: string, bypass: boolean) => void;
};
export type RgthreeGroupsStore = RgthreeGroupsState & RgthreeGroupsActions;
export type RgthreeGroupsStoreParams = {
  detail: WorkflowDetail | null;
  workflowId: string;
};

export function createRgthreeGroupsStore(
  params: RgthreeGroupsStoreParams,
): StoreApi<RgthreeGroupsStore> {
  return createStore<RgthreeGroupsStore>((set, get) => ({
    overrides: {},
    detail: params.detail,
    workflowId: params.workflowId,

    getBypass: (groupId) => {
      const override = get().overrides[groupId];
      /* 用 `in` 判据 + 值本身收窄：`hasOwnProperty` 只回答「有没有这个键」，
       * 类型上仍要做一次索引取值。 */
      if (override !== undefined) {
        return override;
      }
      const g = get().detail?.groups?.find((x: WorkflowGroup) => x.id === groupId);
      return !!g?.bypass;
    },

    setBypass: (groupId, bypass) => {
      set((state) => ({
        overrides: { ...state.overrides, [groupId]: bypass },
      }));
      patchWorkflowSilently({
        id: get().workflowId,
        groups: [{ id: groupId, bypass }],
      });
    },
  }));
}

export function useRgthreeGroupsStore<U>(selector: (s: RgthreeGroupsStore) => U): U {
  const ctx = useContext(WFStoresContext);
  if (!ctx) {
    throw new Error("useRgthreeGroupsStore 必须在 <WFStoresContext.Provider> 内使用");
  }
  return useZustandStore(ctx.rgthree, selector);
}
/* 返回 getBypass/setBypass —— 与 RgthreeGroupsContextValue 等价。 */
export function useRgthreeGroups(): RgthreeGroupsContextValue {
  const ctx = useContext(WFStoresContext);
  if (!ctx) {
    throw new Error("useRgthreeGroups 必须在 <WFStoresContext.Provider> 内使用");
  }
  const getBypass = useZustandStore(ctx.rgthree, (state) => state.getBypass);
  const setBypass = useZustandStore(ctx.rgthree, (state) => state.setBypass);
  return { getBypass, setBypass };
}

/* ─── NodeJsonViewer store ───
 * requestShow（捕获 chip rect + nodeId + kind → viewer）、dismiss、getNodeJson /
 * getNodeView（detail / rawMeta / positions / 子图 raw def）。popover 本体
 * （NodeJsonPopover）仍由 Provider 渲染并读 context，状态与动作全部收进 store。 */
export type NodeJsonViewerState = {
  viewer: NodeJsonViewerRequest | null;
};
export type NodeJsonViewerActions = {
  dismiss: () => void;
  getNodeJson: NodeJsonViewerContextValue["getNodeJson"];
  getNodeView: NodeJsonViewerContextValue["getNodeView"];
  requestShow: NodeJsonViewerContextValue["requestShow"];
};
export type NodeJsonViewerStore = NodeJsonViewerState &
  NodeJsonViewerActions &
  NodeJsonViewerLookup;
export type NodeJsonViewerStoreParams = {
  detail: WorkflowDetail | null;
  positions: Record<string, [number, number]> | null;
  rawMetaById: Record<string, RawMetaEntry>;
  subgraphRawContext: { parentRawJson: unknown; subUid: string } | null;
  subgraphStackLength: number;
};

/* 可变查找上下文 —— getNodeJson/getNodeView 每次调用都从 get() 读最新值，
 * 由 Provider 在 params 变化时同步，确保 drill-in 子图视图仍反射最新 detail。 */
export type NodeJsonViewerLookup = {
  detail: WorkflowDetail | null;
  positions: Record<string, [number, number]> | null;
  rawMetaById: Record<string, RawMetaEntry>;
  subgraphRawContext: { parentRawJson: unknown; subUid: string } | null;
  subgraphStackLength: number;
};

export function createNodeJsonViewerStore(
  params: NodeJsonViewerStoreParams,
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
      if (!detail?.graph) {
        return null;
      }
      const entry: unknown = detail.graph[nodeId];
      /* SAFETY: 类型断言已复核 */
      return entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    },

    getNodeView: (nodeId) => {
      const { detail, rawMetaById, positions, subgraphRawContext, subgraphStackLength } = get();
      if (!detail) {
        return null;
      }
      const rawEntry: unknown = detail.graph?.[nodeId];
      const entry =
        /* SAFETY: 类型断言已复核 */
        rawEntry && typeof rawEntry === "object" ? (rawEntry as Record<string, unknown>) : null;
      let rawNodesSource: Array<Record<string, unknown>> | null = null;
      const isSubView = subgraphStackLength > 0 && subgraphRawContext;
      if (isSubView) {
        /* SAFETY: 类型断言已复核 */
        const subs = (
          subgraphRawContext.parentRawJson as {
            definitions?: { subgraphs?: Record<string, unknown> };
          } | null
        )?.definitions?.subgraphs;
        const targetUid = subgraphRawContext.subUid;
        // 原始子图定义是无类型的服务端负载；只经一个窄形状
        // 读取查看器需要的字段（id / nodes）。
        type RawSubgraphDef = {
          id?: string;
          nodes?: Array<Record<string, unknown>>;
        };
        /* SAFETY: 类型断言已复核 */
        let subDef: RawSubgraphDef | undefined = subs?.[targetUid] as RawSubgraphDef | undefined;
        if (!subDef || !Array.isArray(subDef.nodes)) {
          const matchKey = subs
            ? Object.keys(subs).find(
                /* SAFETY: 类型断言已复核 */
                (key) => (subs[key] as RawSubgraphDef | undefined)?.id === targetUid,
              )
            : undefined;
          if (matchKey && subs) {
            /* SAFETY: 类型断言已复核 */
            subDef = subs[matchKey] as RawSubgraphDef;
          }
        }
        if (subDef && Array.isArray(subDef.nodes)) {
          rawNodesSource = subDef.nodes;
        }
      }
      if (
        !rawNodesSource &&
        typeof detail.rawJson === "object" &&
        detail.rawJson !== null &&
        /* SAFETY: 类型断言已复核 */
        Array.isArray((detail.rawJson as { nodes?: unknown }).nodes)
      ) {
        /* SAFETY: 类型断言已复核 */
        rawNodesSource = (
          detail.rawJson as {
            nodes: Array<Record<string, unknown>>;
          }
        ).nodes;
      }
      const rawNode = rawNodesSource
        ? (rawNodesSource.find((rawNode) => String(rawNode?.id) === nodeId) ?? null)
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
      set({ viewer: { anchorRect: rectToAnchorRect(rect), nodeId, kind } });
    },

    dismiss: () => {
      set({ viewer: null });
    },
  }));
}

export function useNodeJsonViewerStore<U>(selector: (s: NodeJsonViewerStore) => U): U {
  const ctx = useContext(WFStoresContext);
  if (!ctx) {
    throw new Error("useNodeJsonViewerStore 必须在 <WFStoresContext.Provider> 内使用");
  }
  return useZustandStore(ctx.viewer, selector);
}
/* 便捷访问 —— 与原 NodeJsonViewerContextValue 等价，供 NodeIdChip 等使用。 */
export function useNodeJsonViewer(): NodeJsonViewerContextValue {
  const ctx = useContext(WFStoresContext);
  if (!ctx) {
    throw new Error("useNodeJsonViewer 必须在 <WFStoresContext.Provider> 内使用");
  }
  const getNodeJson = useZustandStore(ctx.viewer, (state) => state.getNodeJson);
  const getNodeView = useZustandStore(ctx.viewer, (state) => state.getNodeView);
  const requestShow = useZustandStore(ctx.viewer, (state) => state.requestShow);
  const dismiss = useZustandStore(ctx.viewer, (state) => state.dismiss);
  const viewer = useZustandStore(ctx.viewer, (state) => state.viewer);
  return { getNodeJson, getNodeView, requestShow, dismiss, viewer };
}

/* ════════════════════════════════════════════════════════════════════════
 *  WFStoresProvider —— 由持有者（WorkflowEditorInner）在组件体内创建 3 个
 *  store 实例并一次性下发。持有者自身用 useIOEditApi()/useRgthreeApi()/
 *  useViewerApi() 直写；渲染子树经 useStore(selector) 订阅。
 * ════════════════════════════════════════════════════════════════════════ */
export function WFStoresProvider({
  stores,
  children,
}: {
  children: React.ReactNode;
  stores: WFStores;
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
  if (!viewer) {
    return null;
  }
  return (
    <NodeJsonPopover
      getJson={getNodeJson}
      getView={getNodeView}
      key={`${viewer.nodeId}-${viewer.kind}`}
      onDismiss={dismiss}
      request={viewer}
    />
  );
}
