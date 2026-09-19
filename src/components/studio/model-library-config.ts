import { fmtBytes } from "~/lib/format-bytes";

// ── 工作室模型库：配置层（规范 17 §17.2 第①层）──────────────────────────────
// 行类型、纯派生（筛选 / 计数 / 体积格式化）。原先这些逻辑夹在 ModelLibrary.tsx
// 的 538 行里与 tRPC hook 混写；抽出来后可脱离 React 直接断言。

export interface ModelRow {
  id: string;
  name: string;
  type: string;
  fileName: string;
  isAvailable: boolean;
  fileSize?: number | null;
  createdAt: string;
}

/** GET /api/models/config 返回的一行（只保留本视图渲染用到的子集）。 */
export interface FolderConfigRow {
  folder: string;
  /** 目录名**就是**模型类型。 */
  type: string;
  label: string;
  enabled: boolean;
  hasConfig: boolean;
  count: number;
}

export const ALL_TYPES = "ALL";

/** 关键字 + 类型筛选：命中「名称 或 文件名（含路径）」任一即保留。 */
export function filterModels(
  models: ModelRow[],
  filter: string,
  q: string,
): ModelRow[] {
  const term = q.trim().toLowerCase();
  return models.filter((model) => {
    if (filter !== ALL_TYPES && model.type !== filter) return false;
    if (
      term &&
      !`${model.name} ${model.fileName}`.toLowerCase().includes(term)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * 按类型统计数量，按「数量降序 → 类型名字典序」排序。
 * 每个类型就是 ComfyUI 的一个目录名（目录名即类型名）。
 */
export function countByType(models: ModelRow[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const m of models) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
  return Array.from(counts.entries()).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
}

/**
 * 模型体积：B / KB / MB / GB 自动换挡；空值显示「—」。
 *
 * 走 `~/lib/format-bytes` 的唯一出口（此前这里与 `MaterialLibraryPanel` 各写
 * 一份，降档阈值还写成 `>` 与 `<` 两套 —— 1024 字节整给出不同答案）。
 *
 * **`0` 也当作「未知体积」**（沿用本模块原有语义，有用例钉住）：模型列表里
 * `fileSize` 为 0 表示尚未探到体积，显示 `0 B` 会让用户以为模型是空的。
 * `fmtBytes` 只把「非法 / 空值」判成 `null`，所以这层域语义留在调用处。
 */
export function fmtSize(n?: number | null): string {
  if (!n) return "—";
  return fmtBytes(n) ?? "—";
}

/** 目录行的关键字筛选（命中目录名或展示标签）。 */
export function filterFolders(
  folders: FolderConfigRow[],
  q: string,
): FolderConfigRow[] {
  const term = q.trim().toLowerCase();
  if (!term) return folders;
  return folders.filter((row) =>
    `${row.folder} ${row.label}`.toLowerCase().includes(term),
  );
}

/** 目录行拆成「已启用 / 可添加」两组（原组件里的两个 useMemo）。 */
export function splitFolders(
  folders: FolderConfigRow[],
  q: string,
): { enabled: FolderConfigRow[]; available: FolderConfigRow[] } {
  const matched = filterFolders(folders, q);
  return {
    enabled: matched.filter((row) => row.enabled),
    available: matched.filter((row) => !row.enabled),
  };
}
