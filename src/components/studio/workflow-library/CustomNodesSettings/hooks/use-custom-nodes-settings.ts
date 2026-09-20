"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react";
import {
  refreshCustomNodes,
  getCustomNodesManifest,
  type ManifestNodeRaw,
} from "~/config/custom-nodes";
import { deriveRowState, pathKey } from "../parsing";
import { errorText } from "~/lib/error-message";
import { offsetWithin } from "~/lib/dom-rect";
import { onNextFrame } from "~/lib/next-frame";
import {
  useExpansionSet,
  type ExpansionSet,
} from "~/components/ui/expansion-set";
import type {
  DiscoveredSubpkg,
  ParseProgress,
  ParseReport,
  SettingsResp,
  SummaryPkg,
} from "../types";

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
  subs: {
    sub: DiscoveredSubpkg;
    saved: SummaryPkg | undefined;
    state: RowState;
  }[];
  cnt: {
    loaded: number;
    outdated: number;
    unimported: number;
    error: number;
    missing: number;
    empty: number;
  };
  total: number;
}

/** 自定义节点 / 本地工作流对话框的全部状态、派生数据与操作。
 *  容器与视图组件只消费这个 controller，不自己持有任何逻辑。 */
export interface CustomNodesSettingsController {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  savedPaths: string[];
  /** 目录配置相关错误（如 ComfyUI 路径未配置）。 */
  saveErr: string | null;
  loading: boolean;
  progress: ParseProgress;
  parsing: boolean;
  perPkgParsing: Record<string, boolean>;
  report: ParseReport | null;
  summary: SettingsResp["summary"];
  discoveredByParent: Record<string, DiscoveredSubpkg[]>;
  byPath: Record<string, SummaryPkg>;
  /** 父目录展开集合（`~/components/ui/expansion-set`，规范 16 §16.2.4.17）。 */
  parentExpansion: ExpansionSet;
  logs: { level: string; msg: string }[];
  consoleRef: RefObject<HTMLDivElement | null>;
  logsRef: RefObject<HTMLDivElement | null>;
  manifestByNode: Record<string, ManifestNodeRaw>;
  /** 子包「节点清单」展开集合。 */
  nodeListExpansion: ExpansionSet;
  /** 节点预览卡展开集合。 */
  nodeCardExpansion: ExpansionSet;
  onParseAll: () => Promise<void>;
  onParseSingle: (pkgPath: string) => Promise<void>;
  onParseAllParent: (parent: string) => Promise<void>;
  parentBlocks: ParentBlock[];
  totalAcrossParents: {
    loaded: number;
    outdated: number;
    unimported: number;
    total: number;
  };
}

export function useCustomNodesSettings(): CustomNodesSettingsController {
  const [open, setOpen] = useState(false);
  const [savedPaths, setSavedPaths] = useState<string[]>([]);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 进度分两阶段，均用「包数」而非「文件数」表达（shape/字段文档见 ./types.ts 的
  // ParseProgress）：scan 阶段 discovered 增长、total 未知；hash 阶段 done/total
  // 为已处理包数。进度条在 scan 期间用 CSS 动画（indeterminate），scan 宣布
  // total=M 时切换为确定的百分比。
  const [progress, setProgress] = useState<ParseProgress>({
    phase: "",
    done: 0,
    total: 0,
    discovered: 0,
    parent: "",
    msg: "",
  });
  const [parsing, setParsing] = useState(false);
  const [perPkgParsing, setPerPkgParsing] = useState<Record<string, boolean>>(
    {},
  );
  const [report, setReport] = useState<ParseReport | null>(null);
  const [summary, setSummary] = useState<SettingsResp["summary"]>(null);
  const [discoveredByParent, setDiscoveredByParent] = useState<
    Record<string, DiscoveredSubpkg[]>
  >({});
  const [byPath, setByPath] = useState<Record<string, SummaryPkg>>({});
  const parentExpansion = useExpansionSet();
  /* 只取 `seedDefaults` 出来用在 `useCallback` 里：它的引用是稳定的
   * （`useExpansionSet` 里用 `useCallback([])` 给出），而 `parentExpansion`
   * 整个对象每次渲染都换引用（它带 `map`）—— 依赖整个对象会让这个
   * `useCallback` 每轮重建，那正是它此前 `[]` 想避免的事。 */
  const { seedDefaults: seedParentDefaults } = parentExpansion;

  const [logs, setLogs] = useState<{ level: string; msg: string }[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<HTMLDivElement>(null);
  /* 卸载标记：见 fetchSettings 的 finally —— 那里有一个「让完成后提示停留
   * 800ms」的 setTimeout，它同样是一条脱离组件生命周期的链路。卸载后触发会
   * 落到已拆除的环境上（test 里表现为 React 读 window 抛
   * `ReferenceError: window is not defined`，`pnpm test` 因此随机非零退出，
   * 而用例层面全绿）。ISSUE #489。 */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 原始 manifest（classType → 完整 spec），独立于 refreshCustomNodes() 填充的
  // 注册表：即使对话框刚打开、尚无消费者调用 refresh，也能渲染预览卡片。每次解析
  // 后重新拉取，使新导入的包无需硬刷新即可显示节点。
  const [manifestByNode, setManifestByNode] = useState<
    Record<string, ManifestNodeRaw>
  >({});
  // 每个子包：内联节点列表是否展开？
  // 子包内联节点清单是否展开？
  const nodeListExpansion = useExpansionSet();
  // 每个 classType：节点预览卡是否展开显示端口+控件？默认折叠 —— 一个 146 节点的
  // 包会产生海量叶子，全展开会过度膨胀。
  const nodeCardExpansion = useExpansionSet();

  useEffect(() => {
    const stillParsing = parsing || Object.values(perPkgParsing).some(Boolean);
    if (stillParsing) {
      if (consoleRef.current)
        consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    } else if (
      logs.some((log) => log.level === "error" || log.msg.includes("✗"))
    ) {
      const idx = logs.findIndex(
        (log) => log.level === "error" || log.msg.includes("✗"),
      );
      return onNextFrame(() => {
        const console_ = consoleRef.current;
        if (!console_) return;
        const row = console_.querySelectorAll<HTMLDivElement>("[data-log-row]");
        const target = row[idx];
        if (!target) return;
        /* 相对面板自身的位置收在 `~/lib/dom-rect` 的 `offsetWithin`
         * （规范 16 §16.2.4.41）：`target.offsetTop` 量的是最近定位祖先，
         * 而本面板没有 `position:relative`，会回退到更高层的 `fixed` 包装，
         * 得到乱值 —— 正确的算式（两个 rect 相减 + 面板自身滚动偏移 + 8px
         * 留白）此前就地写在这一个文件里。 */
        const targetTop = offsetWithin(target, console_);
        if (targetTop === null) return;
        console_.scrollTop = Math.max(0, console_.scrollTop + targetTop - 8);
      });
    }
  }, [logs, parsing, perPkgParsing]);

  // 解析开始或结束时，把对话框滚到日志控制台 —— 否则高个子包列表把日志推到折叠线
  // 以下，用户得手动折叠父级才能看到。
  useEffect(() => {
    if (parsing || Object.values(perPkgParsing).some(Boolean)) {
      return onNextFrame(() => {
        logsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  }, [parsing, perPkgParsing, logs.length]);
  // 单包解析完成时也滚到日志：此刻新 report 追加、reloadFromServer() 重新填充列表。
  useEffect(() => {
    if (report && !parsing && !Object.values(perPkgParsing).some(Boolean)) {
      return onNextFrame(() => {
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
        const data = (await res.json()) as SettingsResp & {
          error?: { message?: string } | string;
        };
        /* 401 / 500 等错误响应没有 settings —— 原代码直接炸
         * `Cannot read properties of undefined (reading 'paths')`，
         * 真实原因被掩盖。这里读出服务端给的可读信息。 */
        if (!data.settings) {
          const err = data.error;
          const detail =
            typeof err === "string"
              ? err
              : (err?.message ?? `HTTP ${res.status}`);
          throw new Error(detail || `读取配置失败（HTTP ${res.status}）`);
        }
        const paths = data.settings.paths || [];
        setSavedPaths(paths);
        setSummary(data.summary);
        setReport(data.lastReport);
        setDiscoveredByParent(data.discoveredByParent || {});
        setByPath(data.byPath || {});
        /* 「补默认展开」收在 `ExpansionSet.seedDefaults`（规范 16 §16.2.4.17）：
         * 此前这段逐字抄了两遍（冷 / 热两条路径），而它承载的语义是
         * 「**已有表态的键不覆盖**」—— 用户手动收起过的目录不该在刷新后弹回来。 */
        seedParentDefaults(paths);
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
          try {
            ev = JSON.parse(line) as SettingsStreamEvent;
          } catch {
            continue;
          }
          if (ev.type === "discover_start") {
            paths.push(...(ev.parents ?? []));
            setProgress({
              phase: "queue",
              done: 0,
              total: 0,
              discovered: 0,
              parent: "",
              msg: "准备扫描…",
            });
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
              if (typeof ev.discovered === "number")
                next.discovered = ev.discovered;
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
          } else if (ev.type === "error") {
            const message =
              typeof ev.message === "string" && ev.message.length > 0
                ? ev.message
                : "未知错误";
            setSaveErr("扫描失败：" + message);
          }
        }
      }

      setSavedPaths(paths);
      setSummary(summary);
      setReport(lastReport);
      setDiscoveredByParent(discoveredByParent);
      setByPath(byPath);
      seedParentDefaults(paths);
    } catch (e) {
      setSaveErr(errorText(e, "读取配置失败"));
    } finally {
      if (!aliveRef.current) return;
      setLoading(false);
      // 保留最终进度行短暂可见，让用户看到「完成」再消失；下次重置时清除。
      setTimeout(() => {
        if (!aliveRef.current) return;
        setProgress({
          phase: "",
          done: 0,
          total: 0,
          discovered: 0,
          parent: "",
          msg: "",
        });
      }, 800);
    }
  }, [seedParentDefaults]);

  /** 重置 spinner/状态再拉取。仅从事件处理器或异步回调调用（绝不在 effect 内同步调用）。 */
  const reloadFromServer = useCallback(() => {
    setLoading(true);
    setSaveErr(null);
    setProgress({
      phase: "",
      done: 0,
      total: 0,
      discovered: 0,
      parent: "",
      msg: "",
    });
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

  async function readNdjson(
    res: Response,
    onDone: (report: ParseReport | null, ok: boolean) => Promise<void> | void,
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
            setLogs((prev) => [
              ...prev,
              { level: obj.level ?? "info", msg: obj.msg ?? "" },
            ]);
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
      setError_(
        "未找到自定义节点目录 —— 请先在设置 → 创作后端 中配置 ComfyUI 安装路径",
      );
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
      setError_(errorText(e, "解析失败"));
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
      setError_(errorText(e, "解析失败"));
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
      setError_(errorText(e, "解析失败"));
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
      const cnt = {
        loaded: 0,
        outdated: 0,
        unimported: 0,
        error: 0,
        missing: 0,
        empty: 0,
      };
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
    savedPaths,
    saveErr,
    loading,
    progress,
    parsing,
    perPkgParsing,
    report,
    summary,
    discoveredByParent,
    byPath,
    parentExpansion,
    logs,
    consoleRef,
    logsRef,
    manifestByNode,
    nodeListExpansion,
    nodeCardExpansion,
    onParseAll,
    onParseSingle,
    onParseAllParent,
    parentBlocks,
    totalAcrossParents,
  };
}
