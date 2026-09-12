/* Shared type contracts for the CustomNodesSettings dialog modules.
 * Moved verbatim from the original single-file CustomNodesSettings.tsx —
 * no behaviour change, types only. */

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
  path: string;        // absolute directory
  name: string;
  parent: string;      // absolute parent
  exists: boolean;
  isLeaf: boolean;     // true = scanned dir is itself a package (no .py with NODE_CLASS_MAPPINGS inside)
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
  /** Map: normalised absolute path (forward slashes, lowercased) → loaded SummaryPkg
   *  Lets the UI join discovered subpackages against the manifest and detect
   *  "loaded but out-of-date" using contentHash. */
  byPath: Record<string, SummaryPkg>;
}

/** Visual state derived per subpackage row from the discovered entry + the
 *  loaded manifest entry at the same path. */
export type RowState =
  | { kind: "loaded"; savedHash: string; nodeCount: number }
  | { kind: "outdated"; savedHash: string; savedNodeCount: number; diskHash: string }
  | { kind: "unimported" }
  | { kind: "error"; reason: string }
  | { kind: "missing" }
  | { kind: "empty" };

/** Two-phase parse progress, expressed in PACKAGE counts (NOT file counts):
 *   scan phase → discovered grows; total is unknown until the file walk ends.
 *   hash phase → done / total of packages processed.
 * The progress bar fill switches: indeterminate (CSS animation) during scan,
 * then snaps to a determined K/M when scan announces `total=M`. */
export type ParseProgress = {
  phase: "queue" | "scan" | "hash" | "";  // which stage we're in
  done: number;        // packages processed (only meaningful in hash phase)
  total: number;       // packages total (0 during scan until announced)
  discovered: number;  // packages discovered so far (only meaningful in scan phase)
  parent: string;      // current parent path
  msg: string;         // latest human-readable sub-message
};
