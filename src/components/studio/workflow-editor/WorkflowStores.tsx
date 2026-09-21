"use client";
/* ════════════════════════════════════════════════════════════════════════
 *  wf-stores.ts — Zustand 状态层（替代 3 个 React Context）
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
import {
  createStore,
  useStore as useZustandStore,
  type StoreApi,
} from "zustand";
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
} from "../workflow-types";
import type { WorkflowIOModeOverride } from "~/lib/workflow/workflow-io-types";
import { rectToAnchorRect } from "~/lib/dom-rect";
import { NodeJsonPopover } from "../WorkflowNodeJsonPopover";
import { patchWorkflowSilently } from "~/lib/workflow/workflow-mutations";
import { reportStaleStoreAction } from "~/lib/shell/stale-store-notify";

/* ───────────────────────────────────────────────────────────────────────
 *  IOEdit store
 * ───────────────────────────────────────────────────────────────────────
 *  原先由 wf-editor-inner.tsx 以 useState + useCallback 声明、经
 *  即 IOEditContext.Provider 上挂 ioEditMode / workflowIO / toggleIO 等
 *  下发。现把「状态 + 动作」一起收进 store；消费方按需订阅。
 *
 *  注意：reorderIO 会 PATCH 服务端，依赖 workflowId；故工厂参数携带
 *  workflowId。其余动作（toggleIO / setIOLabel / toggleIORequired /
 *  setIOModeOverride / purgeModeOverrides）都是纯状态更新，与编辑器其它 30+
 *  个画布 state 解耦。 */
export interface IOEditState {
  ioEditMode: boolean;
  workflowIO: Record<string, WorkflowIOParam>;
  ioPreviewOpen: boolean;
  /** 本地勾选态里的作者重命名（`label`）只由 `setIOLabel` 写入；勾选 / 取消
   *  勾选不再抄画布的显示名进库，因此这里没有「既不是作者命名、又要保留」的
   *  中间态，也不需要任何机器名判定。 */
}
export interface IOEditActions {
  /** 开关 IO 编辑模式。关闭时**一并关掉 IO 预览**（见下一条的耦合说明）；
   *  打开时不动预览。 */
  setIoEditMode: (on: boolean) => void;
  /** 开关 IO 预览面板。关闭时**一并退出 IO 编辑模式**：面板已经在画面上消失，
   *  节点卡片上再留着勾选框，作者手上就只剩一个「看不到结果、只看到选择器」的
   *  半截状态。打开时**一并进入编辑模式**，让勾选框与面板同时可用。
   *
   *  两个方向都收在这里，而不是在视图层手写两处 setState —— 顶栏按钮、
   *  画布按钮都只调这一个动作，谁都不许绕过（源码级守卫见
   *  `workflow-editor-topbar-config.test.ts`）。 */
  setIoPreviewOpen: (open: boolean) => void;
  toggleIO: (ref: IoRef) => void;
  setIOLabel: (key: string, label: string) => void;
  toggleIORequired: (key: string) => void;
  /** seed 类参数的「控件后行为」（fixed / increment / decrement / random）。 */
  setIOSeedMode: (key: string, mode: string) => void;
  reorderIO: (fromKey: string, beforeKey: string | null) => void;
  /** 多模式：写入 / 清除某个参数在某一模式下的覆盖项。
   *  `patch` 为 null 表示删除该模式的覆盖（回到「通用默认值 + 默认可见」）。
   *  与 setIOLabel / toggleIORequired 同路径持久化：下一次 PATCH 整体
   *  workflowIO 时一起落库，无需改表。 */
  setIOModeOverride: (
    key: string,
    mode: string,
    patch: WorkflowIOModeOverride | null,
  ) => void;
  /** 批量摘掉所有 IO 条目上给定模式码的覆盖层（modes[mode]）。
   *  模式从工作流 `modes` 列移除后，条目里的覆盖必须跟着清掉，否则这些
   *  无主覆盖会一直跟着 workflowIO 落库往返（页签栏不再显示，纯脏数据）。
   *  返回清理后的 workflowIO 映射；没有任何覆盖命中时返回 null，调用方
   *  据此决定是否需要把清理结果落库。 */
  purgeModeOverrides: (
    codes: string[],
  ) => Record<string, WorkflowIOParam> | null;
}
export type IOEditStore = IOEditState & IOEditActions;

export function createIOEditStore(workflowId: string): StoreApi<IOEditStore> {
  return createStore<IOEditStore>((set) => ({
    ioEditMode: false,
    workflowIO: {},
    ioPreviewOpen: false,

    setIoEditMode: (on) =>
      set(
        on ? { ioEditMode: true } : { ioEditMode: false, ioPreviewOpen: false },
      ),
    setIoPreviewOpen: (open) =>
      set(
        open
          ? { ioPreviewOpen: true, ioEditMode: true }
          : { ioPreviewOpen: false, ioEditMode: false },
      ),

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

    setIOLabel: (key, label) =>
      set((state) => {
        const cur = state.workflowIO[key];
        if (!cur) return {};
        /* 清空 = 恢复默认（取消这条参数的重命名），显示名回到富化链。
         * 写什么就存什么：不再有「这个名字像机器名，所以不让存」的判定 ——
         * 作者的显式命名是唯一真相（ISSUE #349 的「改了也不行」不会再出现）。 */
        const kept = label.trim() || undefined;
        if (kept === cur.label) return {};
        return {
          workflowIO: { ...state.workflowIO, [key]: { ...cur, label: kept } },
        };
      }),

    toggleIORequired: (key) =>
      set((state) => {
        const cur = state.workflowIO[key];
        if (!cur) return {};
        /* 只有本代画布勾选写入的 widget 条目可调「必填」；param（连线端口）
         *  与 output 不可调。存储自新格式起即正确区分 kind，此处直接以
         *  kind !== "widget" 拦截即可，无需旧数据特判。 */
        if (cur.kind !== "widget") return {};
        return {
          workflowIO: {
            ...state.workflowIO,
            [key]: { ...cur, required: !cur.required },
          },
        };
      }),

    setIOModeOverride: (key, mode, patch) =>
      set((state) => {
        const cur = state.workflowIO[key];
        if (!cur || !mode) return {};
        const modes: Record<string, WorkflowIOModeOverride> = {
          ...(cur.modeOverrides ?? {}),
        };
        if (patch === null) {
          if (!(mode in modes)) return {};
          delete modes[mode];
        } else {
          modes[mode] = { ...(modes[mode] ?? {}), ...patch };
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
      }),

    purgeModeOverrides: (codes) => {
      let cleaned: Record<string, WorkflowIOParam> | null = null;
      set((state) => {
        const hit = codes.filter((code) =>
          Object.values(state.workflowIO).some(
            (entry) =>
              entry?.modeOverrides != null && code in entry.modeOverrides,
          ),
        );
        if (hit.length === 0) return {};
        const next: Record<string, WorkflowIOParam> = {};
        for (const [key, entry] of Object.entries(state.workflowIO)) {
          const modes = entry?.modeOverrides;
          if (!modes || !hit.some((code) => code in modes)) {
            next[key] = entry;
            continue;
          }
          const rest = { ...modes };
          for (const code of hit) delete rest[code];
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

    setIOSeedMode: (key, mode) =>
      set((state) => {
        const cur = state.workflowIO[key];
        if (cur?.kind !== "widget") return {};
        if (cur.seedMode === mode) return {};
        return {
          workflowIO: {
            ...state.workflowIO,
            [key]: { ...cur, seedMode: mode },
          },
        };
      }),

    /* 拖拽排序：把 `fromKey` 移动到 `beforeKey` 表示的位置。
     *
     *  契约：`beforeKey` 是**松手时鼠标所在的那一行**（`null` = 移到末尾）。
     *  「落在谁身上」有两种语义，按拖动方向选 —— 向右拖时插到目标之后，向左
     *  拖时插到目标之前。只用「插到目标之前」的话，右移一格等于原地不动
     *  （ISSUE #349：编辑 IO 里拖拽调整参数顺序失效）。 */
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
        /* 被移动行在重排前的下标 —— 判定落点「在目标之前还是之后」用。 */
        const fromIndex = ordered.findIndex(
          ({ entryKey }) => entryKey === fromKey,
        );
        const without = ordered.filter(({ entryKey }) => entryKey !== fromKey);
        let targetIdx = without.length;
        if (beforeKey) {
          const i = without.findIndex(({ entryKey }) => entryKey === beforeKey);
          if (i >= 0) {
            /* 落在目标上时插到它**前面还是后面**，看这次拖动是往前还是往后：
             *  用户向右拖（`fromIndex` 在目标之前）时目标落在原位置的下方，
             *  松手看到的落点是「目标之后」；向左拖反之。只用「插到目标之前」
             *  的话，右移一格等于原地不动 —— 用户看到的就是「拖了但顺序没变」
             *  （ISSUE #349：编辑 IO 里拖拽调整参数顺序失效）。 */
            const targetIndex = ordered.indexOf(without[i]!);
            targetIdx = fromIndex < targetIndex ? i + 1 : i;
          }
        }
        without.splice(targetIdx, 0, { entryKey: fromKey, entry: fromEntry });
        const renumbered: Record<string, WorkflowIOParam> = { ...prev };
        for (let i = 0; i < without.length; i++) {
          const { entryKey, entry } = without[i]!;
          renumbered[entryKey] = { ...entry, displayOrder: i + 1 };
        }
        /* 发往服务端（调用形状与之前一致）。 */
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
  if (!ctx)
    throw new Error("getIOEditApi 必须在 <WFStoresContext.Provider> 内使用");
  return ctx.io;
}
export function getRgthreeApi(): StoreApi<RgthreeGroupsStore> {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- 设计如此：仅在组件渲染期间调用
  const ctx = useContext(WFStoresContext);
  if (!ctx)
    throw new Error("getRgthreeApi 必须在 <WFStoresContext.Provider> 内使用");
  return ctx.rgthree;
}
export function getViewerApi(): StoreApi<NodeJsonViewerStore> {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- 设计如此：仅在组件渲染期间调用
  const ctx = useContext(WFStoresContext);
  if (!ctx)
    throw new Error("getViewerApi 必须在 <WFStoresContext.Provider> 内使用");
  return ctx.viewer;
}

/** 调用 store 实例上的一个动作，**动作缺失时降级而非抛错**。
 *
 *  背景：store 实例由 `useState(() => createIOEditStore(...))` 在挂载时创建一次，
 *  实例上的「动作集合」是那一刻从本模块取到的函数。而动作本身是本模块的成员，
 *  会随热更新（HMR）/ 重新编译整体替换。于是存在一个稳定可复现的窗口：
 *
 *    · 开发态 dev server 长开，拉了新提交后页面没重载；
 *    · 编辑器在改动前就已挂载（如桌面壳窗口一直开着）；
 *
 *  此时 `getState()` 返回的仍是**旧实例**——它带着旧的动作集合，可能缺少本模块
 *  新声明的动作。直接调用会抛 `xxx is not a function`，被
 *  `<WorkflowCanvasEditor>` 的 ErrorBoundary 接住 → 编辑器降级成错误页。
 *
 *  这里把「能力不存在」当降级处理而不是异常：跳过本次调用（下次依赖变化或
 *  页面重载后自然生效），只打一条可诊断的告警。与规范「L1 功能降级」一致 ——
 *  单个增强动作的时序问题不应让整个画布白屏。
 *
 *  传入 `action` 为可能为 undefined 的成员时才会走到告警分支，因此这条告警
 *  本身也是「实例陈旧」的信号，不是可以长期忽略的噪音（陈旧实例在新一轮
 *  重载后消失）。
 *
 *  **降级不能是静默的**（规范 10 §10.1 的 L1 + §10.3.1「降级不得静默」）：
 *  跳过调用只保住了「不白屏」，用户看到的是某个功能悄无声息不起作用。而
 *  「为什么跳过、该怎么办」在运行时是**可知**的——正是「页面跑过一段代码
 *  更新」这个事实。于是这里顺手把信号交给 `~/lib/stale-store-notify`：真出现
 *  陈旧实例时，应用内会弹一条带「重载即可恢复」指引的通知（去重与文案在
 *  那一层，本处只上报事实）。 */
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
  if (!ctx)
    throw new Error("useIOEditStore 必须在 <WFStoresContext.Provider> 内使用");
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
export type RgthreeGroupsStoreParams = {
  workflowId: string;
  detail: WorkflowDetail | null;
};

export function createRgthreeGroupsStore(
  params: RgthreeGroupsStoreParams,
): StoreApi<RgthreeGroupsStore> {
  return createStore<RgthreeGroupsStore>((set, get) => ({
    overrides: {},
    detail: params.detail,
    workflowId: params.workflowId,

    getBypass: (groupId) => {
      if (Object.prototype.hasOwnProperty.call(get().overrides, groupId)) {
        return get().overrides[groupId]!;
      }
      const g = get().detail?.groups?.find(
        (x: WorkflowGroup) => x.id === groupId,
      );
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

export function useRgthreeGroupsStore<U>(
  selector: (s: RgthreeGroupsStore) => U,
): U {
  const ctx = useContext(WFStoresContext);
  if (!ctx)
    throw new Error(
      "useRgthreeGroupsStore 必须在 <WFStoresContext.Provider> 内使用",
    );
  return useZustandStore(ctx.rgthree, selector);
}
/* 返回 getBypass/setBypass —— 与 RgthreeGroupsContextValue 等价。 */
export function useRgthreeGroups(): RgthreeGroupsContextValue {
  const ctx = useContext(WFStoresContext);
  if (!ctx)
    throw new Error(
      "useRgthreeGroups 必须在 <WFStoresContext.Provider> 内使用",
    );
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
export type NodeJsonViewerStore = NodeJsonViewerState &
  NodeJsonViewerActions &
  NodeJsonViewerLookup;
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
      if (!detail?.graph) return null;
      const entry: unknown = detail.graph[nodeId];
      return entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    },

    getNodeView: (nodeId) => {
      const {
        detail,
        rawMetaById,
        positions,
        subgraphRawContext,
        subgraphStackLength,
      } = get();
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
        let subDef: RawSubgraphDef | undefined = subs?.[targetUid] as
          RawSubgraphDef | undefined;
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
        rawNodesSource = (
          detail.rawJson as {
            nodes: Array<Record<string, unknown>>;
          }
        ).nodes;
      }
      const rawNode = rawNodesSource
        ? (rawNodesSource.find((rawNode) => String(rawNode?.id) === nodeId) ??
          null)
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

    dismiss: () => set({ viewer: null }),
  }));
}

export function useNodeJsonViewerStore<U>(
  selector: (s: NodeJsonViewerStore) => U,
): U {
  const ctx = useContext(WFStoresContext);
  if (!ctx)
    throw new Error(
      "useNodeJsonViewerStore 必须在 <WFStoresContext.Provider> 内使用",
    );
  return useZustandStore(ctx.viewer, selector);
}
/* 便捷访问 —— 与原 NodeJsonViewerContextValue 等价，供 NodeIdChip 等使用。 */
export function useNodeJsonViewer(): NodeJsonViewerContextValue {
  const ctx = useContext(WFStoresContext);
  if (!ctx)
    throw new Error(
      "useNodeJsonViewer 必须在 <WFStoresContext.Provider> 内使用",
    );
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

function NodeJsonViewerPortal({
  store,
}: {
  store: StoreApi<NodeJsonViewerStore>;
}) {
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
