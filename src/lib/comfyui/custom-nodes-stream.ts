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
  errors: Array<{ error: string; file: string }>;
  exists: boolean;
  name: string;
  nodeCount: number;
  nodeTypes: Array<string>;
  path: string;
  status: "ok" | "missing" | "error" | "empty";
}

export interface ParseReport {
  /** 增量解析时新增节点数（全量报告缺省为 undefined）。 */
  addedNodes?: number;
  errorCount: number;
  generatedAt: string;
  /** 增量解析报告携带的模式标记（全量报告缺省为 undefined）。 */
  mode?: "subset" | "full";
  packages: Array<PkgReport>;
  parseErrors?: Array<{ error: string; file: string }>;
  pathCount: number;
  totalNodes: number;
}

export interface DiscoveredSubpkg {
  contentHash: string;
  exists: boolean;
  fileCount: number;
  isLeaf: boolean;
  name: string;
  packageFileCount: number;
  parent: string;
  path: string;
  sizeBytes: number;
  status: "ok" | "missing" | "empty";
}

/** 清单里一个包的摘要（服务端产出、前端与 SSE 共用）。generatedAt 允许 null
 *  （清单里旧条目可能没有时间戳）。 */
export interface SummaryPkg {
  contentHash?: string;
  errors: Array<unknown>;
  generatedAt?: string | null;
  name: string;
  nodeCount: number;
  nodeTypes: Array<string>;
  parsedAt?: string | null;
  parsedFileCount?: number;
  path: string;
  status: string;
}

export interface SettingsResp {
  /** 归一化绝对路径（正斜杠、小写）→ 已加载的 SummaryPkg，让 UI 能把发现的
   *  子包与清单对齐，并用 contentHash 识别「已加载但已过期」。 */
  byPath: Record<string, SummaryPkg>;
  discoveredByParent: Record<string, Array<DiscoveredSubpkg>>;
  lastReport: ParseReport | null;
  settings: { localWorkflowPaths: Array<string>; paths: Array<string> };
  summary: {
    generatedAt: string | null;
    missingPaths: Array<string>;
    packages: Array<SummaryPkg>;
    parseErrors: Array<{ error: string; file: string }>;
    sources: Array<string>;
    totalNodes: number;
  } | null;
}

/** 设置/探测流的一行 ndjson 事件（`/api/custom-nodes` 探测端点发出）。按 `type`
 *  判别；`phase` 只取上线会出现的三态（不含 UI 初值 `""`）。 */
export type SettingsStreamEvent =
  | { parents?: Array<string>; total?: number; type: "discover_start" }
  | {
      discovered?: number;
      done?: number;
      msg?: string;
      parent?: string;
      phase?: "queue" | "scan" | "hash";
      total?: number;
      type: "progress";
    }
  | {
      cached?: boolean;
      packages?: Array<DiscoveredSubpkg>;
      parent?: string;
      type: "discover_done";
    }
  | {
      byPath?: Record<string, SummaryPkg>;
      lastReport?: ParseReport | null;
      settings?: { localWorkflowPaths: Array<string>; paths: Array<string> };
      summary?: SettingsResp["summary"];
      type: "summary";
    }
  | { message?: string; type: "error" }
  | { type: "done" };

/** 解析日志流的一行 ndjson 事件（`/api/custom-nodes` 解析端点发出）。 */
export type ParseStreamEvent =
  | { level?: string; msg?: string; type: "log" }
  | {
      /** 解析进程退出码（诊断用；进程未正常退出时为 null）。 */
      exitCode?: number | null;
      ok?: boolean;
      report?: ParseReport | null;
      /** 解析进程 stderr 摘要（失败诊断用）。 */
      stderr?: string;
      type: "done";
    };
