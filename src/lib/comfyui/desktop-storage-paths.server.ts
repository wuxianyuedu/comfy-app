// 桌面实例存储目录的**真实 IO 层**：读实例目录形态、extra_model_paths.yaml 与
// Comfy Desktop 元数据里的启动参数，拼成六组目录交给界面只读展示。
//
// 分层：纯解析在 `./desktop-storage-paths`（无 Node 内建，客户端可 import type），
// 这里只做「取哪份文件 + 路径拼接 + 去重 + 存在性标注」。文件缺失一律按
// 「没有这一项」处理 —— 目录清单是给用户看的参考信息，读不到不该让设置页报错。
//
// §18.4 第二类（`.server.ts`）：同一领域的服务端拆件，客户端只引纯函数那个。
import fs from "fs";
import path from "path";
import { classifyComfyInstall } from "./instance-kind";
import { resolveEffectiveLaunch } from "./desktop-instance";
import {
  classifyStorageSlot,
  normalizeDirKey,
  parseExtraModelPathsYaml,
  parseStorageDirArgs,
  type DesktopStoragePaths,
  type ExtraModelPathEntry,
  type StorageDirInfo,
  type StorageSlot,
} from "./desktop-storage-paths";

/** 依赖注入点，便于单测不碰真实磁盘。 */
export type DesktopStorageDeps = {
  exists?: (p: string) => boolean;
  readFile?: (p: string, enc: "utf8") => Promise<string>;
  /** 有效启动参数（默认走桌面元数据 → headless 映射，与本应用 spawn 时同一条路）。 */
  resolveArgs?: (comfyuiPath: string) => Promise<string[]>;
};

/** extra_model_paths.yaml 的文件名。 */
const EXTRA_PATHS_FILE = "extra_model_paths.yaml";

/**
 * ComfyUI 的 base 目录：Comfy Desktop 布局下是 `<实例根>/ComfyUI`
 * （main.py 所在目录才是进程 cwd）；配置直接指到源码根时就是它自己。
 */
function detectBaseDir(
  instanceRoot: string,
  exists: (p: string) => boolean,
): string {
  const nested = path.join(instanceRoot, "ComfyUI");
  return exists(path.join(nested, "main.py")) ? nested : instanceRoot;
}

/** yaml 的候选位置：base 目录优先（ComfyUI 从 cwd 读它），其次实例根。 */
function extraPathsCandidates(baseDir: string, instanceRoot: string): string[] {
  const candidates = [path.join(baseDir, EXTRA_PATHS_FILE)];
  if (path.resolve(instanceRoot) !== path.resolve(baseDir)) {
    candidates.push(path.join(instanceRoot, EXTRA_PATHS_FILE));
  }
  return candidates;
}

/** 读第一份存在的 extra_model_paths.yaml；都没有则 null。 */
async function readExtraPathsFile(
  candidates: string[],
  readFile: (p: string, enc: "utf8") => Promise<string>,
): Promise<{ file: string; content: string } | null> {
  for (const candidate of candidates) {
    try {
      return { file: candidate, content: await readFile(candidate, "utf8") };
    } catch {
      // 换下一个候选；全都不存在时返回 null（这不是错误：没有 yaml 就是没有共享目录）。
    }
  }
  return null;
}

/** 把一条 yaml 条目的 paths 展开成带来源的目录，并按 slot 分组。 */
function expandEntry(
  entry: ExtraModelPathEntry,
  exists: (p: string) => boolean,
): { slot: StorageSlot; dir: StorageDirInfo }[] {
  return entry.paths.map((item) => ({
    slot: classifyStorageSlot(item),
    dir: {
      path: path.resolve(entry.basePath, item),
      exists: exists(path.resolve(entry.basePath, item)),
      source: entry.key,
    },
  }));
}

/** 三组「主目录 + 共享目录」的空盘面。 */
function emptySlots(): Record<StorageSlot, StorageDirInfo[]> {
  return { models: [], input: [], output: [] };
}

/**
 * 读取桌面实例的六组存储目录。非桌面实例（便携版 / venv / 判不出形态）返回
 * null —— 本应用只在桌面实例上读 Comfy Desktop 的目录布局，其他形态的目录
 * 由各自的启动参数决定，混进来只会让界面上出现一个来源不明的路径。
 */
export async function resolveDesktopStoragePaths(
  comfyuiPath: string | null | undefined,
  deps: DesktopStorageDeps = {},
): Promise<DesktopStoragePaths | null> {
  const dir = (comfyuiPath ?? "").trim();
  if (!dir) return null;

  const exists = deps.exists ?? fs.existsSync;
  const readFile =
    deps.readFile ?? ((p: string, enc: "utf8") => fs.promises.readFile(p, enc));
  const resolveArgs =
    deps.resolveArgs ??
    (async (target: string) =>
      (
        await resolveEffectiveLaunch({
          comfyuiPath: target,
          comfyuiPort: 0,
          comfyuiExtraArgs: "",
        })
      ).extraArgs);

  const classified = classifyComfyInstall(dir, exists);
  if (classified.kind !== "desktop" || !classified.instanceRoot) return null;

  const instanceRoot = classified.instanceRoot;
  const baseDir = detectBaseDir(instanceRoot, exists);
  const extra = await readExtraPathsFile(
    extraPathsCandidates(baseDir, instanceRoot),
    readFile,
  );
  const parsed = extra
    ? parseExtraModelPathsYaml(extra.content)
    : { basePath: null, entries: [] };

  const overrides = parseStorageDirArgs(await resolveArgs(dir));
  /* 主 base 目录的优先级：启动参数 > yaml 顶层 base_path > 实例布局判据 ——
   * 与 ComfyUI 自己的取值顺序一致（它也先认命令行再认配置文件）。 */
  const primaryBase = overrides.baseDir ?? parsed.basePath ?? baseDir;

  const modelDir: StorageDirInfo = {
    path: path.join(primaryBase, "models"),
    exists: exists(path.join(primaryBase, "models")),
    source: overrides.baseDir
      ? "--base-directory"
      : parsed.basePath
        ? `${EXTRA_PATHS_FILE} base_path`
        : null,
  };
  const inputDir: StorageDirInfo = {
    path: overrides.inputDir ?? path.join(primaryBase, "input"),
    exists: exists(overrides.inputDir ?? path.join(primaryBase, "input")),
    source: overrides.inputDir ? "--input-directory" : null,
  };
  const outputDir: StorageDirInfo = {
    path: overrides.outputDir ?? path.join(primaryBase, "output"),
    exists: exists(overrides.outputDir ?? path.join(primaryBase, "output")),
    source: overrides.outputDir ? "--output-directory" : null,
  };

  /* 共享目录 = yaml 声明的额外目录；与主目录同一条的（yaml 里把 base 写成本
   * 实例自身）去掉——它不是「额外」目录，列两遍只会让人以为配了两份。 */
  const shared = emptySlots();
  const seen = new Set<string>([
    normalizeDirKey(modelDir.path),
    normalizeDirKey(inputDir.path),
    normalizeDirKey(outputDir.path),
  ]);
  for (const entry of parsed.entries) {
    for (const { slot, dir } of expandEntry(entry, exists)) {
      const key = normalizeDirKey(dir.path);
      if (seen.has(key)) continue;
      seen.add(key);
      shared[slot].push(dir);
    }
  }

  return {
    instanceRoot,
    baseDir,
    extraModelPathsFile: extra?.file ?? null,
    modelDir,
    sharedModelDirs: shared.models,
    inputDir,
    sharedInputDirs: shared.input,
    outputDir,
    sharedOutputDirs: shared.output,
  };
}
