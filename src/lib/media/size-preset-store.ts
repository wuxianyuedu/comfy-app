/* ── 尺寸预设表的持久化与订阅 ──
 *
 * 用户改过的「比例 × 分辨率」表按场景（图片 / 视频）落在 localStorage，
 * 读取时与默认表逐格合并 —— 缺行、缺档、改坏的值一律回退默认，
 * 因此升级新增比例行不需要写迁移。
 *
 * 为什么不是普通 `getItem` + 组件本地 state：同一页面上常常同时挂着好几处
 * 尺寸控件（画布节点 / 库内预览 / 表单），在配置弹窗里改一格必须让**已经挂载**
 * 的那些控件同步换值。这里用「模块级快照 + 订阅」给 `useSyncExternalStore`
 * 用，快照对象在未变更时保持引用不变。
 *
 * `src/lib/` 里读写 localStorage 并非新起法（见 `lib/project-canvas/canvas-store`），
 * 本模块只做存取与合并，不含 React。 */

import { readStorageJson, writeStorageJson } from "../browser-storage";
import {
  DEFAULT_SIZE_PRESET_TABLE,
  RESOLUTION_TIERS,
  SIZE_RATIO_PRESETS,
  type ResolutionTier,
  type SceneResolutionTable,
  type SizeDims,
  type SizePresetTable,
  type SizeScene,
} from "./size-presets";

/** localStorage 键（带版本后缀，表结构变更时换版本而不是写迁移）。 */
export const SIZE_PRESET_STORAGE_KEY = "comfyapp:size-presets:v1";

type Listener = () => void;

/** 单格宽高是否合法（正整数且在常识范围内）。 */
function isValidDims(value: unknown): value is SizeDims {
  if (!value || typeof value !== "object") return false;
  const width = (value as { width?: unknown }).width;
  const height = (value as { height?: unknown }).height;
  return (
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  );
}

/** 逐格合并：默认表打底，合法覆盖项才生效。 */
function mergeScene(
  fallback: SceneResolutionTable,
  raw: unknown,
): SceneResolutionTable {
  const out: SceneResolutionTable = {};
  for (const preset of SIZE_RATIO_PRESETS) {
    const fallbackRow = fallback[preset.label];
    const rawRow =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)[preset.label]
        : undefined;
    const row = {} as Record<ResolutionTier, SizeDims>;
    for (const tier of RESOLUTION_TIERS) {
      const candidate =
        rawRow && typeof rawRow === "object"
          ? (rawRow as Record<string, unknown>)[tier]
          : undefined;
      row[tier] = isValidDims(candidate)
        ? {
            width: Math.round(candidate.width),
            height: Math.round(candidate.height),
          }
        : { ...(fallbackRow?.[tier] ?? { width: 1024, height: 1024 }) };
    }
    out[preset.label] = row;
  }
  return out;
}

function mergeTable(raw: unknown): SizePresetTable {
  const record =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    image: mergeScene(DEFAULT_SIZE_PRESET_TABLE.image, record.image),
    video: mergeScene(DEFAULT_SIZE_PRESET_TABLE.video, record.video),
  };
}

function readStored(): SizePresetTable {
  /* 存储不可用 / JSON 损坏 / SSR：一律按默认表走，不影响生成 ——
   * 三条判据收在 `~/lib/browser-storage`（§16.2.4.28）。 */
  return mergeTable(
    readStorageJson<unknown>(SIZE_PRESET_STORAGE_KEY, null, (raw) =>
      JSON.parse(raw),
    ),
  );
}

let snapshot: SizePresetTable = readStored();
const listeners = new Set<Listener>();

/** 当前生效的尺寸表（引用稳定，可直接喂给 `useSyncExternalStore`）。 */
export function getSizePresetTable(): SizePresetTable {
  return snapshot;
}

/** 服务端渲染快照：localStorage 不可读，一律给默认表。 */
export function getSizePresetServerSnapshot(): SizePresetTable {
  return DEFAULT_SIZE_PRESET_TABLE;
}

export function subscribeSizePresetTable(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: SizePresetTable): void {
  snapshot = next;
  /* 存储不可用（配额满 / 隐私模式）静默：本次会话内仍然生效。 */
  writeStorageJson(SIZE_PRESET_STORAGE_KEY, next);
  for (const listener of listeners) listener();
}

/** 改一格（场景 + 比例行 + 分辨率档）。 */
export function setSizePresetDims(
  scene: SizeScene,
  ratioLabel: string,
  tier: ResolutionTier,
  size: SizeDims,
): void {
  const row = snapshot[scene]?.[ratioLabel];
  if (!row) return;
  const nextScene: SceneResolutionTable = {
    ...snapshot[scene],
    [ratioLabel]: {
      ...row,
      [tier]: { width: size.width, height: size.height },
    },
  };
  commit(
    scene === "image"
      ? { ...snapshot, image: nextScene }
      : { ...snapshot, video: nextScene },
  );
}

/** 把某个场景整表恢复默认（另一个场景不受影响）。 */
export function resetSizePresetScene(scene: SizeScene): void {
  const fresh = mergeTable(null);
  commit(
    scene === "image"
      ? { ...snapshot, image: fresh.image }
      : { ...snapshot, video: fresh.video },
  );
}
