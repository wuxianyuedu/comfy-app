// ComfyUI Desktop 实例的存储目录「事实来源」解析：把 extra_model_paths.yaml
// 与启动参数读成「模型 / 共享模型 / 输入 / 共享输入 / 输出 / 共享输出」六组目录。
//
// 为什么这三处都要读（缺一就会答错）：
//   · base 目录 —— Comfy Desktop 的 canonical 布局里实例根是
//     `<安装目录>/ComfyUI2`，而 ComfyUI 真正的 base 是它下面的 `ComfyUI/`
//     （main.py 所在目录即进程 cwd）；
//   · extra_model_paths.yaml —— 共享目录（ComfyUI-Shared 那类）只在这里声明，
//     ComfyUI 启动时按它把额外目录并进各类型；
//   · 启动参数 —— `--base-directory` / `--input-directory` / `--output-directory`
//     优先于上面两者的默认值（本应用 spawn 桌面实例时用的就是这组参数）。
//
// 分层：本模块是**纯函数 + 类型**，不 import Node 内建（客户端组件可以只
// `import type` 它的类型）；真实 IO 与路径拼接在 `./desktop-storage-paths.server.ts`。
//
// 斜杠归一走 `~/lib/path-display` 的出口（规范 16 §16.2.4.60 P56）：路径展示口径
// 只有那一处，自写一份 `replace(/\\/g,"/")` 就是「同一个路径在两个面板长得不一样」。
import { normalizeSlashes } from "~/lib/path-display";

/** 一条额外目录配置（`extra_model_paths.yaml` 里除 `base_path` 外的每个顶层键）。 */
export type ExtraModelPathEntry = {
  /** YAML 里的顶层键名（Comfy Desktop 写的是 `comfyui_shared`）。 */
  key: string;
  /** 该条目的根目录。 */
  basePath: string;
  /** 该条目要并进来的相对路径列表（`models/` `input/` …）。 */
  paths: string[];
};

/** `extra_model_paths.yaml` 的解析结果。 */
export type ExtraModelPathsFile = {
  /** 顶层 `base_path:` —— ComfyUI 允许它覆盖主 base 目录；没有这一行时为 null。 */
  basePath: string | null;
  entries: ExtraModelPathEntry[];
};

/** 目录项归属哪一侧：除 input / output 外都是模型侧（ComfyUI 的真实语义）。 */
export type StorageSlot = "models" | "input" | "output";

/** 一个待展示的目录。 */
export type StorageDirInfo = {
  /** 绝对路径。 */
  path: string;
  /** 磁盘上是否存在（缺失时界面要给出提示，而不是留一串看不见的路径）。 */
  exists: boolean;
  /** 来源：extra_model_paths.yaml 的键名或启动参数名；实例自带目录为 null。 */
  source: string | null;
};

/** 桌面实例的六个目录（组）。 */
export type DesktopStoragePaths = {
  /** 实例根（ComfyUI Desktop 的安装目录，如 `ComfyUI-Installs/ComfyUI2`）。 */
  instanceRoot: string;
  /** ComfyUI 的 base 目录（Comfy Desktop 布局下即 `<实例根>/ComfyUI`）。 */
  baseDir: string;
  /** 实际读到的 extra_model_paths.yaml 路径；该文件不存在时为 null。 */
  extraModelPathsFile: string | null;
  modelDir: StorageDirInfo;
  sharedModelDirs: StorageDirInfo[];
  inputDir: StorageDirInfo;
  sharedInputDirs: StorageDirInfo[];
  outputDir: StorageDirInfo;
  sharedOutputDirs: StorageDirInfo[];
};

/** 启动参数里的目录覆盖（值都可能为 null = 未给）。 */
export type StorageDirOverrides = {
  baseDir: string | null;
  inputDir: string | null;
  outputDir: string | null;
};

/** 顶层键（无缩进）：`comfyui_shared:` 或顶层标量 `base_path: D:/x`。 */
const TOP_KEY_RE = /^([A-Za-z0-9_.-]+):\s*(.*)$/;
/** 块内字段（带缩进）：`base_path:` / `paths:` / `is_default:`。 */
const FIELD_RE = /^\s+([A-Za-z_]+):\s*(.*)$/;
/** 块内列表项：`- models/`。 */
const LIST_ITEM_RE = /^\s*-\s*(.+)$/;

/** 去掉标量值的引号；` #` 之后当注释（裸 `#` 不截断，避免砍掉路径里的字符）。 */
function stripScalar(raw: string): string {
  let value = raw.trim();
  const commentAt = value.search(/\s#/);
  if (commentAt >= 0) value = value.slice(0, commentAt).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/** 行内数组 `[models/, input/]` → `["models/", "input/"]`。 */
function parseInlineList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map(stripScalar)
    .filter((item) => item.length > 0);
}

/** 路径是否形如绝对路径（盘符 / UNC / 根斜杠）。 */
function isAbsoluteLike(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^[/\\]{1,2}/.test(value);
}

/** 目录项的第一段（`models/checkpoints` → `models`；绝对路径 → 末段）。 */
function slotHead(entry: string): string {
  const segments = normalizeSlashes(entry)
    .split("/")
    .filter((part) => part.length > 0);
  if (segments.length === 0) return "";
  return isAbsoluteLike(entry)
    ? (segments[segments.length - 1] ?? "")
    : (segments[0] ?? "");
}

/**
 * 一个额外路径项归属哪一侧：首段是 `input` / `output` 就算输入输出侧，
 * 其余（含 `models/checkpoints` 与直接写 `checkpoints`）都算模型侧 ——
 * 这正是 ComfyUI folder_paths 的实际分类，界面按它分组才不会把
 * `models/loras` 误报成「输入目录」。
 */
export function classifyStorageSlot(entry: string): StorageSlot {
  const head = slotHead(entry).toLowerCase();
  if (head === "input") return "input";
  if (head === "output") return "output";
  return "models";
}

/**
 * 解析 `extra_model_paths.yaml`（ComfyUI 的极简子集：顶层键 + `base_path`
 * + `paths` 列表）。
 *
 * 刻意不引 YAML 库：这份文件的形状由 ComfyUI 自己的写入端固定，一份通用
 * 解析器带来的转义 / 锚点 / 多文档分支在这里都到不了，纯函数反而能被
 * 逐分支钉死。容错口径：无法归属的写法跳过而不是抛错 —— 一行手改坏了不该
 * 让整页设置打不开。
 */
export function parseExtraModelPathsYaml(text: string): ExtraModelPathsFile {
  const result: ExtraModelPathsFile = { basePath: null, entries: [] };
  let current: ExtraModelPathEntry | null = null;
  let awaitingPathItems = false;
  /* 收尾一个块：没有 basePath 的条目无法定位目录，没有 paths 的条目什么都
   * 不并入 —— 两者都按 ComfyUI 的行为跳过，留在结果里只会让界面多出空行。 */
  const flush = () => {
    if (current?.basePath && current.paths.length > 0) {
      result.entries.push(current);
    }
    current = null;
    awaitingPathItems = false;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      const match = TOP_KEY_RE.exec(trimmed);
      flush();
      if (!match) continue;
      const key = match[1] ?? "";
      const value = stripScalar(match[2] ?? "");
      if (value) {
        // 顶层标量：ComfyUI 只认 `base_path` 一种（覆盖主 base 目录）。
        if (key === "base_path") result.basePath = value;
        continue;
      }
      current = { key, basePath: "", paths: [] };
      continue;
    }

    if (!current) continue;
    const item = LIST_ITEM_RE.exec(line);
    if (item && awaitingPathItems) {
      const value = stripScalar(item[1] ?? "");
      if (value) current.paths.push(value);
      continue;
    }
    const field = FIELD_RE.exec(line);
    if (!field) continue;
    const name = field[1] ?? "";
    const value = stripScalar(field[2] ?? "");
    awaitingPathItems = name === "paths" && !value;
    if (name === "base_path") current.basePath = value;
    else if (name === "paths" && value)
      current.paths.push(...parseInlineList(value));
  }

  flush();
  return result;
}

/** 目录参数名 → 覆盖字段名；只认 ComfyUI argparse 声明的三个。 */
const OVERRIDE_FLAG_TO_FIELD: Record<
  string,
  keyof StorageDirOverrides | undefined
> = {
  "--base-directory": "baseDir",
  "--input-directory": "inputDir",
  "--output-directory": "outputDir",
};

/**
 * 从启动参数里取三个目录覆盖值。支持 `--x <值>` 与 `--x=<值>` 两种写法，
 * 与 `desktop-instance.ts` 的端口解析同口径。
 */
export function parseStorageDirArgs(
  args: readonly string[],
): StorageDirOverrides {
  const overrides: StorageDirOverrides = {
    baseDir: null,
    inputDir: null,
    outputDir: null,
  };
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    const eq = token.indexOf("=");
    const flag = eq >= 0 ? token.slice(0, eq) : token;
    const field = OVERRIDE_FLAG_TO_FIELD[flag.toLowerCase()];
    if (!field) continue;
    const inlineValue = eq >= 0 ? stripScalar(token.slice(eq + 1)) : "";
    const next = args[i + 1] ?? "";
    // 下一个 token 是另一个 flag 时说明这个目录参数没给值：把它当路径会得到
    // 「D: --listen」这种根本不存在的目录，而真值只能来自 launchArgs 本身。
    const value =
      inlineValue || (next.startsWith("-") ? "" : stripScalar(next));
    if (!value) continue;
    overrides[field] = value;
    if (!inlineValue) i++;
  }
  return overrides;
}

/**
 * 目录去重键：统一分隔符、去掉尾斜杠、折叠大小写。
 *
 * 折叠大小写走的是 Windows 语义（Comfy Desktop 只在 Windows 上跑，路径不区分
 * 大小写）；它只用于「同一个目录被 yaml 与启动参数各写一遍」的合并展示，
 * 不会参与路径解析。
 */
export function normalizeDirKey(dir: string): string {
  return normalizeSlashes(dir).replace(/\/+$/, "").toLowerCase();
}
