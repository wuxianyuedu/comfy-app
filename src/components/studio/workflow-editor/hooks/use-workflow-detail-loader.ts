"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { vanillaApi } from "~/trpc/vanilla";
import type {
  WorkflowDetail,
  WorkflowIOParam,
} from "~/components/studio/workflow-types";

/** tRPC 查询返回的工作流详情载荷：在 WorkflowDetail 基础上，失败分支会带上
 *  `error` 字段（成功时缺省）。用它对全文件散落的 `(x as any)` 做类型收窄，
 *  满足禁止 any 的约束，同时保留失败态的错误读取。 */
type WorkflowDetailResponse = WorkflowDetail & { error?: string };

interface WorkflowSubgraphStackEntry {
  uid: string;
  name: string;
  nodeId: string;
}

interface CacheEnvelope {
  t: number;
  d: WorkflowDetail;
}

/* 缓存 schema 版本后缀。每当 workflow.detailFull / subgraph 响应结构变化时就
 *  提升此后缀，使旧的 sessionStorage 条目失效（每次 fetch 都会 purge 旧命名空间，
 *  见 purgeStaleCache）。改动响应字段时只改这里一处，比散落的版本号更难漏。 */
const CACHE_KEY_PREFIX = "wfdetail:R7:subgraphHostNamespaced:";
const CACHE_TTL_MS = 30_000;

/** 清掉所有非当前命名空间的 wfdetail:* 键，防止旧版本键残留被误命中。best-effort。 */
function purgeStaleCache(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("wfdetail:") && !k?.startsWith(CACHE_KEY_PREFIX)) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {
    /* sessionStorage 可能被禁用（隐私模式），静默跳过 */
  }
}

/** 强制重载时清掉本应用命名空间下的全部缓存键（不再清整个 origin 的 storage）。 */
function clearWorkflowCache(): void {
  try {
    const keys: string[] = [];
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("wfdetail:")) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* sessionStorage 可能被禁用（隐私模式），静默跳过 */
  }
}

function readCache(key: string): WorkflowDetail | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw) as CacheEnvelope;
    return Date.now() - obj.t < CACHE_TTL_MS ? obj.d : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: WorkflowDetail): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data }));
  } catch {
    /* 配额超限，忽略 */
  }
}

/** tRPC vanilla client 不支持直接传 signal，用 Promise.race 在超时后抛错，
 *  避免后端长时间不返回时加载覆盖层无限转圈。底层请求超时后仍可能最终返回，
 *  但竞态守卫 + 错误提示保证 UI 不会卡死。定时器在收尾时清理，避免泄漏。 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}加载超时（${ms / 1000}s），请重试`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface WorkflowDetailLoaderArgs {
  workflowId: string;
  detail: WorkflowDetail | null;
  detailRef: RefObject<WorkflowDetail | null>;
  latestRequestIdRef: RefObject<number>;
  setDetail: Dispatch<SetStateAction<WorkflowDetail | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setParamMap: Dispatch<SetStateAction<Record<string, unknown>>>;
  setWorkflowIO: (
    updater:
      | Record<string, WorkflowIOParam>
      | ((
          prev: Record<string, WorkflowIOParam>,
        ) => Record<string, WorkflowIOParam>),
  ) => void;
  setSubgraphStack: Dispatch<SetStateAction<WorkflowSubgraphStackEntry[]>>;
  setRootWorkflowName: Dispatch<SetStateAction<string>>;
  setSubgraphLoading: Dispatch<SetStateAction<boolean>>;
  setSubgraphRawContext: Dispatch<
    SetStateAction<{ parentRawJson: unknown; subUid: string } | null>
  >;
  /** 非致命的下钻错误：保持**父**图可见（不闪一下工作流库）。 */
  setSubgraphError: Dispatch<SetStateAction<string>>;
}

/**
 * 持有工作流详情加载 + 子图下钻/返回导航的逻辑。
 */
export function useWorkflowDetailLoader({
  workflowId,
  detail,
  detailRef,
  latestRequestIdRef,
  setDetail,
  setLoading,
  setError,
  setParamMap,
  setWorkflowIO,
  setSubgraphStack,
  setRootWorkflowName,
  setSubgraphLoading,
  setSubgraphRawContext,
  setSubgraphError,
}: WorkflowDetailLoaderArgs) {
  /* 子图栈的镜像引用：用于在 state updater 之外读取最新值（避免在 updater 里
   *  排副作用 —— React StrictMode 会双调用 updater，导致重复发请求）。所有栈
   *  变更都走 updateStack，保证镜像与 state 同步。 */
  const stackRef = useRef<WorkflowSubgraphStackEntry[]>([]);
  const updateStack = useCallback(
    (
      updater:
        | WorkflowSubgraphStackEntry[]
        | ((
            prev: WorkflowSubgraphStackEntry[],
          ) => WorkflowSubgraphStackEntry[]),
    ) => {
      setSubgraphStack((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        stackRef.current = next;
        return next;
      });
    },
    [setSubgraphStack],
  );

  /* 调用方传入的是「已经拼接好的宿主链」（如顶层 "4"、嵌套子图 "4:5"，
   *  与 comfy-cli 展开后的节点 id 口径一致）。这里只负责追加，切勿再把 prev
   *  拼到前面，否则嵌套层会双重前缀、坐标全部退回原始值。 */
  const pushSubgraphStack = useCallback(
    (uid: string, name: string, nodeId: string) => {
      updateStack((prev) => [...prev, { uid, name, nodeId }]);
    },
    [updateStack],
  );

  /* 只更新 detail / paramMap / workflowIO / 顶层根名，不碰子图栈。
   *  后台刷新与冷路径共用，避免重复的 set-state 块。 */
  const applyDetailState = useCallback(
    (data: WorkflowDetail, isSubgraph: boolean) => {
      setDetail(data);
      setParamMap(data.paramMap ?? {});
      setWorkflowIO(data.workflowIO ?? {});
      if (!isSubgraph) {
        setRootWorkflowName((prev) => prev ?? data.name ?? "");
      }
    },
    [setDetail, setParamMap, setWorkflowIO, setRootWorkflowName],
  );

  /* 在 applyDetailState 基础上，下钻分支把新层级压入子图栈。 */
  const commitDetail = useCallback(
    (
      data: WorkflowDetail,
      isSubgraph: boolean,
      o?: { subgraphUid?: string; parentTitle?: string; hostNodeId?: string },
    ) => {
      applyDetailState(data, isSubgraph);
      if (isSubgraph && o?.subgraphUid) {
        pushSubgraphStack(
          o.subgraphUid,
          o.parentTitle ?? data.name ?? "子工作流",
          o.hostNodeId ?? "",
        );
      }
    },
    [applyDetailState, pushSubgraphStack],
  );

  const fetchDetail = useCallback(
    async (opts?: {
      subgraphUid?: string;
      parentTitle?: string;
      bust?: boolean;
      hostNodeId?: string;
    }) => {
      const subgraphUid = opts?.subgraphUid;
      const isSubgraph = Boolean(subgraphUid);
      const hostId = opts?.hostNodeId ?? "";
      const url = subgraphUid
        ? `/api/workflows/${workflowId}/subgraph?uid=${encodeURIComponent(subgraphUid)}${
            hostId ? `&host=${encodeURIComponent(hostId)}` : ""
          }`
        : `/api/workflows/${workflowId}`;
      /* hostId 是累积的「宿主:内部」链。拼进 URL 后：① 嵌套子图坐标按该前缀
       *  读回（否则拖过的位置退回原始坐标）；② 缓存键按层级命名，同名子图不串用。 */
      const cacheKey = CACHE_KEY_PREFIX + url;

      /* subgraphRawContext 让 SourceModal 从父 rawJson 切出子图自己的 LiteGraph
       *  json 当 RAW 渲染。用 detailRef（非闭包里的 detail）避免 stale；
       *  同一 subUid 重复调用不要覆盖已捕获的父 rawJson，防止 race 把正确的洗掉。
       *  顶层 detail 则清空，回到「SourceModal 读 detail.rawJson」常规路径。 */
      if (subgraphUid) {
        setSubgraphRawContext((prev) =>
          prev?.subUid === subgraphUid
            ? prev
            : {
                parentRawJson: detailRef.current?.rawJson ?? null,
                subUid: subgraphUid,
              },
        );
      } else {
        setSubgraphRawContext(null);
      }

      purgeStaleCache();

      /* 竞态令牌：同一 URL 仅最新一次 fetchDetail 允许提交 setDetail，解决
       *  「后台刷新返回新数据但 UI 仍显示旧缓存」的问题（两条路径统一走这里）。 */
      const myReqId = ++latestRequestIdRef.current;
      const cached = readCache(cacheKey);

      if (cached) {
        if (myReqId === latestRequestIdRef.current) {
          commitDetail(cached, isSubgraph, opts);
          setLoading(false);
          setSubgraphLoading(false);
        }
        /* 后台刷新：即使命中缓存也发一次网络请求，赢了竞态就提交（比缓存更新）。
         *  不触碰子图栈。 */
        const bg = subgraphUid
          ? vanillaApi.workflow.subgraph.query({
              id: workflowId,
              uid: subgraphUid,
              hostId,
            })
          : vanillaApi.workflow.detailFull.query({ id: workflowId });
        void bg
          .then((data: WorkflowDetailResponse | null) => {
            if (!data || data.error) return;
            writeCache(cacheKey, data);
            if (myReqId === latestRequestIdRef.current) {
              applyDetailState(data, isSubgraph);
            }
          })
          .catch((e) => console.warn("[we] 后台刷新详情失败", e));
        return;
      }

      /* 冷路径：走 tRPC（POST，绕过 HTTP 缓存）。 */
      if (!detail) setLoading(true);
      try {
        const d = (await withTimeout(
          subgraphUid
            ? vanillaApi.workflow.subgraph.query({
                id: workflowId,
                uid: subgraphUid,
                hostId,
              })
            : vanillaApi.workflow.detailFull.query({
                id: workflowId,
                bust: opts?.bust ? true : undefined,
              }),
          60_000,
          subgraphUid ? "子工作流" : "工作流",
        )) as WorkflowDetailResponse;
        if (d.error) throw new Error(d.error);
        writeCache(cacheKey, d);
        if (myReqId === latestRequestIdRef.current)
          commitDetail(d, isSubgraph, opts);
      } catch (e: unknown) {
        /* 子图下钻失败：非致命 —— 保留父图，仅用内联错误提示，绝不渲染「返回」
         *  错误屏（那会回退到工作流库界面）。e 为 unknown：先 instanceof Error
         *  收窄再取 message，否则回退到约定文案。 */
        const msg =
          (e instanceof Error ? e.message : "") ||
          (isSubgraph ? "子工作流加载失败" : "加载失败");
        if (isSubgraph) setSubgraphError(msg);
        else setError(msg);
      } finally {
        if (myReqId === latestRequestIdRef.current) {
          setLoading(false);
          setSubgraphLoading(false);
        }
      }
    },
    [
      workflowId,
      commitDetail,
      applyDetailState,
      detail,
      detailRef,
      latestRequestIdRef,
      setSubgraphRawContext,
      setLoading,
      setSubgraphLoading,
      setSubgraphError,
      setError,
    ],
  );

  /* 顶栏强制重载按钮触发的入口：清本应用缓存命名空间 + 让任何 in-flight fetch
   *  作废，再以 bust 重新拉（服务器 LRU 也被穿透）。 */
  const forceReloadDetail = useCallback(
    (
      hostNodeId = "",
      /** 静默模式：不把编辑器打成 loading、不清空当前 detail。用于「重置布局」
       *  这类主动重拉——新数据到了自然会替换，画布不该整屏闪一下 loading。 */
      silent = false,
    ) => {
      clearWorkflowCache();
      latestRequestIdRef.current++;
      setError("");
      if (!silent) {
        setDetail(null);
        setLoading(true);
        setSubgraphLoading(false);
      }
      void fetchDetail({ bust: true, hostNodeId });
    },
    [
      fetchDetail,
      latestRequestIdRef,
      setError,
      setDetail,
      setLoading,
      setSubgraphLoading,
    ],
  );

  useEffect(() => {
    /* 编辑器实例被复用到另一个 workflow 时重置面包屑状态，避免旧根名 / 子图栈
     *  在新 fetch 落地前短暂闪现。 */
    updateStack([]);
    setRootWorkflowName("");
    setDetail(null);
    setError("");
    void fetchDetail();
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 进入子图：先同步亮出 loading 覆盖层，再用 setTimeout 把新 detail 推到下一个
   *  macrotask，让 React 18 先提交覆盖层再替换 detail。点击展开直接跳进子图。 */
  const onEnterSubgraph = useCallback(
    (
      nodeId: string,
      uid: string,
      parentTitle: string,
      /** 上一层的宿主链（顶层下钻为空串）。嵌套子图拼成 `4:5`，与拖拽落库用的
       *  runtimeNodeId 口径一致。 */
      parentHostId = "",
    ) => {
      /* IO 编辑态跨层保留：子图本身没有独立 IO 契约，但父工作流的对外参数可能落在
       *  子图内部节点上（`LoadImage.image` / `PrimitiveInt.value`…）。下钻后仍可
       *  勾选，作者才能把内部参数接进父工作流对外参数；勾选时画布带上宿主节点 id，
       *  运行期据此把内部节点 id 还原成 comfy-cli 展开后的 `宿主id:内部id`。 */
      setSubgraphError("");
      setSubgraphLoading(true);
      const hostChain = [parentHostId, nodeId].filter(Boolean).join(":");
      setTimeout(() => {
        void fetchDetail({
          subgraphUid: uid,
          parentTitle,
          hostNodeId: hostChain,
        });
      }, 0);
    },
    [fetchDetail, setSubgraphError, setSubgraphLoading],
  );

  /* 退出一层子图：回退子图栈并重拉对应层级。回退逻辑在 updater 之外做，
   *  避免 StrictMode 双调用 updater 时重复发请求。 */
  const onExitSubgraph = useCallback(async () => {
    setSubgraphLoading(true);
    const current = stackRef.current;
    if (current.length === 0) return;
    const next = current.slice(0, -1);
    updateStack(next);
    if (next.length === 0) {
      setTimeout(() => {
        void fetchDetail();
      }, 0);
    } else {
      const parent = next[next.length - 1]!;
      /* 回到上一层同样带上它自己的宿主链：上一层若是子图内部视图，坐标也存成
       *  `宿主:内部`，不带前缀会退回原始坐标。 */
      setTimeout(() => {
        void fetchDetail({
          subgraphUid: parent.uid,
          parentTitle: parent.name,
          hostNodeId: parent.nodeId,
        });
      }, 0);
    }
  }, [fetchDetail, updateStack, setSubgraphLoading]);

  return {
    pushSubgraphStack,
    fetchDetail,
    forceReloadDetail,
    onEnterSubgraph,
    onExitSubgraph,
  };
}
