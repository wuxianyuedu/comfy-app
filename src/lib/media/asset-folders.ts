/**
 * `asset-folders.ts` — 资产库**文件夹树**的纯派生层（规范 17 §17.2 第①层、§18.2）。
 *
 * 资产在目录里的落位真相是 `asset.subdir`（`/` 分隔的路径字符串，根级为 null）；
 * 本模块只做路径与树的纯计算：拆分 / 拼接 / 前缀匹配 / 前缀改写 / 建树 / 计数归并。
 * 不引 React、不发请求、不碰 Node API —— 服务端（router 校验）与视图层（建树渲染）
 * 共用这一份，避免「两侧各写一套路径规则」静默漂移。
 *
 * 「空目录」不落库：目录树 = 资产 subdir 的全部路径前缀 ∪ 调用方声明的空目录
 * （桌包 standalone 对已有库没有增量建表机制，目录注册表因此留在调用侧）。
 * @module media/asset-folders — 资产目录树纯派生
 */
import { isRecord, isUnknownArray } from "~/lib/is-record";

/** 目录路径的分隔符（与「加入资产库」弹窗的子目录输入口径一致）。 */
export const FOLDER_SEPARATOR = "/";

/** 目录路径总长上限（与 `asset.subdir` 列的入参上限同源：router 侧 `max(120)`）。 */
export const FOLDER_PATH_MAX = 120;

/** 单段目录名长度上限（路径 ≤120 的前提下再给名字一个独立上限，防单段超长）。 */
export const FOLDER_NAME_MAX = 60;

/** 拆路径 → 段名数组；空段（`//`、首尾分隔符）丢弃，不抛错。 */
export function splitFolderPath(path: string): Array<string> {
  return path
    .split(FOLDER_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
}

/** 单段目录名是否合法：非空、非 `.`/`..`、不含分隔符与控制字符、长度 ≤ 上限。 */
export function isValidFolderName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "..") {
    return false;
  }
  if (trimmed.length > FOLDER_NAME_MAX) {
    return false;
  }
  if (trimmed.includes(FOLDER_SEPARATOR)) {
    return false;
  }
  // 控制字符会让路径在日志 / 画布里不可见（硬规则 19 同源的理由），直接拒。
  // 逐码点判而不写正则：控制字符类正则容易触发 no-control-regex 类判据。
  for (const character of trimmed) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }
  return true;
}

/**
 * 把用户输入清洗成规范路径：按 `/` 拆段 → 逐段 trim → 丢空段（`a//b` 收敛成
 * `a/b`，首尾分隔符剥掉）→ 校验段名。任一段非法（`.` / `..` / 控制字符 /
 * 超长）或总长超限返回 null（调用方给用户可见的报错，不在这一层吞）。
 */
export function normalizeFolderPath(input: string): string | null {
  const segments = splitFolderPath(input);
  if (segments.length === 0) {
    return null;
  }
  for (const segment of segments) {
    if (!isValidFolderName(segment)) {
      return null;
    }
  }
  const joined = segments.join(FOLDER_SEPARATOR);
  if (joined.length > FOLDER_PATH_MAX) {
    return null;
  }
  return joined;
}

/** 父路径 + 子名 → 完整路径（父为 null/空串 = 挂在分类根下）。 */
export function joinFolderPath(parent: string | null | undefined, name: string): string {
  const trimmedParent = (parent ?? "").trim();
  if (trimmedParent === "") {
    return name.trim();
  }
  return `${trimmedParent}${FOLDER_SEPARATOR}${name.trim()}`;
}

/** `subdir` 是否落在 `folderPath` 里（目录本身或其任意后代）。根路径用空串表示。 */
export function isPathInFolder(subdir: string | null | undefined, folderPath: string): boolean {
  if (subdir === null || subdir === undefined || subdir === "") {
    return folderPath === "";
  }
  if (folderPath === "") {
    return true;
  }
  return subdir === folderPath || subdir.startsWith(`${folderPath}${FOLDER_SEPARATOR}`);
}

/** 一条路径的全部前缀（含自身）：`少女/活泼` → `["少女", "少女/活泼"]`。 */
export function folderPathAncestors(path: string): Array<string> {
  const segments = splitFolderPath(path);
  const prefixes: Array<string> = [];
  let current = "";
  for (const segment of segments) {
    current = current === "" ? segment : `${current}${FOLDER_SEPARATOR}${segment}`;
    prefixes.push(current);
  }
  return prefixes;
}

/**
 * 把 `path` 里的 `oldPrefix` 前缀改写成 `newPrefix`（重命名目录时改写资产落位）。
 * 不命中前缀时原样返回；`oldPrefix === newPrefix` 时原样返回。
 */
export function rewritePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (oldPrefix === newPrefix || !isPathInFolder(path, oldPrefix)) {
    return path;
  }
  if (path === oldPrefix) {
    return newPrefix;
  }
  return `${newPrefix}${path.slice(oldPrefix.length)}`;
}

/** LIKE 模式串的转义（`\` 为转义符）：`%` `_` `\` 三类，供仓储层的前缀匹配用。 */
export function escapeLikePattern(text: string): string {
  return text
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("%", String.raw`\%`)
    .replaceAll("_", String.raw`\_`);
}

/** 目录前缀的 LIKE 模式：`prefix` 本身或其任意后代（配 `ESCAPE '\'` 使用）。 */
export function likePrefixPattern(prefix: string): string {
  return `${escapeLikePattern(prefix)}${FOLDER_SEPARATOR}%`;
}

/** 树节点（`count` = 该目录及其全部后代目录的直接资产数之和）。 */
export type FolderNode = {
  children: Array<FolderNode>;
  /** 子树资产数。 */
  count: number;
  /** 层级（分类根的直接子目录为 0）。 */
  depth: number;
  /** 本段目录名（展示用）。 */
  name: string;
  /** 完整路径（相对分类根，不含分类根本身；分类根用空串表示，不进树）。 */
  path: string;
};

/** 建树入参：一条路径 + 它的直接资产数（来自按 category+subdir 的分组计数）。 */
export type FolderTreeEntry = {
  count: number;
  path: string;
};

function compareFolderNodes(a: FolderNode, b: FolderNode): number {
  return a.name.localeCompare(b.name, "zh-Hans-CN");
}

function accumulateSubtreeCount(
  node: FolderNode,
  directCounts: ReadonlyMap<string, number>,
): number {
  let total = directCounts.get(node.path) ?? 0;
  for (const child of node.children) {
    total += accumulateSubtreeCount(child, directCounts);
  }
  node.count = total;
  return total;
}

/**
 * 由「路径 → 直接资产数」建一棵目录树。同一路径重复出现时计数先归并；
 * 兄弟节点按中文名排序（`localeCompare` zh），保证刷新后树形稳定。
 */
export function buildFolderTree(entries: ReadonlyArray<FolderTreeEntry>): Array<FolderNode> {
  const directCounts = new Map<string, number>();
  for (const entry of entries) {
    const path = entry.path.trim();
    if (path === "") {
      continue;
    }
    directCounts.set(path, (directCounts.get(path) ?? 0) + entry.count);
  }

  const root: FolderNode = { path: "", name: "", count: 0, depth: -1, children: [] };
  for (const path of directCounts.keys()) {
    const segments = splitFolderPath(path);
    if (segments.length === 0) {
      continue;
    }
    let current = root;
    let currentPath = "";
    for (const [depth, name] of segments.entries()) {
      currentPath = currentPath === "" ? name : `${currentPath}${FOLDER_SEPARATOR}${name}`;
      let child = current.children.find((node) => node.name === name);
      if (child === undefined) {
        child = { path: currentPath, name, count: 0, depth, children: [] };
        current.children.push(child);
      }
      current = child;
    }
  }
  for (const child of root.children) {
    accumulateSubtreeCount(child, directCounts);
  }
  const sorted = [...root.children];
  sortFolderTree(sorted);
  return sorted;
}

function sortFolderTree(nodes: Array<FolderNode>): void {
  nodes.sort(compareFolderNodes);
  for (const node of nodes) {
    sortFolderTree(node.children);
  }
}

/** 深度优先摊平（目录选择器 / 展开默认值用），顺序与渲染顺序一致。 */
export function flattenFolderTree(nodes: ReadonlyArray<FolderNode>): Array<FolderNode> {
  const flat: Array<FolderNode> = [];
  const walk = (list: ReadonlyArray<FolderNode>) => {
    for (const node of list) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return flat;
}

/** 树里全部路径（展开默认值 / 校验目标存在性用）。 */
export function folderTreePaths(nodes: ReadonlyArray<FolderNode>): Array<string> {
  return flattenFolderTree(nodes).map((node) => node.path);
}

// ── 空目录声明（localStorage 侧的纯操作）────────────────────────────────

/** 空目录声明的存储形状：键 = `${scope}|${category}`，值 = 该维度下声明的目录路径。 */
export type FolderDeclarations = Record<string, Array<string>>;

/** 空目录声明的 localStorage 键（v1：结构变更时开新键）。 */
export const FOLDER_DECLARATIONS_KEY = "comfyapp:asset-folders:v1";

/** 声明存储的维度键。 */
export function folderDeclarationKey(scope: string, category: string): string {
  return `${scope}${FOLDER_SEPARATOR}${category}`;
}

/** 取某维度下的声明（存储缺项 / 形状不符时回落空表；localStorage 的脏数据按 unknown 收窄）。 */
export function readDeclaredPaths(declarations: unknown, key: string): Array<string> {
  if (!isRecord(declarations)) {
    return [];
  }
  const rows = declarations[key];
  if (!isUnknownArray(rows)) {
    return [];
  }
  return rows.filter((path): path is string => typeof path === "string");
}

/** 并集去重 + 按路径排序（资产派生路径 ∪ 声明路径）。 */
export function mergeFolderPaths(
  assetPaths: ReadonlyArray<string>,
  declaredPaths: ReadonlyArray<string>,
): Array<string> {
  const merged = new Set<string>();
  for (const path of assetPaths) {
    if (path.trim() !== "") {
      merged.add(path.trim());
    }
  }
  for (const path of declaredPaths) {
    if (path.trim() !== "") {
      merged.add(path.trim());
    }
  }
  return [...merged].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

/** 声明里新增一条（已存在则原样返回同一引用，避免多余写盘）。 */
export function addDeclaredPath(declaredPaths: ReadonlyArray<string>, path: string): Array<string> {
  if (declaredPaths.includes(path)) {
    return [...declaredPaths];
  }
  return [...declaredPaths, path].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

/** 声明里移除一条。 */
export function removeDeclaredPath(
  declaredPaths: ReadonlyArray<string>,
  path: string,
): Array<string> {
  return declaredPaths.filter((row) => row !== path);
}

/** 重命名目录时同步改写声明里的前缀（含把旧路径本身换成新路径）。 */
export function rewriteDeclaredPrefix(
  declaredPaths: ReadonlyArray<string>,
  oldPrefix: string,
  newPrefix: string,
): Array<string> {
  const next = declaredPaths.map((path) => rewritePathPrefix(path, oldPrefix, newPrefix));
  return [...new Set(next)].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}
