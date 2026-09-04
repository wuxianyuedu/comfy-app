"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type RefObject } from "react";
import {
  refreshCustomNodes,
  getCustomNodesManifest,
  type ManifestNodeRaw,
} from "@/config/custom-nodes";
import { deriveRowState, eqArr, nowTimeStr, pathKey, splitPaths } from "../parsing";
import type {
  DiscoveredSubpkg,
  ParseProgress,
  ParseReport,
  SettingsResp,
  SummaryPkg,
} from "../types";

/** POST /api/custom-nodes 保存响应的类型视图。路由返回
 *  `{ ok, error?, paths? / localWorkflowPaths? }`；字段为 unknown，由下方守卫决定信任。 */
interface SaveSettingsResp {
  ok?: unknown;
  error?: unknown;
  paths?: string[];
  localWorkflowPaths?: string[];
}

/** 设置/解析进度流的一行 ndjson —— 仅本对话框消费的字段。 */
interface SettingsStreamEvent {
  type?: string;
  parents?: string[];
  parent?: string;
  phase?: string;
  msg?: string;
  discovered?: number;
  total?: number;
  done?: number;
  packages?: DiscoveredSubpkg[];
  summary?: SettingsResp["summary"];
  lastReport?: ParseReport | null;
  byPath?: Record<string, SummaryPkg>;
  settings?: { localWorkflowPaths?: string[] };
  message?: string;
}

/** 解析日志流的一行 ndjson。 */
interface ParseStreamEvent {
  type?: string;
  level?: string;
  msg?: string;
  report?: ParseReport | null;
  ok?: boolean;
}

type RowState = ReturnType<typeof deriveRowState>;

export interface ParentBlock {
  parent: string;
  subs: { sub: DiscoveredSubpkg; saved: SummaryPkg | undefined; state: RowState }[];
  cnt: { loaded: number; outdated: number; unimported: number; error: number; missing: number; empty: number };
  total: number;
}

/** 自定义节点 / 本地工作流对话框的全部状态、派生数据与操作。
 *  容器与视图组件只消费这个 controller，不自己持有任何逻辑。 */
export interface CustomNodesSettingsController {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  tab: "workflows" | "nodes";
  setTab: Dispatch<SetStateAction<"workflows" | "nodes">>;
  pathsText: string;
  setPathsText: Dispatch<SetStateAction<string>>;
  savedPaths: string[];
  savedAt: string | null;
  saving: boolean;
  saveErr: string | null;
  localPathsText: string;
  setLocalPathsText: Dispatch<SetStateAction<string>>;
  savedLocalPaths: string[];
  localSavedAt: string | null;
  localSaving: boolean;
  localSaveErr: string | null;
  loading: boolean;
  progress: ParseProgress;
  parsing: boolean;
  perPkgParsing: Record<string, boolean>;
  report: ParseReport | null;
  summary: SettingsResp["summary"];
  discoveredByParent: Record<string, DiscoveredSubpkg[]>;
  byPath: Record<string, SummaryPkg>;
  expandedParents: Record<string, boolean>;
  setExpandedParents: Dispatch<SetStateAction<Record<string, boolean>>>;
  logs: { level: string; msg: string }[];
  consoleRef: RefObject<HTMLDivElement | null>;
  logsRef: RefObject<HTMLDivElement | null>;
  manifestByNode: Record<string, ManifestNodeRaw>;
  expandedNodeList: Record<string, boolean>;
  setExpandedNodeList: Dispatch<SetStateAction<Record<string, boolean>>>;
  nodeExpanded: Record<string, boolean>;
  setNodeExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  onParseAll: () => Promise<void>;
  onParseSingle: (pkgPath: string) => Promise<void>;
  onParseAllParent: (parent: string) => Promise<void>;
  parentBlocks: ParentBlock[];
  totalAcrossParents: { loaded: number; outdated: number; unimported: number; total: number };
}

export function useCustomNodesSettings(): CustomNodesSettingsController {
  const [open, setOpen] = useState(false);
  // 把对话框主体拆成两个聚焦页：本地工作流（纯 textarea）与自定义节点
  // （解析/清单/日志）不共用滚动区。默认 "workflows" —— 这是用户刚启用的新功能。
  const [tab, setTab] = useState<"workflows" | "nodes">("workflows");
  const [pathsText, setPathsText] = useState("");
  const [savedPaths, setSavedPaths] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // LOCAL_WORKFLOWS_PATH 字段的独立状态：与节点路径同套编辑/保存/时间戳模式，
  // 但各自独立，使两个区块的保存指示器互不干扰。
  const [localPathsText, setLocalPathsText] = useState("");
  const [savedLocalPaths, setSavedLocalPaths] = useState<string[]>([]);
  const [localSavedAt, setLocalSavedAt] = useState<string | null>(null);
  const [localSaving, setLocalSaving] = useState(false);
  const [localSaveErr, setLocalSaveErr] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  // 进度分两阶段，均用「包数」而非「文件数」表达（shape/字段文档见 ./types.ts 的
  // ParseProgress）：scan 阶段 discovered 增长、total 未知；hash 阶段 done/total
  // 为已处理包数。进度条在 scan 期间用 CSS 动画（indeterminate），scan 宣布
  // total=M 时切换为确定的百分比。
  const [progress, setProgress] = useState<ParseProgress>({ phase: "", done: 0, total: 0, discovered: 0, parent: "", msg: "" });
  const [parsing, setParsing] = useState(false);
  const [perPkgParsing, setPerPkgParsing] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState<ParseReport | null>(null);
  const [summary, setSummary] = useState<SettingsResp["summary"]>(null);
  const [discoveredByParent, setDiscoveredByParent] = useState<Record<string, DiscoveredSubpkg[]>>({});
  const [byPath, setByPath] = useState<Record<string, SummaryPkg>>({});
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});

  const [logs, setLogs] = useState<{ level: string; msg: string }[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  // 原始 manifest（classType → 完整 spec），独立于 refreshCustomNodes() 填充的
  // 注册表：即使对话框刚打开、尚无消费者调用 refresh，也能渲染预览卡片。每次解析
  // 后重新拉取，使新导入的包无需硬刷新即可显示节点。
  const [manifestByNode, setManifestByNode] = useState<Record<string, ManifestNodeRaw>>({});
  // 每个子包：内联节点列表是否展开？
  const [expandedNodeList, setExpandedNodeList] = useState<Record<string, boolean>>({});
  // 每个 classType：节点预览卡是否展开显示端口+控件？默认折叠 —— 一个 146 节点的
  // 包会产生海量叶子，全展开会过度膨胀。
  const [nodeExpanded, setNodeExpanded] = useState<Record<string, boolean>>({});

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stillParsing =
      parsing || Object.values(perPkgParsing).some(Boolean);
    if (stillParsing) {
      if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    } else if (logs.some((log) => log.level === "error" || log.msg.includes("✗"))) {
      const idx = logs.findIndex((log) => log.level === "error" || log.msg.includes("✗"));
      requestAnimationFrame(() => {
        const console_ = consoleRef.current;
        if (!console_) return;
        const row = console_.querySelectorAll<HTMLDivElement>("[data-log-row]");
        const target = row[idx];
        if (!target) return;
        // 相对面板自身计算 scrollTop：`target.offsetTop` 量的是最近定位祖先，
        // 而本面板没有 position:relative，会回退到更高层的 fixed 包装，得到乱值。
        // getBoundingClientRect + 面板自身 rect + 其 scrollTop 才是正确的面板内偏移。
        const targetTop = target.getBoundingClientRect().top - console_.getBoundingClientRect().top;
        console_.scrollTop = Math.max(0, console_.scrollTop + targetTop - 8);
      });
    }
  }, [logs, parsing, perPkgParsing]);

  // 解析开始或结束时，把对话框滚到日志控制台 —— 否则高个子包列表把日志推到折叠线
  // 以下，用户得手动折叠父级才能看到。
  useEffect(() => {
    if (parsing || Object.values(perPkgParsing).some(Boolean)) {
      requestAnimationFrame(() => {
        logsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  }, [parsing, perPkgParsing, logs.length]);
  // 单包解析完成时也滚到日志：此刻新 report 追加、reloadFromServer() 重新填充列表。
  useEffect(() => {
    if (report && !parsing && !Object.values(perPkgParsing).some(Boolean)) {
      requestAnimationFrame(() => {
        logsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  }, [report, parsing, perPkgParsing]);

  /** 从服务端拉取设置并写入本地 state。首个 await 之前不做同步 setState，因此可直接
   *  从 effect 调用（React 19 规则：effect 内不 set-state）。想要重置 spinner 的调用方
   *  用 `reloadFromServer`。 */
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/custom-nodes");
      const ct = res.headers.get("content-type") ?? "";
      const isStream = ct.includes("ndjson");

      if (!isStream) {
        // 缓存预热路径：服务端返回单个 JSON blob。
        const data = (await res.json()) as SettingsResp;
        const paths = data.settings.paths || [];
        setPathsText(paths.join("\n"));
        setSavedPaths(paths);
        // 缓存预热分支之前只填 pathsText/savedPaths，完全忽略
        // data.settings.localWorkflowPaths。配合「未配置」徽标以 !localSavedAt
        // （新挂载时为 null）为键，对话框即便 .env 已设 LOCAL_WORKFLOWS_PATH 也会
        // 显示「未配置」。这里两个字段都填，使 textarea 显示真实已存值。
        const localPaths = data.settings.localWorkflowPaths || [];
        setLocalPathsText(localPaths.join("\n"));
        setSavedLocalPaths(localPaths);
        setSummary(data.summary);
        setReport(data.lastReport);
        setDiscoveredByParent(data.discoveredByParent || {});
        setByPath(data.byPath || {});
        setExpandedParents((prev) => {
          const out = { ...prev };
          for (const p of paths) if (!(p in out)) out[p] = true;
          return out;
        });
        return;
      }

      // 冷路径：读取 ndjson 进度事件流。
      const reader = res.body?.getReader();
      if (!reader) throw new Error("服务器未返回流式响应");
      const decoder = new TextDecoder();
      let buf = "";
      let summary: SettingsResp["summary"] = null;
      let lastReport: ParseReport | null = null;
      let byPath: Record<string, SummaryPkg> = {};
      // summary 事件在 settings.localWorkflowPaths 下携带本地工作流路径列表
      // （server route.ts），这里收集并在流结束时推入 React state。
      let localWorkflowPathsArr: string[] = [];
      const discoveredByParent: Record<string, DiscoveredSubpkg[]> = {};
      const paths: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          // 设置流的 ndjson 事件 —— 仅本对话框消费的字段；每行由 JSON.parse 自身校验。
          let ev: SettingsStreamEvent;
          try { ev = JSON.parse(line) as SettingsStreamEvent; } catch { continue; }
          if (ev.type === "discover_start") {
            paths.push(...(ev.parents ?? []));
            setProgress({ phase: "queue", done: 0, total: 0, discovered: 0, parent: "", msg: "准备扫描…" });
          } else if (ev.type === "progress") {
            setProgress((progress) => {
              // 用最新事件告知的值。total/done/discovered 仅当事件确实携带时才更新
              // （解析器每个有意义的 tick 都会发）；只带 msg 的事件不会重置计数器。
              // 空串 parent 须保留上一值（之前是 ||）。
              const evParent = typeof ev.parent === "string" ? ev.parent : "";
              const next = {
                ...progress,
                parent: evParent.length > 0 ? evParent : progress.parent,
              };
              if (ev.phase === "queue") next.phase = "queue";
              if (ev.phase === "scan") next.phase = "scan";
              if (ev.phase === "hash") next.phase = "hash";
              if (ev.msg) next.msg = ev.msg;
              if (typeof ev.discovered === "number") next.discovered = ev.discovered;
              if (typeof ev.total === "number") next.total = ev.total;
              if (typeof ev.done === "number") next.done = ev.done;
              return next;
            });
          } else if (ev.type === "discover_done") {
            if (typeof ev.parent === "string") {
              discoveredByParent[ev.parent] = ev.packages ?? [];
            }
            // 这里不动包计数器 —— 解析器在 JSON 行之前已发出自己的最终 tick
            // （✔ ... done=M|total=M）。我们只刷新 header 里展示的 parent。
            setProgress((progress) => ({
              ...progress,
              parent: ev.parent ?? progress.parent,
              msg: `✔ ${ev.parent ?? ""}`,
            }));
          } else if (ev.type === "summary") {
            summary = ev.summary ?? null;
            lastReport = ev.lastReport ?? null;
            byPath = ev.byPath ?? {};
            // 与缓存预热分支同样的修复：summary 事件已携带 settings.localWorkflowPaths
            // （route.ts:414）但客户端从未取用，导致对话框始终渲染空 textarea 与
            // 「未配置」徽标，即便 .env 已存路径。
            const lwp = ev.settings?.localWorkflowPaths ?? [];
            localWorkflowPathsArr = lwp;
          } else if (ev.type === "error") {
            const message =
              typeof ev.message === "string" && ev.message.length > 0
                ? ev.message
                : "未知错误";
            setSaveErr("扫描失败：" + message);
          }
        }
      }

      setPathsText(paths.join("\n"));
      setSavedPaths(paths);
      // 同步本地工作流 state 与流发出的内容，镜像上面的缓存预热分支。
      setLocalPathsText(localWorkflowPathsArr.join("\n"));
      setSavedLocalPaths(localWorkflowPathsArr);
      setSummary(summary);
      setReport(lastReport);
      setDiscoveredByParent(discoveredByParent);
      setByPath(byPath);
      setExpandedParents((prev) => {
        const out = { ...prev };
        for (const p of paths) if (!(p in out)) out[p] = true;
        return out;
      });
    } catch (e) {
      setSaveErr("读取配置失败：" + String(e));
    } finally {
      setLoading(false);
      // 保留最终进度行短暂可见，让用户看到「完成」再消失；下次重置时清除。
      setTimeout(() => setProgress({ phase: "", done: 0, total: 0, discovered: 0, parent: "", msg: "" }), 800);
    }
  }, []);

  /** 重置 spinner/状态再拉取。仅从事件处理器或异步回调调用（绝不在 effect 内同步调用）。 */
  const reloadFromServer = useCallback(() => {
    setLoading(true);
    setSaveErr(null);
    setProgress({ phase: "", done: 0, total: 0, discovered: 0, parent: "", msg: "" });
    return fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void fetchSettings(), 0);
    return () => clearTimeout(timer);
  }, [open, fetchSettings]);

  // 打开时 + 每次解析后（report state 在解析完成事件落地时更新）拉取原始 manifest。
  // 文件已在磁盘上、响应是小 JSON，开销低。
  const fetchManifest = useCallback(async () => {
    const manifest = await getCustomNodesManifest();
    if (manifest) setManifestByNode(manifest.nodes || {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void fetchManifest(), 0);
    return () => clearTimeout(timer);
  }, [open, fetchManifest]);
  useEffect(() => {
    if (!report) return;
    const timer = setTimeout(() => void fetchManifest(), 0);
    return () => clearTimeout(timer);
  }, [report, fetchManifest]);

  // 防抖自动保存：编辑 → 空闲 600ms → PUT 到 .env
  useEffect(() => {
    const live = splitPaths(pathsText);
    if (open && !eqArr(live, savedPaths)) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const savePaths = async (): Promise<void> => {
        setSaving(true);
        setSaveErr(null);
        try {
          const res = await fetch("/api/custom-nodes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "saveSettings", customNodesPaths: live }),
          });
          const data = (await res.json()) as SaveSettingsResp;
          if (!res.ok || !data.ok) {
            throw new Error(
              typeof data.error === "string" && data.error.length > 0
                ? data.error
                : "保存失败"
            );
          }
          setSavedPaths(data.paths ?? live);
          setSavedAt(nowTimeStr());
          await reloadFromServer(); // 在新路径下重新发现子包
        } catch (e) {
          setSaveErr("自动保存失败：" + String(e));
        } finally {
          setSaving(false);
        }
      };
      saveTimerRef.current = setTimeout(() => {
        void savePaths();
      }, 600);
    }
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [pathsText, savedPaths, open, reloadFromServer]);

  // LOCAL_WORKFLOWS_PATH 字段的独立自动保存：同套防抖模式，但分离 effect，使
  // 保存/错误徽标不混淆。
  const localSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const live = splitPaths(localPathsText);
    if (open && !eqArr(live, savedLocalPaths)) {
      if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
      const saveLocalPaths = async (): Promise<void> => {
        setLocalSaving(true);
        setLocalSaveErr(null);
        try {
          const res = await fetch("/api/custom-nodes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "saveSettings",
              localWorkflowPaths: live,
            }),
          });
          const data = (await res.json()) as SaveSettingsResp;
          if (!res.ok || !data.ok) {
            throw new Error(
              typeof data.error === "string" && data.error.length > 0
                ? data.error
                : "保存失败"
            );
          }
          setSavedLocalPaths(data.localWorkflowPaths ?? live);
          setLocalSavedAt(nowTimeStr());
          // 通知其他已挂载列表（如 WorkflowLibrary）重新拉取 /api/workflows，使新配置
          // 根目录的本地待载入项立即出现。对话框自身在下方渲染实时预览；下游面板需要
          // 手动触发。事件名带命名空间避免冲突。
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("comfyapp:local-workflows-path-changed", {
              detail: { paths: data.localWorkflowPaths ?? live },
            }));
          }
          // 这里不调 reloadFromServer —— 本地工作流列表端点自己负责本地待载入预览，
          // 而非本对话框。
        } catch (e) {
          setLocalSaveErr("自动保存失败：" + String(e));
        } finally {
          setLocalSaving(false);
        }
      };
      localSaveTimerRef.current = setTimeout(() => {
        void saveLocalPaths();
      }, 600);
    }
    return () => {
      if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
    };
  }, [localPathsText, savedLocalPaths, open]);

  async function readNdjson(
    res: Response,
    onDone: (report: ParseReport | null, ok: boolean) => Promise<void> | void
  ) {
    if (!res.body) {
      void onDone(null, false);
      setError_("服务器未返回流式日志");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as ParseStreamEvent;
          if (obj.type === "log") {
            setLogs((prev) => [...prev, { level: obj.level ?? "info", msg: obj.msg ?? "" }]);
          } else if (obj.type === "done") {
            void onDone(obj.report ?? null, !!obj.ok);
          }
        } catch {
          // 忽略非 JSON 行
        }
      }
    }
  }

  function setError_(msg: string | null) {
    setSaveErr(msg);
  }

  async function onParseAll() {
    if (savedPaths.length === 0) {
      setError_("请先在上面的输入框填写至少一个目录");
      return;
    }
    setParsing(true);
    setError_(null);
    setReport(null);
    setLogs([]);
    try {
      const res = await fetch("/api/custom-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse" }),
      });
      await readNdjson(res, async (record, ok) => {
        if (ok && record) {
          setReport(record);
          await refreshCustomNodes();
        }
        await reloadFromServer();
      });
    } catch (e) {
      setError_("解析失败：" + String(e));
    } finally {
      setParsing(false);
    }
  }

  async function onParseSingle(pkgPath: string) {
    setPerPkgParsing((parsing) => ({ ...parsing, [pkgPath]: true }));
    setError_(null);
    setLogs([]);
    try {
      const res = await fetch("/api/custom-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse", packages: [pkgPath] }),
      });
      await readNdjson(res, async (record, ok) => {
        if (ok && record) {
          setReport(record);
          await refreshCustomNodes();
        }
        await reloadFromServer();
      });
    } catch (e) {
      setError_("解析失败：" + String(e));
    } finally {
      setPerPkgParsing((parsing) => {
        const np = { ...parsing };
        delete np[pkgPath];
        return np;
      });
    }
  }

  /** 一次性重新解析单个已配置父目录下的所有子包。复用同一子集解析路径，只是一次传 N
   *  个绝对路径。空/缺失目录由解析器自身容忍（记录日志并跳过）。 */
  async function onParseAllParent(parent: string) {
    const subs = discoveredByParent[parent] ?? [];
    const targets = subs.map((sub) => sub.path).filter(Boolean);
    if (targets.length === 0) {
      setError_("该目录下没有可解析的子包");
      return;
    }
    setParsing(true);
    setError_(null);
    setLogs([]);
    try {
      const res = await fetch("/api/custom-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse", packages: targets }),
      });
      await readNdjson(res, async (record, ok) => {
        if (ok && record) {
          setReport(record);
          await refreshCustomNodes();
        }
        await reloadFromServer();
      });
    } catch (e) {
      setError_("解析失败：" + String(e));
    } finally {
      setParsing(false);
    }
  }

  // 跨所有已配置父目录的扁平子包列表。一个顶层包（如 Anima-Artist-Mixer）即便用户
  // 输入的是父 custom_nodes 路径也只显示一次 —— 不渲染父卡片本身。
  // 按父目录分组，使用户能独立折叠/展开每个源目录。每个子行通过对接到 manifest 的
  // byPath 映射携带自己的 state（loaded / outdated / unimported / error / missing）。
  const parentBlocks = useMemo(() => {
    return savedPaths.map((parent) => {
      const subs = discoveredByParent[parent] ?? [];
      const enriched = subs.map((sub) => {
        const saved = byPath[pathKey(sub.path)];
        return { sub, saved, state: deriveRowState(sub, saved) };
      });
      const cnt = { loaded: 0, outdated: 0, unimported: 0, error: 0, missing: 0, empty: 0 };
      for (const e of enriched) cnt[e.state.kind] += 1;
      return { parent, subs: enriched, cnt, total: enriched.length };
    });
  }, [savedPaths, discoveredByParent, byPath]);

  const totalAcrossParents = useMemo(() => {
    return parentBlocks.reduce(
      (acc, b) => ({
        loaded: acc.loaded + b.cnt.loaded,
        outdated: acc.outdated + b.cnt.outdated,
        unimported: acc.unimported + b.cnt.unimported,
        total: acc.total + b.total,
      }),
      { loaded: 0, outdated: 0, unimported: 0, total: 0 },
    );
  }, [parentBlocks]);

  return {
    open,
    setOpen,
    tab,
    setTab,
    pathsText,
    setPathsText,
    savedPaths,
    savedAt,
    saving,
    saveErr,
    localPathsText,
    setLocalPathsText,
    savedLocalPaths,
    localSavedAt,
    localSaving,
    localSaveErr,
    loading,
    progress,
    parsing,
    perPkgParsing,
    report,
    summary,
    discoveredByParent,
    byPath,
    expandedParents,
    setExpandedParents,
    logs,
    consoleRef,
    logsRef,
    manifestByNode,
    expandedNodeList,
    setExpandedNodeList,
    nodeExpanded,
    setNodeExpanded,
    onParseAll,
    onParseSingle,
    onParseAllParent,
    parentBlocks,
    totalAcrossParents,
  };
}
