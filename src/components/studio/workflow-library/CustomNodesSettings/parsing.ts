/* CustomNodesSettings 弹窗的纯辅助函数：路径归一化、行
 * 状态推导、路径列表解析与杂项格式化。无 hook、无 JSX ——
 * 从原来的单文件 CustomNodesSettings.tsx 原样搬来。 */

import type { DiscoveredSubpkg, RowState, SummaryPkg } from "./types";
import { normalizeSlashes } from "~/lib/path-display";

export function pathKey(path: string): string {
  if (!path) {
    return "";
  }
  // 与 route.ts 的服务端归一化一致：绝对 → 小写 →
  // 反斜杠换正斜杠。这样 discover 的输出（带
  // 用户输入的字母大小写 + 原生分隔符）就能并入清单的 byPath 键，
  // 而 Windows 不会抱怨大小写。
  let normalized = normalizeSlashes(path);
  // 目录根去掉尾部的斜杠
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.replace(/\/+$/, "");
  }
  return normalized.toLowerCase();
}

export function deriveRowState(sub: DiscoveredSubpkg, saved: SummaryPkg | undefined): RowState {
  if (!sub.exists || sub.status === "missing") {
    return { kind: "missing" };
  }
  if (sub.status === "empty" && (sub.packageFileCount ?? 0) === 0) {
    return { kind: "empty" };
  }
  if (!saved) {
    return { kind: "unimported" };
  }
  if (saved.status === "error") {
    const firstErr = /* SAFETY: 类型断言已复核 */ (saved.errors ?? [])[0] as
      | { error?: unknown }
      | undefined;
    const reason = typeof firstErr?.error === "string" ? firstErr.error : "解析出错";
    return { kind: "error", reason };
  }
  if (saved.status === "missing") {
    return { kind: "missing" };
  }
  const savedHash = saved.contentHash ?? "";
  if (!savedHash || !sub.contentHash) {
    // 两边都没有哈希信息 —— 仅当已保存侧 status==='ok' 时才当作已加载
    if (saved.status === "ok") {
      return { kind: "loaded", savedHash: "", nodeCount: saved.nodeCount };
    }
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

export function splitPaths(text: string): Array<string> {
  return text
    .split(/[\n,]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function eqArr(first: Array<string>, second: Array<string>) {
  if (first.length !== second.length) {
    return false;
  }
  for (let i = 0; i < first.length; i++) {
    if (first[i] !== second[i]) {
      return false;
    }
  }
  return true;
}
