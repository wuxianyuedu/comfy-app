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
 * 落点：public/generated/materials/{scopeDir}/{folderId}/{fileName}
 *   scopeDir = 画布项目 id（localStorage 里的 `proj_...`），或 SHARED_SCOPE
 *   经 /api/generated/[...path] 提供读取，浏览器可直接引用。
 */

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

const FOLDER_IDS = new Set<string>(MATERIAL_FOLDERS.map((MATERIAL_FOLDERS) => MATERIAL_FOLDERS.id));

export function isValidFolder(id: string | null | undefined): id is MaterialFolderId {
  return !!id && FOLDER_IDS.has(id);
}

export function folderName(id: string): string {
  return MATERIAL_FOLDERS.find((MATERIAL_FOLDERS) => MATERIAL_FOLDERS.id === id)?.name ?? id;
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

/** 素材库根目录（public/generated/materials）。 */
export function materialsRoot(): string {
  return path.join(process.cwd(), "public", "generated", "materials");
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
export function sanitizeFileName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // 同时按两种分隔符切，避免 Windows 上 "a/b\\c.png" 漏网
  const base = raw.split(/[\\/]/).pop()?.trim();
  if (!base || base === "." || base === "..") return null;
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, "_");
  if (!cleaned || cleaned.length > 200) return null;
  return cleaned;
}

/** 拼出 scope/folder 的绝对目录，并断言它仍在素材库根之内。 */
export function folderDir(scope: string, folder: string): string | null {
  const root = materialsRoot();
  const dir = path.join(root, scope, folder);
  if (dir !== root && !dir.startsWith(root + path.sep)) return null;
  return dir;
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
  folder: string
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
      const st = await fs.stat(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, name));
      if (!st.isFile()) continue;
      items.push({
        id: `${scope}/${folder}/${name}`,
        name,
        folder,
        folderName: folderName(folder),
        kind: inferKind(name),
        url: `/api/generated/materials/${encodeURIComponent(scope)}/${encodeURIComponent(
          folder
        )}/${encodeURIComponent(name)}`,
        size: st.size,
        updatedAt: st.mtime.toISOString(),
        scope,
      });
    } catch {
      // 单个文件 stat 失败（被占用 / 刚被删）不应让整个列表 500
    }
  }
  // 新的排前面
  items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return items;
}

/** 列出素材库里所有已存在的 scope 目录（用于「跨项目」聚合）。 */
export async function listScopes(): Promise<string[]> {
  try {
    const entries = await fs.readdir(materialsRoot(), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((dir) => dir.name);
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
  scopes: string[]
): Promise<Map<string, MaterialItem[]>> {
  const map = new Map<string, MaterialItem[]>();
  for (const f of MATERIAL_FOLDERS) map.set(f.id, []);
  for (const scope of scopes) {
    for (const f of MATERIAL_FOLDERS) {
      const items = await listFolderItems(scope, f.id);
      if (items.length) map.get(f.id)!.push(...items);
    }
  }
  for (const [, arr] of map) arr.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return map;
}
