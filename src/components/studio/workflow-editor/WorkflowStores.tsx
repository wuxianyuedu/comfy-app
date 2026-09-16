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
import { HOMONYM_LABEL_SUFFIX, isMachineName, type ExposedAliasBase } from "./io-exposure";
import { rectToAnchor } from "../workflow-utils";
import { NodeJsonPopover } from "../WorkflowNodeJsonPopover";
import { patchWorkflowSilently } from "@/lib/workflow-mutations";
import { reportStaleStoreAction } from "@/lib/stale-store-notify";

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
  /** 富化下发的「真实 pin 名 / 作者名」事实源（ioKey → 该 pin 现在的事实）。
   *
   *  用它判定本地条目里存的名字是不是一串机器生成的 pin 名 —— 判定要有
   *  参照物（真实 pin 名 + 富化名 + 本层作者名），而这个参照物只能来自富化：
   *  本地条目的 `name` 在加载时已被解析成显示名，拿它自己比等于没比。
   *  它**不是**「我们写过脏值的键表」：写入前靠它实时判定，所以取消勾选再
   *  勾选、或上一次会话留下的脏值，都会被同一套判据挡下（ISSUE #349）。
   *  空表 = 富化还没到，此时不做清理（宁可留旧值也不误删作者命名）。 */
  aliasBaseByKey: Record<string, ExposedAliasBase>;
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
  /** 就地摘掉「label 明显是机器 pin 名」的条目上的 label（ISSUE #349）。
   *
   *  与写入路径同一条判据，只是发生在富化到达之后的本地态上：本地 store 里
   *  躺的是回读时那份带脏 label 的条目，任何一次整体写回都会把它当作者命名
   *  固化回库，显示名随即退回 `value_1`。取消勾选再勾选、下钻再回来这类
   *  「重新加载」路径同样会复活它，因此判定必须在数据上实时做，而不是靠
   *  「记得哪个键写过脏值」。
   *
   *  `isMachine` 由调用方注入（它持有富化事实源），返回 true 的条目会被摘掉
   *  label、回到「未重命名」语义；没有任何命中时不产生新状态引用。 */
  purgeMachineNames: (
    isMachine: (key: string, entry: WorkflowIOParam) => boolean
  ) => void;
}
export type IOEditStore = IOEditState & IOEditActions;

export function createIOEditStore(workflowId: string): StoreApi<IOEditStore> {
  return createStore<IOEditStore>((set, get) => ({
    ioEditMode: false,
    workflowIO: {},
    ioPreviewOpen: false,
    aliasBaseByKey: {},

    setIoEditMode: (on) =>
      set(on ? { ioEditMode: true } : { ioEditMode: false, ioPreviewOpen: false }),
    setIoPreviewOpen: (open) =>
      set(open ? { ioPreviewOpen: true, ioEditMode: true } : { ioPreviewOpen: false, ioEditMode: false }),

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
              prev[key]?.slotLabel === next[key]?.slotLabel &&
              prev[key]?.classType === next[key]?.classType
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
        /* 落库前先把「机器名」挡掉（ISSUE #349）。
         *
         * 勾选那一刻画布透传的是显示名，而修复前某些路径透传的就是原始 pin 名
         * （封装节点别名 `value_1`、普通节点 pin 名 `image`）。它一旦进了
         * `label` 就是条「作者命名」，显示层让位也只能让到下一次写入为止。
         * 这里在入口处判一次：明显是机器名就**不写 label**，条目回到「未命名」
         * 语义，显示名继续由富化链提供；取消勾选后再勾选也不会复活。 */
        const aliases = state.aliasBaseByKey[key];
        const machineName = isMachineName(ref.label, {
          name: ref.name,
          enrichedLabel: aliases?.enrichedLabel,
          ...(aliases?.slotLabel ? { slotLabel: aliases.slotLabel } : {}),
          ...(aliases?.classType ? { classType: aliases.classType } : {}),
        });
        return {
          workflowIO: {
            ...state.workflowIO,
            [key]: {
              direction: ref.direction,
              kind: ref.kind,
              nodeId: ref.nodeId,
              name: ref.name,
              ...(ref.label && !machineName ? { label: ref.label } : {}),
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
        /* 清空 = 恢复默认（取消这条参数的重命名）。 */
        if (!next) return { workflowIO: { ...state.workflowIO, [key]: { ...cur, label: undefined } } };
        /* 手写的名字恰好与机器 pin 名逐字相同时加后缀保留。
         *
         * 这类名字（`LoadImage.image`、`seed`）是最容易被认成机器名的形态，
         * 直接写下去会被后续显示 / 写入判定当成脏值清掉 —— 作者看到的是
         * 「改了也不行」。加一个后缀就与机器名区分开了，作者的名字被保住
         * （ISSUE #349：改名的入口必须真的改得动）。 */
        const aliases = state.aliasBaseByKey[key];
        const pinName = cur.name;
        const sameAsMachine =
          next === pinName ||
          (aliases?.name !== undefined && next === aliases.name);
        const kept = sameAsMachine ? `${next}${HOMONYM_LABEL_SUFFIX}` : next;
        if (kept === cur.label) return {};
        return { workflowIO: { ...state.workflowIO, [key]: { ...cur, label: kept } } };
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
         *  第二判据。缺任一项时只按手头的信息判，不对就一律不动。 */
        const staleAlias =
          cur.label !== undefined &&
          isMachineName(cur.label, {
            name: cur.name,
            ...(aliases?.enrichedLabel !== undefined
              ? { enrichedLabel: aliases.enrichedLabel }
              : {}),
            ...(aliases?.slotLabel !== undefined ? { slotLabel: aliases.slotLabel } : {}),
            /* 宿主类名让「槽位名本身就是别名」这一条在没有作者名可回收时
             *  也能成立（ISSUE #349：切 seed 行为后名字退回 value_1）。 */
            ...(aliases?.classType !== undefined ? { classType: aliases.classType } : {}),
          });
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

    purgeMachineNames: (isMachine) =>
      set((state) => {
        let changed = false;
        const next: Record<string, WorkflowIOParam> = {};
        for (const [key, entry] of Object.entries(state.workflowIO)) {
          const label = entry?.label;
          if (!entry || label === undefined || !isMachine(key, entry)) {
            next[key] = entry;
            continue;
          }
          next[key] = { ...entry, label: undefined };
          changed = true;
        }
        return changed ? { workflowIO: next } : {};
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
        const fromIndex = ordered.findIndex(({ entryKey }) => entryKey === fromKey);
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

/** 调用 store 实例上的一个动作，**动作缺失时降级而非抛错**。
 *
 *  背景：store 实例由 `useState(() => createIOEditStore(...))` 在挂载时创建一次，
 *  实例上的「动作集合」是那一刻从本模块取到的函数。而动作本身是本模块的成员，
 *  会随热更新（HMR）/ 重新编译整体替换。于是存在一个稳定可复现的窗口：
 *
 *    · 开发态 dev server 长开，拉了新提交后页面没重载；
 *    · 编辑器在改动前就已挂载（如 `start-tauri.exe` 起的窗口一直开着）；
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
  call: (state: S) => void
): boolean {
  const state = store.getState();
  if (typeof state[action] !== "function") {
    console.warn(
      `[wf-stores] 动作 ${action} 在当前 store 实例上不存在，已跳过本次调用` +
        `（多为热更新后未重载的陈旧实例，重载页面即恢复）`
    );
    reportStaleStoreAction("missing-store-action");
    return false;
  }
  call(state);
  return true;
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