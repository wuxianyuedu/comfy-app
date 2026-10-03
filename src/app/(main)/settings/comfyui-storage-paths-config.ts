// 「实例目录（只读）」这张卡片的行数据组装（规范 17 §17.2 第①层：纯派生）。
//
// 为什么单独成文件：六组目录的标签、来源标注与空组判定是**口径**，不是 JSX ——
// 「主目录被启动参数覆盖了」这件事只写在 `source` 里，界面上要显示成一句人话；
// 口径散进组件后就只能靠渲染快照看着它对不对。

import type {
  DesktopStoragePaths,
  StorageDirInfo,
} from "~/lib/comfyui/desktop-storage-paths";

/** 一行 = 一个标签 + 它对应的目录列表（共享组可能多条）。 */
export type StoragePathRow = {
  key: string;
  label: string;
  /** 目录被启动参数或 yaml 顶层 base_path 覆盖时的来源标注；否则 null。 */
  source: string | null;
  dirs: StorageDirInfo[];
};

/** 六组目录的标签与顺序（模型 → 共享模型 → 输入 → 共享输入 → 输出 → 共享输出）。 */
const ROW_SPECS = [
  { key: "models", label: "模型目录", shared: false },
  { key: "models", label: "共享模型目录", shared: true },
  { key: "input", label: "输入目录", shared: false },
  { key: "input", label: "共享输入目录", shared: true },
  { key: "output", label: "输出目录", shared: false },
  { key: "output", label: "共享输出目录", shared: true },
] as const;

/** 把六组目录摊平成界面行；共享组为空时给空数组（组件渲染「未配置」而不是不显示）。 */
export function buildStorageRows(
  storage: DesktopStoragePaths,
): StoragePathRow[] {
  const slots: Record<
    (typeof ROW_SPECS)[number]["key"],
    { primary: StorageDirInfo; shared: StorageDirInfo[] }
  > = {
    models: { primary: storage.modelDir, shared: storage.sharedModelDirs },
    input: { primary: storage.inputDir, shared: storage.sharedInputDirs },
    output: { primary: storage.outputDir, shared: storage.sharedOutputDirs },
  };
  return ROW_SPECS.map((spec) => {
    const slot = slots[spec.key];
    const dir = spec.shared ? null : slot.primary;
    return {
      key: `${spec.key}-${spec.shared ? "shared" : "primary"}`,
      label: spec.label,
      source: dir?.source ?? null,
      dirs: spec.shared ? slot.shared : [slot.primary],
    };
  });
}

/**
 * 卡片底部的一句话来源说明。
 *
 * 「这些目录是从哪读来的」必须写出来：共享目录来自 `extra_model_paths.yaml`，
 * 而主目录可能被启动参数改过 —— 不说清的话用户会以为看到的六条都是 ComfyUI
 * 自己算出来的默认值。
 */
export function describeStorageHint(storage: DesktopStoragePaths): string {
  const fromYaml = storage.extraModelPathsFile
    ? `共享目录来自 ${storage.extraModelPathsFile}`
    : "该实例没有 extra_model_paths.yaml（未配置额外目录）";
  return (
    `只读：实例根 ${storage.instanceRoot}；${fromYaml}。` +
    "主目录可被启动参数（--base-directory 等）覆盖。修改请在 ComfyUI Desktop 里进行。"
  );
}
