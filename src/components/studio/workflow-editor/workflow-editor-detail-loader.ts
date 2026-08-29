"use client";

import { useCallback, useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { vanillaApi } from "~/trpc/vanilla";
import type { WorkflowDetail, WorkflowIOParam } from "../workflow-types";

/** tRPC 查询返回的工作流详情载荷：在 WorkflowDetail 基础上，失败分支会带上
 *  `error` 字段（成功时缺省）。用它对全文件散落的 `(x as any)` 做类型收窄，
 *  满足 §4.1 禁止 any 的约束，同时保留失败态的错误读取。 */
type WorkflowDetailResponse = WorkflowDetail & { error?: string };

/** 冷路径请求超时兜底：tRPC vanilla client 不支持直接传 signal，用
 *  Promise.race 在超时后抛错，避免后端长时间不返回时加载覆盖层无限
 *  转圈（用户侧表现为"点展开后一直没恢复"）。底层请求超时后仍可能
 *  最终返回，但 myReqId 守卫 + 错误提示保证 UI 不会卡死。 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label}加载超时（${ms / 1000}s），请重试`)), ms);
    }),
  ]);
}

export interface WorkflowDetailLoaderArgs {
  workflowId: string;
  detail: WorkflowDetail | null;
  detailRef: RefObject<WorkflowDetail | null>;
  latestRequestIdRef: RefObject<number>;
  setDetail: Dispatch<SetStateAction<WorkflowDetail | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setParamMap: Dispatch<SetStateAction<Record<string, string>>>;
  setWorkflowIO: (
    updater:
      | Record<string, WorkflowIOParam>
      | ((prev: Record<string, WorkflowIOParam>) => Record<string, WorkflowIOParam>)
  ) => void;
  setIoEditMode: (v: boolean | ((prev: boolean) => boolean)) => void;
  setIoPreviewOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSubgraphStack: Dispatch<SetStateAction<{ uid: string; name: string }[]>>;
  setRootWorkflowName: Dispatch<SetStateAction<string>>;
  setSubgraphLoading: Dispatch<SetStateAction<boolean>>;
  setSubgraphRawContext: Dispatch<SetStateAction<{ parentRawJson: unknown; subUid: string } | null>>;
  /** Non-fatal drill-in error: keeps the PARENT graph visible (no library flash). */
  setSubgraphError: Dispatch<SetStateAction<string>>;
}

/**
 * Owns the workflow-detail loading + subgraph drill-in/out navigation for
 * the workflow editor.  Extracted from wf-editor-inner.tsx (P4 split).
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
  setIoEditMode,
  setIoPreviewOpen,
  setSubgraphStack,
  setRootWorkflowName,
  setSubgraphLoading,
  setSubgraphRawContext,
  setSubgraphError,
}: WorkflowDetailLoaderArgs) {
  const pushSubgraphStack = useCallback(
    (uid: string, name: string) => {
      setSubgraphStack((prev) => [...prev, { uid, name }]);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const fetchDetail = useCallback(
    async (opts?: { subgraphUid?: string; parentTitle?: string; bust?: boolean }) => {
      const url = opts?.subgraphUid
        ? `/api/workflows/${workflowId}/subgraph?uid=${encodeURIComponent(opts.subgraphUid)}`
        : `/api/workflows/${workflowId}`;

      // 2026-08-11 R42: 维护 subgraphRawContext
      //  - drill-in (subgraphUid 有值): 缓存父 rawJson + sub uid, 供
      //    SourceModal 在 sub 视图下从父 rawJson.definitions.subgraphs[uid]
      //    切出 sub 自己的 LiteGraph json 当 RAW 渲染。
      //    * 用 detailRef 而不是 closure 里的 detail, 避免 stale;
      //      第一次 drill-in 触发时 detail 还是父的, setDetail 还没生效。
      //    * 同一 subUid 重复调用 (比如 background refresh) 不要覆盖
      //      已捕获的父 rawJson, 防止 race 把正确的父 rawJson 洗掉。
      //  - 顶层 detail (无 subgraphUid): 清空 subgraphRawContext,
      //    回到 "SourceModal 读 detail.rawJson" 的常规路径。
      if (opts?.subgraphUid) {
        const targetUid = opts.subgraphUid;
        setSubgraphRawContext((prev) =>
          prev?.subUid === targetUid
            ? prev
            : { parentRawJson: detailRef.current?.rawJson ?? null, subUid: targetUid }
        );
      } else {
        setSubgraphRawContext(null);
      }
      //     architecture (2026-08-06 v2).  v3 (2026-08-06) added the
      //     `isBoundary` stamp on rawInputs/rawOutputs so WorkflowNode knows
      //     which handles exist for boundary wires (input -10 sentinel
      //     / output -20 sentinel) — without the flag the "no wire ⇒
      //     no dot" rule hides the Handle and React Flow silently drops
      //     the matching boundary edges.
      //     v4 (2026-08-06 late) invalidates any v3 entries cached BEFORE
      //     the server's `.next` was actually rebuilt with that change
      //     (Turbopack doesn't always hot-reload route.ts; without a
      //     cache bump the UI keeps reading pre-isBoundary data forever,
      //     even after a hard refresh).
      //     On ANY further detail-shape change bump this version so
      //     stale sessionStorage entries can't mask new behaviour for
      //     5 min — remember that Ctrl+Shift+R does NOT clear
      //     sessionStorage, only closing the tab does.  v5 (2026-08-06)
      //     is a defensive bump: even though the *response shape* didn't
      //     change, the runtime now reads `data.boundaryOutputs` /
      //     `data.boundaryInputs` sets — derived in initialNodes from
      // 2026-08-06 late (v6): wfIoPort boundary pins are now wrapped
      //     in two wfGroup rectangles ("grp:bpin:inputs" /
      //     "grp:bpin:outputs") with parentId + extent:"parent" on the
      //     children; the layout pass reads `positions["grp:bpin:…
      //     "]"` to honour a manually dragged column.  v5-cached
      //     `detail` had no such keys and would silently fall back to
      //     the rail-layout anchor on next paint, looking like the
      //     change "didn't take".  Bumping to v6 invalidates every old
      //     wfdetail:v5:* entry so the new boundary-group render kicks
      //     in immediately on next open.
      // 2026-08-06 (v7): the layout pass now anchors each rail at the
      //     raw pin.pos coords (sub.inputs[i].pos / sub.outputs[i].pos)
      //     instead of bbox-snapping every rail to the middle column's
      //     minY.  v6-cached detail already carries the raw coords (the
      //     raw subgraph endpoint has emitted them since this morning),
      //     but the LAYOUT DECISION was different — v6 would still pick
      //     the bbox fallback for workflows whose pin.pos is all-zero.
      //     v7 invalidates any stale sessionStorage v6 entry that
      //     matched the old layout decision so the new pin-anchored
      //     render kicks in immediately on next open.
      // 2026-08-06 16:29 → v8: input-pin wfIoPort children now sit at
      //     `relX = 2*GROUP_PAD_X` instead of `GROUP_PAD_X`, so their
      //     right edge anchors flush to the parent wfGroup's right
      //     border.  v7 cached entries would still render with the
      //     10-px inner gap and look like nothing changed.
      // 2026-08-06 16:50 → v9: top-level layout now requires
      //     `Object.keys(positions).length >= realNodes.length` to
      //     take the saved-positions branch.  A partial positions
      //     snapshot (e.g. 2/114 nodes) used to make 112 nodes fall
      //     through to `{padX, padY}` = (80, 80) and stack on top of
      //     each other, producing a broken main-graph render.  v9
      //     invalidates any stale v8 entry so the new guard takes
      //     effect on next open.
      /* 2026-08-06 终极缓存方案 R3：4 重保险
       *  ① SCHEMA fingerprint：cacheKey 嵌入了「route.ts 输出字段映射」指
       *     纹，凡再加/删/改 API 返回字段，必须同步改本常量（语义注释强
       *     制显式记录 schema 变更）——比单纯 v9→v10 手敲版本号更难漏。
       *  ② __purgeStaleWorkflowCache() 主动清理：fetchDetail 进入即扫一
       *     遍 sessionStorage，凡命名空间不对的 wfdetail: 全部物理删除，
       *     杜绝老 key 在新 sessionStorage 里残留被误命中。
       *  ③ fetch 改 cache:"no-store"：浏览器/HTTP 缓存层强制走完。
       *  ④ 顶栏 🔄 强制重载按钮：用户可以一键清光所有 sessionStorage 并
       *     带 ?bust 重新拉 server LRU bypass。
       *  附带：TTL 5min → 30s；后台 fetch 也更新 UI（latestRequestId 守
       *     卫 race condition）；console.banner 在每次 fetchDetail 入口打
       *     显眼状态。 */
      const cacheKey = `wfdetail:R6:outputsLabel+boundaryPinLocalized+rawInputsRawStamp+nodeMode+workflowIOTyped:${url}`;
      const WFCACHE_TTL_MS = 30_000;

      /* Once-per-page-load purge: drop every wfdetail:* entry that doesn't
       *  share the current namespace suffix.  Catches the entire family of
       *  "stuck v8/v9/v10" keys that used to lock users into a stale canvas
       *  for up to 5 minutes.  Safe to call repeatedly — best-effort only. */
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith("wfdetail:") && !k.startsWith("wfdetail:R6:")) {
            sessionStorage.removeItem(k);
          }
        }
      } catch {
        /* sessionStorage may be blocked (private mode); skip silently */
      }

      // 1) Synchronous sessionStorage lookup → instant paint on re-open.
      let cached: WorkflowDetail | null = null;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const obj = JSON.parse(raw) as { t: number; d: WorkflowDetail };
          if (Date.now() - obj.t < WFCACHE_TTL_MS) cached = obj.d;
        }
      } catch {
        cached = null;
      }

      // Race-safe token: only the most recent fetchDetail invocation for a
      // given URL is allowed to commit setDetail.  Solves "background fetch
      // returns fresh data but UI still shows the cached one" by routing
      // both branches through the same commit path.
      const myReqId = ++latestRequestIdRef.current;

      if (cached) {
        if (myReqId === latestRequestIdRef.current) {
          setDetail(cached);
          setParamMap(cached.paramMap ?? {});
          setWorkflowIO(cached.workflowIO ?? {});
          setLoading(false);
          setSubgraphLoading(false);
          /* Capture root workflow name on the first top-level fetch only. */
          if (!opts?.subgraphUid) {
            setRootWorkflowName((prev) => prev ?? cached.name ?? "");
          }
          if (opts?.subgraphUid) {
            pushSubgraphStack(opts.subgraphUid, opts.parentTitle ?? cached.name ?? "子工作流");
          }
        }
        // Background refresh: ALWAYS commit if it wins the race (it's
        // newer than what we just painted), so schema-fingerprint
        // upgrades automatically surface without a manual reload.
        const bgPromise = opts?.subgraphUid
          ? vanillaApi.workflow.subgraph.query({ id: workflowId, uid: opts.subgraphUid })
          : vanillaApi.workflow.detailFull.query({ id: workflowId });
        bgPromise
          .then((data: WorkflowDetailResponse | null) => {
            if (!data || data.error) return;
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data }));
            } catch {
              /* ignore quota errors */
            }
            if (latestRequestIdRef.current === myReqId) {
              setDetail(data);
              setParamMap(data.paramMap ?? {});
              setWorkflowIO(data.workflowIO ?? {});
              if (!opts?.subgraphUid) {
                setRootWorkflowName((prev) => prev ?? data.name ?? "");
              }
            }
          })
          .catch(() => undefined);
        return;
      }

      // 2) Cold path: network fetch via tRPC (POST, bypasses HTTP cache).
      /* 2026-08-06 R3: callers may pass {bust:true} via fetchDetail so that
       *  the server's in-memory LRU is also invalidated (matches the
       *  顶栏 🔄 强制重载按钮 contract). */
      const isBust = opts?.bust === true;
      if (!detail) setLoading(true);
      try {
        const d = (await withTimeout(
          opts?.subgraphUid
            ? vanillaApi.workflow.subgraph.query({ id: workflowId, uid: opts.subgraphUid })
            : vanillaApi.workflow.detailFull.query({
                id: workflowId,
                bust: isBust ? true : undefined,
              }),
          60_000,
          opts?.subgraphUid ? "子工作流" : "工作流",
        )) as WorkflowDetailResponse;
        if (d.error) throw new Error(d.error);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d }));
        } catch {
          /* ignore quota errors */
        }
        if (myReqId === latestRequestIdRef.current) {
          setDetail(d);
          setParamMap(d.paramMap ?? {});
          setWorkflowIO(d.workflowIO ?? {});
          /* Capture root workflow name on first top-level fetch. */
          if (!opts?.subgraphUid) {
            setRootWorkflowName((prev) => prev ?? d.name ?? "");
          }
          if (opts?.subgraphUid) {
            pushSubgraphStack(opts.subgraphUid, opts.parentTitle ?? d.name ?? "子工作流");
          }
        }
      } catch (e: unknown) {
        // 子工作流下钻失败：非致命 —— 保留父图，仅用内联错误提示，
        // 绝不渲染「返回」错误屏（那会回退到工作流库界面）。
        // e 为 unknown：先用 instanceof Error 收窄再取 message，否则回退到约定文案。
        const msg =
          (e instanceof Error ? e.message : "") ||
          (opts?.subgraphUid ? "子工作流加载失败" : "加载失败");
        if (opts?.subgraphUid) {
          setSubgraphError(msg);
        } else {
          setError(msg);
        }
      } finally {
        if (myReqId === latestRequestIdRef.current) {
          setLoading(false);
          setSubgraphLoading(false);
        }
      }
    },
    [workflowId, pushSubgraphStack], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* 2026-08-06 R3 终极方案 #4: 顶栏 🔄 强制重载按钮触发的入口
   *  - 清空整个 sessionStorage（不只是 wfdetail:*，避免任何层残渣）
   *  - 提前把 latestRequestIdRef 自增一次让任何 in-flight fetch 全部失效
   *  - 重新调用 fetchDetail({bust:true})（服务器 LRU 也会被 ?_bust=1 清掉）
   *  - server side 通过 url 上的 _r3= 时间戳参数穿透 server LRU 的 30s 边界
   */
  const forceReloadDetail = useCallback(() => {
    try {
      // 1) 清光所有 sessionStorage key（防御性）
      sessionStorage.clear();
    } catch {
      /* private mode 等 */
    }
    // 2) 任何 in-flight fetchDetail 都作废
    latestRequestIdRef.current++;
    setError("");
    // 3) 重新跑一次（冷路径 → network → setDetail → 立刻看到新数据）
    setDetail(null);
    setLoading(true);
    setSubgraphLoading(false);
    void fetchDetail({ bust: true });
  }, [fetchDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    /* When the parent reuses this editor instance for a *different*
     *  workflow (same `WorkflowCanvasEditor` element, new `workflowId`
     *  prop), reset the breadcrumb state.  Otherwise the old root
     *  name + subgraph stack would briefly show against the new
     *  workflow before the new top-level fetch lands. */
    setSubgraphStack([]);
    setRootWorkflowName("");
    setDetail(null);
    setError("");
    void fetchDetail();
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Enter a subgraph: flash the loading overlay synchronously, then fetch
   *  the inner graph in a separate macrotask so React 18 commits the
   *  overlay before the new `detail` arrives.  We no longer stash a
   *  WorkflowSubgraphData "summary" — the user wants the I/O to live ON the
   *  WorkflowSubgraphNode card in the parent graph, not in a separate full-
   *  canvas panel; clicking expand jumps straight into the inner graph. */
  const onEnterSubgraph = useCallback(
    (nodeId: string, uid: string, parentTitle: string) => {
      /* R50 (2026-08-11): a subgraph can't run on its own — it lives
       *  inside the parent workflow and only takes data in via the
       *  parent's IO-boundary pin nodes.  Once we drill in, the IO edit
       *  affordances are meaningless (you can't `run` this subgraph to
       *  collect outputs the way you can with the root workflow), so we
       *  tear them down before the new detail arrives.  The toolbar
       *  buttons are also conditionally hidden (see `isSubgraphView`
       *  guard below), but flipping the states off here prevents the
       *  short window where the toolbar still shows the old toggle but
       *  every WorkflowNode already renders the subgraph view with stale
       *  `ioEditMode=true` checkboxes dotted across it. */
      setIoEditMode(false);
      setIoPreviewOpen(false);
      setSubgraphError("");
      setSubgraphLoading(true);
      setTimeout(() => { void fetchDetail({ subgraphUid: uid, parentTitle }); }, 0);
    },
    [fetchDetail], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* Pop one level off the subgraph stack and re-render.  If we end up
   *  back at the top level, re-fetch the workflow detail. */
  const onExitSubgraph = useCallback(async () => {
    setSubgraphLoading(true);
    setSubgraphStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      // Schedule a re-fetch of the right level outside the setter.
      if (next.length === 0) {
        // Back at top level
        setTimeout(() => { void fetchDetail(); }, 0);
      } else {
        const parent = next[next.length - 1];
        setTimeout(() => { void fetchDetail({ subgraphUid: parent!.uid, parentTitle: parent!.name }); }, 0);
      }
      return next;
    });
  }, [fetchDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pushSubgraphStack, fetchDetail, forceReloadDetail, onEnterSubgraph, onExitSubgraph };
}
