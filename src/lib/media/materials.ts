/* ── 素材库（Material Library）─────────────────────────────────
 * 画布「素材库」面板的服务端支撑层。
 *
 * 存储选型：文件系统而非 Prisma 表。理由：
 *   1. 素材本质就是文件（参考图 / 分镜 / 文档 / 音乐），元数据几乎全部
 *      可从 stat + 扩展名推导，加一张表只是给文件做影子索引，反而要处理
 *      「表里有行、磁盘没文件」的不一致。
 *   2. 用户可以直接把文件丢进目录，无需经过上传接口，素材库自动可见。
 *   3. 避免一次 Prisma migration —— 本机 dev server 的 DATABASE_URL 指向
 *      临时库，改 schema 需要冷重启，风险与收益不成比例。
 *
 * 落点：generated/materials/{scopeDir}/{folderId}/{fileName}
 *   scopeDir = 画布项目 id（localStorage 里的 `proj_...`），或 SHARED_SCOPE
 *   经 /api/generated/[...path] 提供读取，浏览器可直接引用。
 */

import "server-only";

import { compareText } from "~/lib/ordered-set";
import { getOrCreate } from "~/lib/collections";
import { projectRepository } from "~/lib/core/repository-project";
import { lastSegments } from "~/lib/path-display";
import {
  artifactUrl,
  isWithinGeneratedRoot,
  materialsRoot as artifactMaterialsRoot,
} from "~/lib/media/output-paths";
import { promises as fs } from "fs";
import path from "path";

import { kindOf, type MediaKind } from "./media-kind";

/** 跨项目共享素材的 scope 目录名（下划线前缀，不会与 `proj_...` 冲突）。 */
export const SHARED_SCOPE = "_shared";

/** 固定分类目录。id 用于磁盘目录名与 API 参数，name 是面板展示名。 */
export const MATERIAL_FOLDERS = [
  { id: "ref", name: "参考素材" },
  { id: "scenes", name: "场景" },
  { id: "storyboard", name: "分镜" },
  { id: "styles", name: "风格" },
  { id: "characters", name: "角色" },
  { id: "docs", name: "文档" },
  { id: "music", name: "音乐" },
] as const;

export type MaterialFolderId = (typeof MATERIAL_FOLDERS)[number]["id"];

const FOLDER_IDS = new Set<string>(MATERIAL_FOLDERS.map((folder) => folder.id));

export function isValidFolder(
  id: string | null | undefined,
): id is MaterialFolderId {
  return !!id && FOLDER_IDS.has(id);
}

export function folderName(id: string): string {
  return MATERIAL_FOLDERS.find((folder) => folder.id === id)?.name ?? id;
}

/* ── 媒体种类推导 ── */

/* 扩展名判据已收敛到 `media-kind.ts`（ISSUE #571）：此前这里与
 * `lib/media.ts`、`server/api/routers/task.ts` 各有一份**互相不同**的清单
 * （本文件无 ogg/m4v、task router 把 gif 算成视频），同一文件在三处得到三种
 * 结论。这里只保留一个与既有类型名对齐的别名，判据不再复制。 */
export type MaterialKind = MediaKind;

export function inferKind(fileName: string): MaterialKind {
  return kindOf(fileName);
}

/* ── 路径安全 ── */

/** 素材库根目录（产物根下的 `materials/` 子层；根的定义在 `output-paths`，
 *  这里只加自己那一层，不再重抄一遍 `public/generated`）。 */
export function materialsRoot(): string {
  return artifactMaterialsRoot();
}

/**
 * scope 目录名白名单化。只允许字母数字、下划线、连字符——画布项目 id 形如
 * `proj_1755...`，天然满足；任何含分隔符或 `..` 的输入直接拒绝，
 * 从源头上掐死路径穿越。
 */
export function sanitizeScope(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return s;
}

/**
 * 文件名白名单化：剥掉所有目录成分，再替换掉在 Windows/POSIX 上有特殊含义
 * 的字符。返回 null 表示该名字不可用。
 */
export function sanitizeFileName(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  // 同时按两种分隔符切，避免 Windows 上 "a/b\\c.png" 漏网
  const base = lastSegments(raw, 1).trim();
  if (!base || base === "." || base === "..") return null;
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, "_");
  if (!cleaned || cleaned.length > 200) return null;
  return cleaned;
}

/** 拼出 scope/folder 的绝对目录，并断言它仍在素材库根之内。
 *  包含判据用 `output-paths` 那一份（`path.sep` 收边界）—— 这一句此前是同一
 *  判据的第二份实现，「同级 `materialsX` 也算在内」那种错法只差一个字。 */
export function folderDir(scope: string, folder: string): string | null {
  const root = materialsRoot();
  const dir = path.join(root, scope, folder);
  return isWithinGeneratedRoot(dir, root) ? dir : null;
}

/* ── 归属 ────────────────────────────────────────────────────────────────
 * 素材按 scope 分片存磁盘，而 scope **就是画布项目 id** —— 目录名本身就是别人的
 * 项目 id。不判归属就有两条越权路：
 *   ① `scope=cross` 的旧写法直接返回 `listScopes()`，等于把「本机都有哪些项目」
 *      当成一份可枚举清单交出去，再顺着它翻每个项目的素材；
 *   ② 把别人的 projectId 填进任意一个参数，读写那一格。
 * 这一族与台账 A2 / A3 是同一件事（id 由客户端生成、可以被抄），所以口径也照搬：
 * **越权与不存在必须同形**，不给探测项目 id 用。
 *
 * 结论是三态而不是两态：
 *   · `mine` —— 库里这一行的 userId 就是请求者；
 *   · `foreign` —— 明确属于别人，一律按「看不见 / 不可写」处置；
 *   · `unclaimed` —— 共享区，或库里还没有这一行。后者不是漏洞而是正常路径：画布 id
 *     由客户端生成、向服务端的镜像是尽力而为（离线时错误被吞掉），把「还没同步上来
 *     的新项目」判成不可写会直接堵死上传素材这条路。 */
export type MaterialScopeOwnership = "mine" | "foreign" | "unclaimed";

export async function materialScopeOwnership(
  userId: string,
  scope: string,
): Promise<MaterialScopeOwnership> {
  if (scope === SHARED_SCOPE) return "unclaimed";
  const row = await projectRepository.findById(scope);
  if (!row) return "unclaimed";
  return row.userId === userId ? "mine" : "foreign";
}

/** 这次请求允许看到的 scope —— 读侧的唯一出口（此前它在两个入口各写一份
 *  `resolveScopes`，两份都不判归属；入口现在只有 `/api/materials` GET 这一个）。 */
export async function visibleMaterialScopes(
  userId: string,
  opts: { cross: boolean; projectId: string | null },
): Promise<string[]> {
  if (opts.cross) {
    const out: string[] = [];
    for (const scope of await listScopes()) {
      if (scope === SHARED_SCOPE) continue; // 末尾统一补，避免重复
      if ((await materialScopeOwnership(userId, scope)) !== "foreign") {
        out.push(scope);
      }
    }
    out.push(SHARED_SCOPE);
    return out;
  }
  const { projectId } = opts;
  if (
    projectId &&
    (await materialScopeOwnership(userId, projectId)) === "foreign"
  ) {
    // 与「这个项目根本没有素材」同形：只回共享区
    return [SHARED_SCOPE];
  }
  return projectId ? [projectId, SHARED_SCOPE] : [SHARED_SCOPE];
}

/** 写 / 删这一格素材的许可：共享区不限，明确属于别人的不行，库里没登记的放行
 *  （理由见上面 `unclaimed` 那条）。 */
export async function canWriteMaterialScope(
  userId: string,
  scope: string,
): Promise<boolean> {
  return (await materialScopeOwnership(userId, scope)) !== "foreign";
}

/* ── 读取 ── */

export interface MaterialItem {
  /** 稳定 id：`scope/folder/name`，前端删除时原样回传即可。 */
  id: string;
  name: string;
  folder: string;
  folderName: string;
  kind: MaterialKind;
  /** 浏览器可直接消费的 URL（走 /api/generated 读盘）。 */
  url: string;
  size: number;
  updatedAt: string;
  /** 所属 scope：项目 id 或 SHARED_SCOPE。 */
  scope: string;
}

/** 列出单个 scope/folder 下的素材。目录不存在时返回空数组（不是错误）。 */
export async function listFolderItems(
  scope: string,
  folder: string,
): Promise<MaterialItem[]> {
  const dir = folderDir(scope, folder);
  if (!dir) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return []; // 尚未创建过该分类
  }
  const items: MaterialItem[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue; // 跳过 .DS_Store 之类
    try {
      const st = await fs.stat(
        /*turbopackIgnore: true*/ path.join(
          /*turbopackIgnore: true*/ dir,
          name,
        ),
      );
      if (!st.isFile()) continue;
      items.push({
        id: `${scope}/${folder}/${name}`,
        name,
        folder,
        folderName: folderName(folder),
        kind: inferKind(name),
        url: artifactUrl(
          ["materials", scope, folder, name].map(encodeURIComponent),
        ),
        size: st.size,
        updatedAt: st.mtime.toISOString(),
        scope,
      });
    } catch {
      // 单个文件 stat 失败（被占用 / 刚被删）不应让整个列表 500
    }
  }
  // 新的排前面
  /* 「按当前区域设置排序」走 `~/lib/ordered-set`（规范 16 §16.2.4.55）——
   * 降序即参数顺序相反。 */
  items.sort((left, right) => compareText(right.updatedAt, left.updatedAt));
  return items;
}

/** 列出素材库里所有已存在的 scope 目录（用于「跨项目」聚合）。 */
export async function listScopes(): Promise<string[]> {
  try {
    const entries = await fs.readdir(materialsRoot(), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((dir) => dir.name);
  } catch {
    return [];
  }
}

/**
 * 聚合读取：给定若干 scope，返回每个分类的条目。
 * 返回 Map<folderId, MaterialItem[]>，7 个分类恒定存在（可能为空数组），
 * 这样前端不必自己补齐缺失分类。
 */
export async function collectByFolder(
  scopes: string[],
): Promise<Map<string, MaterialItem[]>> {
  const map = new Map<string, MaterialItem[]>();
  for (const f of MATERIAL_FOLDERS) map.set(f.id, []);
  for (const scope of scopes) {
    for (const f of MATERIAL_FOLDERS) {
      const items = await listFolderItems(scope, f.id);
      if (items.length) getOrCreate(map, f.id, () => []).push(...items);
    }
  }
  for (const [, arr] of map)
    /* 同上：降序即比较参数相反。 */
    arr.sort((left, right) => compareText(right.updatedAt, left.updatedAt));
  return map;
}
