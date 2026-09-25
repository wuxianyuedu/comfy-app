/* CustomNodesSettings 弹窗各模块共享的类型契约。
 * 从原来的单文件 CustomNodesSettings.tsx 原样搬来 ——
 * 无行为变化，只有类型。 */

export interface PkgReport {
  path: string;
  name: string;
  exists: boolean;
  status: "ok" | "missing" | "error" | "empty";
  nodeCount: number;
  nodeTypes: string[];
  errors: { file: string; error: string }[];
}

export interface ParseReport {
  generatedAt: string;
  totalNodes: number;
  pathCount: number;
  errorCount: number;
  packages: PkgReport[];
  parseErrors?: { file: string; error: string }[];
  /** 增量解析报告携带的模式标记（全量报告缺省为 undefined）。 */
  mode?: "subset" | "full";
  /** 增量解析时新增节点数（全量报告缺省为 undefined）。 */
  addedNodes?: number;
}

export interface DiscoveredSubpkg {
  path: string; // absolute directory
  name: string;
  parent: string; // absolute parent
  exists: boolean;
  isLeaf: boolean; // true = scanned dir is itself a package (no .py with NODE_CLASS_MAPPINGS inside)
  fileCount: number;
  packageFileCount: number;
  sizeBytes: number;
  contentHash: string;
  status: "ok" | "missing" | "empty";
}

export interface SummaryPkg {
  name: string;
  path: string;
  status: string;
  nodeCount: number;
  nodeTypes: string[];
  errors: unknown[];
  contentHash?: string;
  parsedAt?: string | null;
  parsedFileCount?: number;
  generatedAt?: string;
}

export interface SettingsResp {
  settings: { paths: string[]; localWorkflowPaths: string[] };
  summary: {
    generatedAt: string | null;
    totalNodes: number;
    packages: SummaryPkg[];
    missingPaths: string[];
    parseErrors: { file: string; error: string }[];
    sources: string[];
  } | null;
  lastReport: ParseReport | null;
  discoveredByParent: Record<string, DiscoveredSubpkg[]>;
  /** 映射：归一化绝对路径（正斜杠、小写）→ 已加载的 SummaryPkg
   *  让 UI 能把发现的子包与清单对齐，并用 contentHash 识别
   *  「已加载但已过期」。 */
  byPath: Record<string, SummaryPkg>;
}

/** 每个子包行由发现的条目 + 同路径上已加载的清单
 *  条目共同推导出的视觉状态。 */
export type RowState =
  | { kind: "loaded"; savedHash: string; nodeCount: number }
  | {
      kind: "outdated";
      savedHash: string;
      savedNodeCount: number;
      diskHash: string;
    }
  | { kind: "unimported" }
  | { kind: "error"; reason: string }
  | { kind: "missing" }
  | { kind: "empty" };

/** 两阶段解析进度，以**包**计数表示（**不是**文件数）：
 *   扫描阶段 → discovered 增长；文件遍历结束前总数未知。
 *   哈希阶段 → 已处理 / 总包数。
 * 进度条填充会切换：扫描期间不确定（CSS 动画），
 * 然后当扫描宣布 `total=M` 时跳到确定的 K/M。 */
export type ParseProgress = {
  phase: "queue" | "scan" | "hash" | ""; // which stage we're in
  done: number; // packages processed (only meaningful in hash phase)
  total: number; // packages total (0 during scan until announced)
  discovered: number; // packages discovered so far (only meaningful in scan phase)
  parent: string; // current parent path
  msg: string; // latest human-readable sub-message
};

/** 设置/探测流的一行 ndjson 事件（`/api/custom-nodes` 探测端点发出）。
 *  按 `type` 判别，消费端 switch 收窄——不再是「全可选字段袋 + 逐字段
 *  `typeof` 守卫」（那会让拼错的 `type` 静默通过、字段类型全靠运行时判）。
 *  `phase` 只取上线会出现的三态，不含 UI 初值 `""`。 */
export type SettingsStreamEvent =
  | { type: "discover_start"; parents?: string[]; total?: number }
  | {
      type: "progress";
      parent?: string;
      phase?: "queue" | "scan" | "hash";
      msg?: string;
      discovered?: number;
      total?: number;
      done?: number;
    }
  | {
      type: "discover_done";
      parent?: string;
      packages?: DiscoveredSubpkg[];
      cached?: boolean;
    }
  | {
      type: "summary";
      summary?: SettingsResp["summary"];
      lastReport?: ParseReport | null;
      byPath?: Record<string, SummaryPkg>;
      settings?: { paths: string[]; localWorkflowPaths: string[] };
    }
  | { type: "error"; message?: string }
  | { type: "done" };

/** 解析日志流的一行 ndjson 事件（`/api/custom-nodes` 解析端点发出）。 */
export type ParseStreamEvent =
  | { type: "log"; level?: string; msg?: string }
  | {
      type: "done";
      report?: ParseReport | null;
      ok?: boolean;
      /** 解析进程 stderr 摘要（失败诊断用）。 */
      stderr?: string;
      /** 解析进程退出码（诊断用）。 */
      exitCode?: number;
    };
