/**
 * `asset-categories.ts` — 资产库的**纯派生层**（规范 17 §17.2 第①层）：
 * 分类 / 归属的键 ↔ 展示名、详情参数表的可读化。不引 React、不发请求。
 * @module studio/assets/asset-categories — 资产库纯派生
 */
import { isRecord } from "~/lib/is-record";

/** 资产分类（与 ardot 设计稿一致的四类媒体 + 三类用途，键即 `asset.category`）。 */
export const ASSET_CATEGORIES = [
  { key: "reference", label: "参考素材" },
  { key: "scene", label: "场景" },
  { key: "storyboard", label: "分镜" },
  { key: "style", label: "风格" },
  { key: "character", label: "角色" },
  { key: "document", label: "文档" },
  { key: "music", label: "音乐" },
] as const;

export type AssetCategoryKey = (typeof ASSET_CATEGORIES)[number]["key"];

/** 分类键 → 展示名；未登记的键原样返回（新分类先可见再补名）。 */
export function assetCategoryLabel(key: string): string {
  return ASSET_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

/** 归属两档（`asset.scope`）。 */
export const ASSET_SCOPES = [
  { key: "public", label: "公共资产", hint: "团队共享，所有项目可引用" },
  { key: "project", label: "项目资产", hint: "仅所选项目内可用" },
] as const;

export type AssetScopeKey = (typeof ASSET_SCOPES)[number]["key"];

export function assetScopeLabel(key: string): string {
  return ASSET_SCOPES.find((s) => s.key === key)?.label ?? key;
}

/** 运行时守卫：RadioGroup 等字符串出口收敛回两档键。 */
export function isAssetScopeKey(value: string): value is AssetScopeKey {
  return ASSET_SCOPES.some((s) => s.key === value);
}

/** 详情参数表的行（键已译成可读名）。 */
export type AssetParamRow = { label: string; value: string };

/** 参数键 → 可读名（优先命中；其余键原样展示，不编名字）。 */
const PARAM_LABELS: ReadonlyArray<[RegExp, string]> = [
  [/^(?:checkpoint|model)$/i, "模型"],
  [/^prompt$/i, "提示词"],
  [/^negative[_ ]?prompt$/i, "负向提示词"],
  [/^(?:sampler|sampler[_ ]?name)$/i, "采样器"],
  [/^steps$/i, "步数"],
  [/^cfg(?:_scale)?$/i, "CFG"],
  [/^seed$/i, "种子"],
  [/^(?:width|height|size|aspect[_ ]?ratio|megapixels)$/i, "尺寸"],
];

function paramLabelOf(key: string): string {
  for (const [pattern, label] of PARAM_LABELS) {
    if (pattern.test(key)) {
      return label;
    }
  }
  return key;
}

function paramValueText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * 把参数快照折成详情弹窗的行：已知键按可读名排前，其余键保持原键名跟在后面；
 * 值一律转字符串（对象 / 数组 JSON 化，不截断——弹窗内自行滚动）。
 * `workflowName` 单独给（它不在 params 里）。
 */
export function deriveAssetParamRows(
  params: unknown,
  extra?: { workflowName?: string | null },
): Array<AssetParamRow> {
  const rows: Array<AssetParamRow> = [];
  const seen = new Set<string>();
  const push = (label: string, value: unknown) => {
    const text = paramValueText(value);
    if (text === "") {
      return;
    }
    rows.push({ label, value: text });
    seen.add(label);
  };
  if (extra?.workflowName) {
    push("工作流", extra.workflowName);
  }
  if (isRecord(params)) {
    for (const [pattern, label] of PARAM_LABELS) {
      for (const key of Object.keys(params)) {
        if (pattern.test(key) && !seen.has(label)) {
          push(label, params[key]);
        }
      }
    }
    for (const key of Object.keys(params)) {
      const label = paramLabelOf(key);
      if (!seen.has(label)) {
        push(label, params[key]);
      }
    }
  }
  return rows;
}

/** 网格列宽三档（大小滑块的档位）：值是 `minmax` 的列宽下限（px）。 */
export const ASSET_SIZE_PRESETS = {
  large: { key: "large", label: "大图", columns: 2, minWidth: 420 },
  standard: { key: "standard", label: "标准", columns: 4, minWidth: 260 },
  small: { key: "small", label: "小图", columns: 6, minWidth: 170 },
} as const;

export type AssetSizeKey = keyof typeof ASSET_SIZE_PRESETS;

export function isAssetSizeKey(value: string): value is AssetSizeKey {
  return value in ASSET_SIZE_PRESETS;
}
