import { fmtBytes } from "~/lib/format-bytes";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";
import { compareText } from "~/lib/ordered-set";
import { displayValue } from "~/lib/display-value";
import { folderMeta } from "~/lib/model-types";

// ── 工作室模型库：配置层（规范 17 §17.2 第①层）──────────────────────────────
// 行类型、纯派生（按目录分组 / 筛选 / 体积格式化）——与 tRPC hook 分开，
// 可脱离 React 直接断言。

export type ModelRow = {
  fileName: string;
  fileSize?: number | null;
  id: string;
  isAvailable: boolean;
  name: string;
  type: string;
};

/** 左侧目录列的一行：目录名**就是**模型类型，数量由已同步的模型派生。 */
export type ModelFolder = {
  count: number;
  label: string;
  type: string;
};

/**
 * 按当前目录 + 关键字筛选。目录为 `null` 时表示不限制目录。
 * 可搜字段是本域的判据（名称 + 文件名，搜 `model.safetensors` 也能中），
 * 归一化与命中判决走 `~/lib/list-filter`（规范 16 §16.2.4.16）。
 */
export function filterModels(
  models: Array<ModelRow>,
  folder: string | null,
  q: string,
): Array<ModelRow> {
  const term = normalizeNeedle(q);
  return models.filter((model) => {
    if (folder !== null && model.type !== folder) {
      return false;
    }
    return matchesNeedle(term, `${model.name} ${model.fileName}`);
  });
}

/**
 * 按类型统计数量，按「数量降序 → 类型名字典序」排序。
 * 每个类型就是 ComfyUI 的一个目录名（目录名即类型名）。
 */
export function countByType(models: Array<ModelRow>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const m of models) {
    counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    /* 数量降序 → 类型名字典序；「按当前区域设置排序」走 `~/lib/ordered-set`
     *（规范 16 §16.2.4.55）。 */
    (left, right) => right[1] - left[1] || compareText(left[0], right[0]),
  );
}

/** 由已同步的模型派生左侧目录列（只列有模型的目录）。 */
export function foldersOf(models: Array<ModelRow>): Array<ModelFolder> {
  return countByType(models).map(([type, count]) => ({
    type,
    label: folderMeta(type).label,
    count,
  }));
}

/**
 * 模型体积：B / KB / MB / GB 自动换挡；空值显示「—」。走 `~/lib/format-bytes` 唯一出口（此前两处各写一份、
 * 阈值 `>` 与 `<` 两套，1024 字节整给出不同答案）。**`0` 也当「未知体积」**（有用例钉住）：`fileSize` 为 0
 * 表示尚未探到体积，显示 `0 B` 会让用户以为模型是空的；`fmtBytes` 只把非法 / 空值判 `null`，故域语义留调用处。
 */
export function fmtSize(n?: number | null): string {
  /* `0` 是**本域的**「尚未探到体积」，不是「缺值」 —— 这层语义必须显式写在
   * 这里（`displayValue` 会把 0 照常显示成 "0"，那对模型列表是误导）。
   * 占位符本身不在这里拼，走全库唯一出口。 */
  if (n === undefined || n === null || n === 0 || Number.isNaN(n)) {
    return displayValue(null);
  }
  return displayValue(fmtBytes(n));
}
