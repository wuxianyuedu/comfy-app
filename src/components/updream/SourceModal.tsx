"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { JsonViewer } from "./JsonViewer";
import { GraphPreview } from "./GraphPreview";

/**
 * 查看 JSON 源文件弹窗。
 *
 * R40 重构：从 WorkflowLibrary 内联抽出，独立接受 `data`，画布与库共用。
 * R41 调整 (2026-08-11)：
 *   - modal 高度由 `max-h-[85vh]` 改为 **`h-[85vh]`**，固定不动。
 *   - 当 `data.rawJson == null` 时（API-only 导入 / 子工作流），**只显示
 *     API 单 tab**，不再渲染 disabled「RAW 格式（无）」按钮，避免出现
 *     「能点不能看」的灰色按钮。
 *   - 描述文案同步条件化：有 RAW 时双 tab 说明，RAW 缺席时改写为「纯 API」。
 *
 * R43 调整 (2026-08-11):
 *   - tab 顺序变为 **RAW → API**；默认选中 RAW (用户偏好先看原始导入)。
 *   - 子工作流不再有"无 RAW"状态 — 当前 sub 自己的 API graph 本身就是
 *     LiteGraph JSON 节点数据，画布侧用 detail.graph 派生喂给 rawJson 槽，
 *     让 sub 始终有 RAW 显示。文案在 sub 下区分"父级真 RAW 切片"与"sub API 派生"。
 *   - 「rawJson 为 null」只表示 API-only 顶层导入，仍只显示 RAW 单 tab (已选中)。
 *
 * R78 调整 (2026-08-12):
 *   - 新增第三个 tab「节点画布」—— 用 React Flow 渲染只读节点图（RAW 走 pos，
 *     API 走最长路径层布局）。
 *   - tab 默认改为「API」(用户升级工作流后主要想看 graph)。
 *   - segmented-control 风格 tab 容器 + 「N 节点 / M 连线」统计。
 *   - 键盘 1/2/3 跳、← / → 切换、Esc 关闭 (带 INPUT/TEXTAREA 守卫)。
 *
 * R78.1 调整 (2026-08-12):
 *   - 节点画布内的「RAW 画布 / API 画布」sub-toggle 上移到 tab bar (与
 *     「下载当前」按钮并列)。原版藏在 GraphPreview 内部 React Flow 浮层
 *     绝对定位，被用户截图反馈"看不到右上角 toggle" —— 因 React Flow 容器
 *     高度塌缩而失明。上移后绝对可见、不依赖 React Flow 容器高度。
 */
/**
 * 2026-08-11 R42 改造 — 子工作流也要支持显示 RAW。
 *
 * ComfyUI 的子工作流是父 RAW 中 `definitions.subgraphs[uid]` 切出来
 * 的子图，本身就是 LiteGraph JSON 形态（包含 nodes/links/groups 等）。
 * R41 误把"子工作流"列为"无 RAW 形态"，被用户截图纠正。修法：
 *   1. `isSubgraph` 标志由画布侧传入，让 modal 知道当前 detail 是 sub 视图
 *   2. RAW 标题文案在子视图下写明"RAW 来自父工作流 definitions.subgraphs[uid]",
 *      让用户清楚这是从父级切出来的
 *   3. 当 sub 视图下 rawJson 仍为 null（父不是 RAW 导入 / 未携带 sub-definition）
 *      时，文案写"父工作流无 RAW / 未携带 sub-definition"
 *
 * 文案分支（共 4 路）:
 *   顶层 + 有 RAW : 双 tab, "API 可执行 / RAW 原始导入"
 *   顶层 + 无 RAW : 单 tab, "纯 API 格式 (该工作流无原始 RAW 导入 — 常见于 API-only 导入)"
 *   sub  + 有 RAW : 双 tab, "API 为 sub 可执行 / RAW 来自父 rawJson.definitions.subgraphs[uid]"
 *   sub  + 无 RAW : 单 tab, "该子工作流无独立 RAW (父工作流不是 RAW 导入, 或未携带 sub-definition)"
 */
export interface SourceModalData {
  /** 工作流名（标题、副标题都用） */
  name: string;
  /** API 格式 — `{ [nodeId]: { class_type, inputs, widgets_values, ... } }` */
  graph: unknown;
  /**
   * 原始导入格式 (LiteGraph JSON)。可能为 null，常见于:
   *   - 纯 API-only 导入的工作流 (ComfyUI 的「Save (API format)」)
   * 为 null 时，modal 只显示 RAW 单 tab (已选中 disabled)。
   *
   * R43 起：子工作流视图永远有 RAW — 优先切父 rawJson 的 sub-definition，
   * fallback 用 sub 自己的 API graph (本身也是完整的 LiteGraph JSON 节点)。
   */
  rawJson: unknown;
  /**
   * 当前 detail 是否来自子工作流 (drill-in 进 sub) 视图。
   * 用于文案区分"父工作流 RAW"和"子工作流 RAW"。
   * 顶层 detail 不传，默认为 false。
   */
  isSubgraph?: boolean;
  /**
   * 仅 isSubgraph=true 时有意义:
   *   true = 切的是父 rawJson.definitions.subgraphs[uid] 真切片
   *   false = 从 sub 自己的 API graph 派生 fallback
   * 顶层 detail 不传。
   */
  isSubRawFromParent?: boolean;
}

export interface SourceModalProps {
  data: SourceModalData | null;
  /** 仓库已经加载好的视图 — 等待期间显示 loading */
  loading?: boolean;
  /** 加载/解析失败时显示 */
  error?: string;
  onClose: () => void;
}

export function SourceModal({ data, loading, error, onClose }: SourceModalProps) {
  /* R78: 默认 API tab — 升级后用户主要想看的是 graph (而非 rawJson)，
   * 保留之前 R43 的"RAW → API → 节点画布"三 tab 顺序。 */
  const [tab, setTab] = useState<"raw" | "api" | "graph">("api");
  const hasRaw = data?.rawJson != null;
  /* R78.1: 节点画布内 RAW/API sub-toggle 上移到 tab bar (右侧与「下载当前」并列)
   * —— 不再藏在 GraphPreview 内部 React Flow 浮层中,绝对可见且不被 React Flow 容器高度影响。 */
  const [graphVariant, setGraphVariant] = useState<"raw" | "api">("api");

  /* R78: 统计节点/链接数 — 让用户对图内容有 size 感。
   * RAW: 直接读 nodes.length / links.length。
   * API: 顶层 key 数 = 节点数；边数 = 走一次 inputs 抽 [src,slot] tuple。 */
  const stats = useMemo(() => {
    if (!data) return null;
    if (tab === "raw") {
      const r = data.rawJson as { nodes?: unknown[]; links?: unknown[] } | null;
      return {
        nodes: Array.isArray(r?.nodes) ? r!.nodes!.length : 0,
        edges: Array.isArray(r?.links) ? r!.links!.length : 0,
      };
    }
    if (tab === "api") {
      const g = data.graph as Record<string, unknown> | null;
      const entries = g ? Object.entries(g) : [];
      let edgeCount = 0;
      for (const [, n] of entries) {
        const inputs = (n as { inputs?: Record<string, unknown> } | null)?.inputs;
        if (!inputs) continue;
        for (const v of Object.values(inputs)) {
          if (Array.isArray(v) && v.length >= 2 && typeof v[0] === "string" && g && v[0] in g) {
            edgeCount++;
          }
        }
      }
      return { nodes: entries.length, edges: edgeCount };
    }
    return null; // graph view: 实际数量由 GraphPreview 渲染，无需在此处统计
  }, [data, tab]);

  /* R78: 键盘快捷键 — 1/2/3 直接跳、← / → 切换、Esc 关闭。
   * 注意：focus 在 JsonViewer 内部 input 时也会触发 — 用 key 限定
   * 数字键 + 方向键，避免劫持用户的搜索框。                  */
  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // 跳过输入控件内按键 (避免劫持 JsonViewer 搜索框)
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "1") setTab("raw");
      else if (e.key === "2") setTab("api");
      else if (e.key === "3") setTab("graph");
      else if (e.key === "ArrowLeft") {
        setTab((cur) => (cur === "api" ? "raw" : cur === "graph" ? "api" : "raw"));
      } else if (e.key === "ArrowRight") {
        setTab((cur) => (cur === "raw" ? "api" : cur === "api" ? "graph" : "graph"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data, onClose]);

  /* data 整体切换 (prop 引用变) 时回到默认 tab —
   * 防止从一个 wf 的 raw 切到另一个 wf 时停留在用户上次选的 tab,
   * 看不到新 wf 的 RAW 概貌。                                  */
  const dataRef = useRef(data);
  useEffect(() => {
    if (dataRef.current !== data) {
      dataRef.current = data;
      setTab("api");
      setGraphVariant("api");
    }
  }, [data]);

  const activeText = useMemo(() => {
    if (!data) return "";
    return JSON.stringify(
      tab === "api" ? data.graph ?? null : data.rawJson ?? null,
      null,
      2
    );
  }, [data, tab]);

  const downloadCurrent = () => {
    if (!data || !activeText) return;
    const blob = new Blob([activeText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.name}.${tab}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tabBase = "rounded-md px-3 py-1.5 text-sm font-medium transition-colors";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      {/*
        R41: 高度固定为 `h-[85vh]` (不再 max)，搭配 `flex-col + overflow-hidden`
        让内部 JsonViewer 撑起中间区域；JsonViewer body 自带 `overflow-auto`，
        真正滚动的区域始终是 viewer 本体，modal 外框不会跟随内容被撑高。
      */}
      <div
        className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#12101c] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/[0.08] px-5 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-100">
              查看源文件 · {data?.name ?? "—"}
              {/* R45: 标题栏格式徽标 —— 随当前 tab 高亮, 直接点明数据源,
                  与单节点弹窗的「RAW / API · …」自解释风格对齐。 */}
              <span
                title={
                  tab === "raw"
                    ? "RAW 格式：detail.rawJson —— 原始导入的 LiteGraph JSON 文件（含 pos/size/flags/order/inputs 完整规格），与 ComfyUI 导出文件逐字节一致"
                    : "API 格式：detail.graph —— ComfyUI /prompt 用的执行图（节点字典 {nodeId: {class_type, inputs, widgets_values}}），不含画布元数据"
                }
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ${
                  tab === "raw"
                    ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40"
                    : "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40"
                }`}
              >
                {tab === "raw" ? "RAW" : "API"}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {/* R43: 文案拆 5 路
                  (顶层 × 有/无 RAW) + (sub × 父级真 RAW/sub API 派生).
                  tab 默认是 RAW, 文案描述与之一致。                         */}
              {data?.isSubgraph
                ? /* sub 视图: 区分"父级真切片" vs "sub API 派生" */
                  data.isSubRawFromParent
                    ? "RAW 来自父工作流 `rawJson.definitions.subgraphs[uid]` 切片（LiteGraph JSON 原始导入）；API 为当前子工作流的可执行格式"
                    : "RAW 从当前子工作流的 API 数据派生（LiteGraph JSON 节点视图）— 父工作流非 RAW 导入，未携带 sub-definition"
                : /* 顶层 */ hasRaw
                ? "RAW 为原始导入格式（默认显示）；API 为始终可用的可执行格式"
                : "该工作流为纯 API 导入 — 显示 API JSON 视图（节点字典形式）"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 transition-colors hover:text-gray-300"
            title="关闭"
          >
            ✕
          </button>
        </div>

        {/* Tab bar + per-tab actions */}
        {/*
          R78: 改为 segmented-control 风格 (容器 + 内嵌按钮) — 让三个 tab 视觉统一、
          当前 tab 一眼可识别，避免和右侧「下载当前」按钮混淆。键盘快捷键：1/2/3 跳,
          ← / → 切换。节点/链接统计放在每个 tab 后面 (当有 rawJson / graph 时)。
        */}
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-5 py-2">
          <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
            <button
              type="button"
              onClick={() => setTab("raw")}
              title="RAW 格式：detail.rawJson — 原始导入的 LiteGraph JSON 文件（含 pos/size/flags/order/inputs 完整规格），与 ComfyUI 导出文件逐字节一致 · 快捷键 1"
              className={`${tabBase} ${tab === "raw" ? "bg-violet-500/90 text-white shadow-[0_2px_8px_rgba(124,92,252,0.4)]" : "text-gray-400 hover:text-gray-200"}`}
            >
              RAW 格式{hasRaw ? "" : "（无）"}
            </button>
            <button
              type="button"
              onClick={() => setTab("api")}
              title="API 格式：detail.graph — ComfyUI /prompt 用的执行图（节点字典 {nodeId: {class_type, inputs, widgets_values}}），不含画布元数据 · 快捷键 2"
              className={`${tabBase} ${tab === "api" ? "bg-cyan-500/90 text-white shadow-[0_2px_8px_rgba(34,211,238,0.4)]" : "text-gray-400 hover:text-gray-200"}`}
            >
              API 格式
            </button>
            <button
              type="button"
              onClick={() => setTab("graph")}
              title="节点画布 — 用 React Flow 渲染的只读节点图 (RAW 走 pos，API 走最长路径层布局) · 快捷键 3"
              className={`${tabBase} ${tab === "graph" ? "bg-emerald-500/90 text-white shadow-[0_2px_8px_rgba(16,185,129,0.4)]" : "text-gray-400 hover:text-gray-200"}`}
            >
              节点画布
            </button>
          </div>
          {/* R78: 节点/链接统计 — 让用户对图内容有 size 感。
              仅当 stats 可计算时 (raw / api tab) 显示；graph tab 由 GraphPreview 自行渲染不做统计。 */}
          {stats && (tab === "raw" || tab === "api") && (
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-gray-500">
              <span className="rounded bg-white/[0.05] px-1.5 py-0.5">{stats.nodes} 节点</span>
              <span className="rounded bg-white/[0.05] px-1.5 py-0.5">{stats.edges} 连线</span>
            </span>
          )}
          <span className="flex-1" />
          {/* R78.1: 节点画布 sub-toggle (RAW 画布 / API 画布) 上移到 tab bar。
              仅在「节点画布」tab 且 rawJson 存在时显示 —— 绝对可见，不被 React Flow 高度影响。 */}
          {tab === "graph" && hasRaw && (
            <div
              role="group"
              aria-label="节点画布数据源"
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1"
            >
              <button
                type="button"
                onClick={() => setGraphVariant("raw")}
                title="RAW 节点画布：用 rawJson.nodes[].pos 的原始 LiteGraph 布局"
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  graphVariant === "raw"
                    ? "bg-violet-500/90 text-white shadow-[0_2px_8px_rgba(124,92,252,0.4)]"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                RAW 画布
              </button>
              <button
                type="button"
                onClick={() => setGraphVariant("api")}
                title="API 节点画布：用 graph 的最长路径层自动布局"
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  graphVariant === "api"
                    ? "bg-cyan-500/90 text-white shadow-[0_2px_8px_rgba(34,211,238,0.4)]"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                API 画布
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={downloadCurrent}
            disabled={!activeText || tab === "graph"}
            className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-40"
          >
            下载当前
          </button>
        </div>

        {/* Body — JsonViewer 自带语法着色 / 折叠 / 搜索 / 滚动。 */}
        {/*   key=tab 强制每个 tab 重建一份，避免折叠/搜索 state 在切换时  */}
        {/*   视觉残留 (R39 之后的稳定结构)。                                */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <p className="px-5 py-3 text-sm text-gray-500">加载中…</p>
          ) : error ? (
            <p className="px-5 py-3 text-sm text-red-400">{error}</p>
          ) : !data ? (
            <p className="px-5 py-3 text-sm text-gray-500">没有可显示的数据</p>
          ) : tab === "raw" && !hasRaw ? (
            /* R43: RAW 缺席 (顶层 API-only) 切到 RAW tab 时的友好兜底
               — 引导用户切到 API tab 看节点字典视图。                 */
            <div className="px-5 py-6 text-sm text-gray-400">
              <p className="font-medium text-gray-300">该工作流无 RAW 导入</p>
              <p className="mt-1 text-xs text-gray-500">
                当前是纯 API 导入的工作流，没有原始 LiteGraph JSON 形态。
                切到「API 格式」查看节点字典视图。
              </p>
            </div>
          ) : tab === "graph" ? (
            /* R78.1: 节点画布视图 — 用 GraphPreview 渲染只读 React Flow 图。
               variant 由 tab bar 上的 sub-toggle 控制 (SourceModal 持有),
               key 加 variant 让切源时 React Flow 重建 (避免 pan/zoom 残留)。 */
            <GraphPreview
              key={`${data ? "ready" : "empty"}-${tab}-${graphVariant}`}
              apiGraph={data.graph}
              rawJson={data.rawJson}
              variant={graphVariant}
            />
          ) : (
            <JsonViewer
              key={tab}
              data={(tab === "api" ? data.graph : data.rawJson) as never}
              title={tab === "api" ? "API 格式" : "RAW 格式"}
              initialCollapsedDepth={1}
            />
          )}
        </div>

        {/* Footer — 只有提示，无按钮 (下载/复制都在顶部/ viewer toolbar) */}
        <div className="border-t border-white/[0.08] px-5 py-2.5">
          <p className="text-xs text-gray-500">
            下载 = 仅导出顶部 tab 选中的 JSON · ⌘/Ctrl+F 在视图内搜索 · 点击 chevron 折叠/展开
          </p>
        </div>
      </div>
    </div>
  );
}
