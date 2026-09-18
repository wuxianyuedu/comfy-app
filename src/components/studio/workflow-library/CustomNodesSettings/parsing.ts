/* eslint-disable @typescript-eslint/prefer-nullish-coalescing --
 * 理由（规范 §11.7 三分类法 · 第 3 类「伪建议」）：本文件比较的都是**服务端
 * 反序列化产物**（manifest / 发现结果），空串与 undefined 在此处同义（都表示
 * 「没有值」）。`??` 会把空串当成「有值」而放行，改动语义 —— 例如
 * `path.replace(...) || ""` 改 `??` 后，空串不再被兜底。因此 `||` 是刻意的
 * 语义选择，不是疏忽。 */
/* CustomNodesSettings 弹窗的纯辅助函数：路径归一化、行
 * 状态推导、路径列表解析与杂项格式化。无 hook、无 JSX ——
 * 从原来的单文件 CustomNodesSettings.tsx 原样搬来。 */

import type { DiscoveredSubpkg, RowState, SummaryPkg } from "./types";

export function pathKey(path: string): string {
  if (!path) return "";
  // 与 route.ts 的服务端归一化一致：绝对 → 小写 →
  // 反斜杠换正斜杠。这样 discover 的输出（带
  // 用户输入的字母大小写 + 原生分隔符）就能并入清单的 byPath 键，
  // 而 Windows 不会抱怨大小写。
  let normalized = path.replace(/\\/g, "/");
  // 目录根去掉尾部的斜杠
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
    // 两边都没有哈希信息 —— 仅当已保存侧 status==='ok' 时才当作已加载
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
