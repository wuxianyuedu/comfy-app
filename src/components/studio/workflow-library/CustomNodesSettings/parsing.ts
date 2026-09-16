/* eslint-disable @typescript-eslint/prefer-nullish-coalescing --
 * 理由（规范 §11.7 三分类法 · 第 3 类「伪建议」）：本文件比较的都是**服务端
 * 反序列化产物**（manifest / 发现结果），空串与 undefined 在此处同义（都表示
 * 「没有值」）。`??` 会把空串当成「有值」而放行，改动语义 —— 例如
 * `path.replace(...) || ""` 改 `??` 后，空串不再被兜底。因此 `||` 是刻意的
 * 语义选择，不是疏忽。 */
/* Pure helpers for the CustomNodesSettings dialog: path normalisation, row
 * state derivation, path-list parsing and misc formatting. No hooks, no JSX —
 * moved verbatim from the original single-file CustomNodesSettings.tsx. */

import type { DiscoveredSubpkg, RowState, SummaryPkg } from "./types";

export function pathKey(path: string): string {
  if (!path) return "";
  // Match server-side normalisation in route.ts: absolute → lowercased →
  // backslashes to forward slashes. This way the discover output (which carries
  // user-typed casing + native separators) joins the manifest's byPath keys
  // without Windows complaining about case.
  let normalized = path.replace(/\\/g, "/");
  // drop trailing slash for directory roots
  if (normalized.length > 1 && normalized.endsWith("/"))
    normalized = normalized.replace(/\/+$/, "");
  return normalized.toLowerCase();
}

export function deriveRowState(
  sub: DiscoveredSubpkg,
  saved: SummaryPkg | undefined,
): RowState {
  if (!sub.exists || sub.status === "missing") return { kind: "missing" };
  if (sub.status === "empty" && (sub.packageFileCount ?? 0) === 0)
    return { kind: "empty" };
  if (!saved) return { kind: "unimported" };
  if (saved.status === "error") {
    const firstErr = (saved.errors ?? [])[0] as { error?: unknown } | undefined;
    const reason =
      typeof firstErr?.error === "string" ? firstErr.error : "解析出错";
    return { kind: "error", reason };
  }
  if (saved.status === "missing") return { kind: "missing" };
  const savedHash = saved.contentHash || "";
  if (!savedHash || !sub.contentHash) {
    // No hash info on either side — treat as loaded only when status==='ok' on saved
    if (saved.status === "ok")
      return { kind: "loaded", savedHash: "", nodeCount: saved.nodeCount };
    return { kind: "unimported" };
  }
  if (savedHash === sub.contentHash) {
    return { kind: "loaded", savedHash, nodeCount: saved.nodeCount };
  }
  return {
    kind: "outdated",
    savedHash,
    savedNodeCount: saved.nodeCount,
    diskHash: sub.contentHash,
  };
}

export function nowTimeStr() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function splitPaths(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function eqArr(first: string[], second: string[]) {
  if (first.length !== second.length) return false;
  for (let i = 0; i < first.length; i++)
    if (first[i] !== second[i]) return false;
  return true;
}
