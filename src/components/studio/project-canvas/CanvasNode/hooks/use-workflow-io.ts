"use client";

/* extracted from CanvasNode — workflow-node IO lifecycle.
 *  Owns the shared wfList/modelTagLib fetching (with module-level in-flight
 *  dedup), the selected workflow's dynamic IO map + modes loading, the
 *  ioKey render-phase reset, the default-value seeding effect and the
 *  filter-invalidation effect. The node data object and `patch` are threaded
 *  in explicitly from the parent. */
import { useEffect, useRef, useState } from "react";
import {
  reconcileInputValues,
  type WorkflowIOMap,
} from "@/components/studio/shared/workflow-io";
import { parseModesJson } from "@/lib/workflow-types";
import {
  type WorkflowModesState,
  type WorkflowSourceFilter,
} from "@/components/studio/project-canvas/WorkflowNode";
import { type CanvasNodeData } from "@/lib/project-canvas/canvas-types";
import { vanillaApi } from "~/trpc/vanilla";

/* ── 跨节点共享的列表请求去重(模块级 in-flight;审查)──
 *  画布上 N 个 workflow/image/video/picture 节点挂载时共享同一份
 *  workflow.list + workflowModel.list,并发挂载只发 2 次请求。
 *  刻意不做 TTL 缓存:新建工作流后,后挂载的节点必须看到最新列表。 */
type WfListItem = { id: string; name: string; taskType?: string; sourcePath?: string | null; modelTags?: string[] };
type TagLibItem = { id: string; name: string; count: number };
let sharedListsInflight: Promise<{ wfList: WfListItem[]; modelTagLib: TagLibItem[] }> | null = null;

export interface UseWorkflowIoArgs {
  d: CanvasNodeData;
  patch: (p: Partial<CanvasNodeData>) => void;
}

export function useWorkflowIo({ d, patch }: UseWorkflowIoArgs) {
  /* ── uploaded workflows list (for the workflow node) ── */
  /* include `sourcePath` so the dropdown can distinguish
   *  local-on-disk imports from user-uploaded online workflows (the dot +
   *  "本机 / 在线" badge in the option label).  The DB select already
   *  exposes it; only the client type was missing. */
  const [wfList, setWfList] = useState<WfListItem[]>([]);
  // True until the workflow list has finished loading. The dropdown must
  // NOT render "暂无工作流" (empty) while the list is still in flight.
  const [wfListLoading, setWfListLoading] = useState(true);
  // 用户级模型标签库（全局），供 WorkflowNode 的模型筛选 chip 使用
  const [modelTagLib, setModelTagLib] = useState<TagLibItem[]>([]);
  // 画布节点内的会话级模型筛选（不写 patch，仅当前节点 lifespan 生效）
  const [modelFilter, setModelFilter] = useState<string>("all");
  useEffect(() => {
    if (d.kind !== "workflow" && d.kind !== "image" && d.kind !== "video" && d.kind !== "picture") return;
    /* 审查修复:跨节点共享列表去重。画布上 N 个 image/workflow 节点
     *  挂载时会各自拉 workflow.list + workflowModel.list(2N 次相同请求)——
     *  模块级 in-flight 去重让并发挂载只发 2 次,且不做 TTL 缓存(不会把
     *  新建工作流的变更挡在过期列表外)。 */
    let alive = true;
    const apply = (data: { wfList: WfListItem[]; modelTagLib: TagLibItem[] }) => {
      if (!alive) return;
      setWfList(data.wfList);
      setModelTagLib(data.modelTagLib);
      setWfListLoading(false);
    };
    if (sharedListsInflight) {
      sharedListsInflight.then(apply).catch(() => {
        if (alive) setWfListLoading(false);
      });
    } else {
      const p = (async () => {
        const data: { wfList: WfListItem[]; modelTagLib: TagLibItem[] } = {
          wfList: [],
          modelTagLib: [],
        };
        const [wfRes, tagRes] = await Promise.allSettled([
          vanillaApi.workflow.list.query({}),
          vanillaApi.workflowModel.list.query(),
        ]);
        if (wfRes.status === "fulfilled") data.wfList = wfRes.value.workflows ?? [];
        if (tagRes.status === "fulfilled" && tagRes.value && Array.isArray(tagRes.value.tags))
          data.modelTagLib = tagRes.value.tags;
        return data;
      })();
      sharedListsInflight = p;
      p.then((data) => {
        apply(data);
      }).catch(() => {
        if (alive) setWfListLoading(false);
      });
      void p.finally(() => {
        sharedListsInflight = null;
      });
    }
    return () => {
      alive = false;
    };
  }, [d.kind]);

  /* ── dynamic IO map for the selected workflow (drives the form) ── */
  const [wfIO, setWfIO] = useState<WorkflowIOMap | null>(null);
  const [wfIOLoading, setWfIOLoading] = useState(false);
  /* alongside wfIO, also keep the workflow's
   *  multi-mode config (modes[] + defaultMode) so chip3 can render
   *  按该工作流配置的动态模式列表. */
  const [wfModes, setWfModes] = useState<WorkflowModesState | null>(null);
  /* 对外参数 → 节点端口的连线（作者在工作流库里配的映射，落在 paramMap.source）。
   * 运行期据此决定「哪个端口收用户值」，未连线的对外参数仍走默认值兜底。 */
  const [wfParamMap, setWfParamMap] = useState<Record<string, unknown> | null>(null);
  /* 会话级「本机 / 在线 / 全部」来源筛选 — 只在画布节点组件
   *  内部 React state 持有，不写 patch（不污染 d，避免 React Flow 重渲）。
   *  默认「全部」，用户切换后只在当前节点 lifespan 内生效。 */
  const [sourceFilter, setSourceFilter] = useState<WorkflowSourceFilter>("all");
  /* Reset IO state when the node's workflow binding changes (adjusted during
   * render, React 19 pattern — keeps the effect body setState-free). */
  const ioKey = `${d.kind}|${d.workflowId ?? ""}`;
  const [prevIoKey, setPrevIoKey] = useState(ioKey);
  if (ioKey !== prevIoKey) {
    setPrevIoKey(ioKey);
    setWfIO(null);
    setWfModes(null);
    setWfParamMap(null);
    setWfIOLoading(false);
  }
  useEffect(() => {
    if ((d.kind !== "workflow" && d.kind !== "image" && d.kind !== "video" && d.kind !== "picture") || !d.workflowId) return;
    let alive = true;
    const t = setTimeout(() => {
      if (!d.workflowId) return;
      setWfIOLoading(true);
      /* `detailFull` 而非 `detail`：运行期表单与画布节点同样要的是**富化后**的
       *  workflowIO（type / defaultValue / label / nodeTitle / classType 都由
       *  服务端按 raw_inputs 回查补齐）。`detail` 直读 DB 原始列 —— 那里面只有
       *  勾选那一刻写入的四个身份字段，type 缺失会让控件退化成单行文本框，
       *  显示名也停留在机器名（ISSUE #349：编辑器里叫「尾帧图」，运行期还是
       *  `image`）。两条链路必须吃同一份富化结果，否则又是「改了看着没生效」。 */
      void vanillaApi.workflow.detailFull
        .query({ id: d.workflowId })
        .then((tpl) => {
          if (!alive || !tpl) return;
          setWfIO(tpl.workflowIO ?? null);
          const paramMap = (tpl.paramMap as Record<string, unknown>) ?? null;
          setWfParamMap(paramMap);
          /* 一并写进节点数据：运行期（use-generate）不能依赖 hook 的异步
           *  状态，映射必须随节点一起持久化，否则刷新后运行会丢掉手工线。 */
          patch({ paramMap: paramMap ?? undefined });
          /* 模式一致性：库卡片对 `taskType` 有 fallback（仅写
           *  taskType 没声明 modes[] 的旧工作流也能展示单模式 chip），画布
           *  也走完全相同的 fallback 避免「库显示文生图 / 画布显示未选」
           *  的不一致。优先级：
           *   1) DB 的 modes[] + defaultMode（用户通过 MultiModeSelect 声明的）
           *   2) taskType 单模式兜底（向后兼容 之前的旧工作流）
           *   3) 都为空才走「未选 + 该工作流没有声明可用模式」 */
          const dbModes = parseModesJson(tpl.modes);
          const dbDefault = typeof tpl.defaultMode === "string" ? tpl.defaultMode : null;
          const inferredMode =
            typeof tpl.taskType === "string" && tpl.taskType ? tpl.taskType : null;
          const modes = dbModes.length > 0
            ? dbModes
            : inferredMode
              ? [inferredMode]
              : [];
          const defaultMode =
            dbDefault && modes.includes(dbDefault)
              ? dbDefault
              : modes[0] ?? null;
          setWfModes({ modes, defaultMode });
        })
        .catch(() => {
          if (alive) setWfIO(null);
        })
        .finally(() => {
          if (alive) setWfIOLoading(false);
        });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    /* patch 是把映射写回节点的唯一通道；它由 CanvasNode 的 useCallback(id,
     * setNodes) 定义，本 hook 里只需在 workflow 变化时用一次，故显式忽略其
     * 依赖（与下方 seededFor / 筛选 effect 同口径）。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.kind, d.workflowId]);

  /* Seed the dynamic form with the workflow's default values once IO loads, so
   * the form is fully populated (not blank) and the generate payload carries
   * every exposed pin's current value. Re-seeds only when the workflow changes. */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if ((d.kind !== "workflow" && d.kind !== "image" && d.kind !== "video" && d.kind !== "picture") || !wfIO) return;
    if (seededFor.current === d.workflowId) return;
    seededFor.current = d.workflowId ?? null;
    const reconciled = reconcileInputValues(wfIO, d.workflowInputs ?? {});
    patch({ workflowInputs: reconciled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wfIO, d.kind, d.workflowId]);

  /* Issue 1: 当「模型标签 / 来源」筛选变化导致当前已选
   *  工作流掉出过滤列表时，把参数清空回节点初始态（与显式换工作流语义一致）。
   *  复用 WorkflowNode 同款过滤谓词（sourceFilter + modelFilter）。wfList 为空
   *  视为「仍在加载」而非「被过滤」，避免挂载瞬间误清空已选工作流。 */
  useEffect(() => {
    if ((d.kind !== "workflow" && d.kind !== "picture") || !d.workflowId) return;
    if (wfList.length === 0) return;
    // Defer out of the effect body (React 19 rule: no setState synchronously
    // within an effect).
    const t = setTimeout(() => {
      const stillVisible = wfList
        .filter((workflow) => {
          if (sourceFilter === "all") return true;
          if (sourceFilter === "local") return Boolean(workflow.sourcePath);
          return !workflow.sourcePath;
        })
        .filter((workflow) => {
          if (modelFilter === "all") return true;
          return (workflow.modelTags ?? []).includes(modelFilter);
        })
        .some((workflow) => workflow.id === d.workflowId);
      if (!stillVisible) {
        seededFor.current = null;
        setWfModes(null);
        patch({
          workflowId: undefined,
          workflowName: undefined,
          workflowTaskType: undefined,
          workflowInputs: {},
          paramMap: undefined,
          workflowSinkId: undefined,
        });
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelFilter, sourceFilter, wfList, d.kind, d.workflowId]);

  return {
    wfList,
    wfListLoading,
    modelTagLib,
    modelFilter,
    setModelFilter,
    wfIO,
    wfIOLoading,
    wfParamMap,
    wfModes,
    setWfModes,
    sourceFilter,
    setSourceFilter,
    seededFor,
  };
}
