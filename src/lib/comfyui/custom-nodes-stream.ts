/**
 * custom-nodes 解析/探测的服务端 ↔ 前端共享协议类型。
 *
 * 这些形状由服务端（`/api/custom-nodes` 路由 + Python 解析脚本）产出、由视图层
 * `CustomNodesSettings` 消费——「谁产出、谁定义」应对称，故收在 `src/lib`（server
 * 与 view 都能安全 import 的地基），不再让视图层的 `types.ts` 兼任协议源。视图
 * `types.ts` 从此处 re-export，既有 importer 路径不变。
 *
 * 两个 ndjson 事件类型（`SettingsStreamEvent` / `ParseStreamEvent`）是**流协议的
 * 唯一契约**：服务端 `send()` 与前端消费端都按它对齐——`type` 拼错、字段漂移在
 * 发出侧即编译不过（此前服务端 `send(obj: unknown)` 与前端 interface 零约束）。
 */

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
  path: string;
  name: string;
  parent: string;
  exists: boolean;
  isLeaf: boolean;
  fileCount: number;
  packageFileCount: number;
  sizeBytes: number;
  contentHash: string;
  status: "ok" | "missing" | "empty";
}

/** 清单里一个包的摘要（服务端产出、前端与 SSE 共用）。generatedAt 允许 null
 *  （清单里旧条目可能没有时间戳）。 */
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
  generatedAt?: string | null;
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
  /** 归一化绝对路径（正斜杠、小写）→ 已加载的 SummaryPkg，让 UI 能把发现的
   *  子包与清单对齐，并用 contentHash 识别「已加载但已过期」。 */
  byPath: Record<string, SummaryPkg>;
}

/** 设置/探测流的一行 ndjson 事件（`/api/custom-nodes` 探测端点发出）。按 `type`
 *  判别；`phase` 只取上线会出现的三态（不含 UI 初值 `""`）。 */
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
      /** 解析进程退出码（诊断用；进程未正常退出时为 null）。 */
      exitCode?: number | null;
    };
