/* ── 尺寸预设表的持久化与订阅 ──
 *
 * 用户改过的「比例 × 分辨率」表按场景（图片 / 视频）落在本机应用数据
 * （`data/size-presets.json`，经 `/api/size-presets` 读写，ISSUE #3788），
 * 读取时与项目默认表（`size-presets.ts` 的 `DEFAULT_SIZE_PRESET_TABLE`，跟代码走）
 * 逐格合并 —— 缺行、缺档、改坏的值一律回退默认，升级新增比例行不需要写迁移。
 *
 * 为什么不是普通 `getItem` + 组件本地 state：同一页面上常常同时挂着好几处
 * 尺寸控件（画布节点 / 库内预览 / 表单），在配置弹窗里改一格必须让**已经挂载**
 * 的那些控件同步换值。这里用「模块级快照 + 订阅」给 `useSyncExternalStore`
 * 用，快照对象在未变更时保持引用不变。
 *
 * 历史形态：这张表此前落浏览器 localStorage（不随机器迁移、清浏览器数据就丢），
 * 现改为应用数据文件；启动时把旧键里还留着的自定义表迁移到应用数据（一次性）。
 *
 * `src/lib/` 里发请求并非新起法（见 `lib/log/log-file-client` 的运行时日志上报），
 * 本模块只做存取与合并，不含 React。 */

import {
  DEFAULT_SIZE_PRESET_TABLE,
  mergeSizePresetTable,
  type ResolutionTier,
  type SizeDims,
  type SizePresetTable,
  type SizeScene,
} from "./size-presets";

/** 旧 localStorage 键（迁移源：历史版本把这张表存在浏览器里）。 */
export const SIZE_PRESET_LEGACY_STORAGE_KEY = "comfyapp:size-presets:v1";

/** 本机覆盖在服务端的落点（应用数据文件，经 `/api/size-presets` 读写）。 */
const SIZE_PRESETS_ENDPOINT = "/api/size-presets";

export type Listener = () => void;

/* ── 模块状态：快照 + 订阅者 + 水合进度 ── */
let snapshot: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE;
const listeners = new Set<Listener>();
let hydrateStarted = false;
let hydrated = false;
let dirtyWhileHydrating = false;

/** 当前生效的尺寸表（引用稳定，可直接喂给 `useSyncExternalStore`）。 */
export function getSizePresetTable(): SizePresetTable {
  return snapshot;
}

/** 服务端渲染快照：水合前一律给默认表。 */
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
  for (const listener of listeners) {
    listener();
  }
  /* 服务端尚未就绪（首屏水合还没回来）时先把本地改动态记下，水合完成后补传 ——
     否则早于水合的一次改动会用「默认表 + 这一处」把用户已存的覆盖冲掉。 */
  if (hydrated) {
    void persist(next);
  } else {
    dirtyWhileHydrating = true;
  }
}

async function persist(table: SizePresetTable): Promise<void> {
  try {
    const response = await fetch(SIZE_PRESETS_ENDPOINT, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(table),
    });
    if (!response.ok) {
      console.error(`尺寸配置表保存失败（HTTP ${response.status}）`);
    }
  } catch (error) {
    console.error("尺寸配置表保存失败", error);
  }
}

/**
 * 启动时从服务端水合尺寸表（ISSUE #3788）：读应用数据里的本机覆盖，并把
 * 旧 localStorage 键里还留着的自定义表一次性迁移过来（旧键随后清除）。
 * 幂等：重复调用只水合一次。
 */
export async function hydrateSizePresetsFromServer(): Promise<void> {
  if (typeof window === "undefined" || typeof fetch === "undefined" || hydrateStarted) {
    return;
  }
  hydrateStarted = true;
  let serverTable: SizePresetTable | null = null;
  try {
    const response = await fetch(SIZE_PRESETS_ENDPOINT);
    if (response.ok) {
      serverTable = mergeSizePresetTable(await response.json());
    }
  } catch {
    /* 服务端读不到（应用服务未起等）：保持默认表，不影响生成。 */
  }
  /* 旧键迁移：浏览器里还留着的自定义表比「服务端没有覆盖」要新 —— 用它压一格。 */
  let legacyTable: SizePresetTable | null = null;
  try {
    const raw = window.localStorage.getItem(SIZE_PRESET_LEGACY_STORAGE_KEY);
    if (raw) {
      legacyTable = mergeSizePresetTable(JSON.parse(raw));
    }
  } catch {
    /* 旧键损坏按没有处理。 */
  }
  const effective = legacyTable ?? serverTable ?? DEFAULT_SIZE_PRESET_TABLE;
  /* 水合前若已有本地改动（早于引导水合的极端窗口），以本检出的改动为准合并，
     免得那次改动被水合值悄悄冲掉。 */
  const pending = dirtyWhileHydrating ? snapshot : null;
  const merged = pending === null ? effective : mergeSizePresetTable({ ...effective, ...pending });
  hydrated = true;
  dirtyWhileHydrating = false;
  commit(merged);
  if (legacyTable !== null) {
    try {
      window.localStorage.removeItem(SIZE_PRESET_LEGACY_STORAGE_KEY);
    } catch {
      /* 清不掉就算了：下次启动还会尝试迁移（幂等）。 */
    }
  }
}

/** 改一格（场景 + 比例行 + 分辨率档）。 */
export function setSizePresetDims(
  scene: SizeScene,
  ratioLabel: string,
  tier: ResolutionTier,
  size: SizeDims,
): void {
  const row = snapshot[scene][ratioLabel];
  if (!row) {
    return;
  }
  const nextScene: SizePresetTable["image"] = {
    ...snapshot[scene],
    [ratioLabel]: {
      ...row,
      [tier]: { width: size.width, height: size.height },
    },
  };
  commit(scene === "image" ? { ...snapshot, image: nextScene } : { ...snapshot, video: nextScene });
}

/** 把某个场景整表恢复默认（另一个场景不受影响）。 */
export function resetSizePresetScene(scene: SizeScene): void {
  const fresh = mergeSizePresetTable(null);
  commit(
    scene === "image" ? { ...snapshot, image: fresh.image } : { ...snapshot, video: fresh.video },
  );
}
