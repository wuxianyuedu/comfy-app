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
  /** The directory name IS the model type. */
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

/** 模型体积：B / KB / MB / GB 自动换挡；空值显示「—」。 */
export function fmtSize(n?: number | null): string {
  if (!n) return "—";
  if (n > 1024 * 1024 * 1024)
    return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
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
