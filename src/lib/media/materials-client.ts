// ── 素材库：浏览器侧 API 客户端（规范 17 §17.2 第②层的网络部分）──────────────
// 面板不再自己 fetch —— 列表/上传/删除三个请求集中在这里，失败解析与响应
// 收窄只此一份。服务端改错误信封时改这里即可，视图零感知。
// 类型镜像 /api/materials 响应（服务端形状见 src/lib/materials.ts）。

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 分类（文件夹）摘要，含该分类素材条数。 */
export interface MaterialFolder {
  id: string;
  name: string;
  count: number;
}

export type MaterialKind = "image" | "video" | "audio" | "doc";

/** 单个素材条目。 */
export interface MaterialItem {
  id: string;
  name: string;
  folder: string;
  folderName: string;
  kind: MaterialKind;
  url: string;
  size: number;
  updatedAt: string;
  scope: string;
}

/** GET /api/materials 的响应。 */
export interface MaterialListResult {
  folders: MaterialFolder[];
  items: MaterialItem[];
}

/** 列表查询参数。 */
export interface MaterialListQuery {
  /** 画布项目 id；为空则只看共享素材。 */
  projectId?: string | null;
  /** project = 本项目 + 共享；cross = 跨项目聚合。 */
  scope: "project" | "cross";
  /** 进入的分类；未传（且无搜索）时只返回分类计数。 */
  folder?: string | null;
  /** 搜索关键字，优先于 folder。 */
  q?: string;
}

const ENDPOINT = "/api/materials";

/** 从 JSON 响应体里取出 error 字符串（后端一律 `{ error: string }`）。 */
export function readMaterialError(body: unknown): string | undefined {
  if (isRecord(body) && typeof body.error === "string") return body.error;
  return undefined;
}

/** 读 JSON 体；非法 JSON 按空对象处理（后端 500 可能返回非 JSON）。 */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function isItem(v: unknown): v is MaterialItem {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.folder === "string" &&
    typeof v.folderName === "string" &&
    typeof v.kind === "string" &&
    typeof v.url === "string" &&
    typeof v.size === "number" &&
    typeof v.updatedAt === "string" &&
    typeof v.scope === "string"
  );
}

function isFolder(v: unknown): v is MaterialFolder {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.count === "number"
  );
}

function parseList(body: unknown): MaterialListResult {
  if (!isRecord(body)) return { folders: [], items: [] };
  const foldersRaw = body.folders;
  const itemsRaw = body.items;
  return {
    folders: Array.isArray(foldersRaw) ? foldersRaw.filter(isFolder) : [],
    items: Array.isArray(itemsRaw) ? itemsRaw.filter(isItem) : [],
  };
}

/** 拉取素材列表（分类计数 + 当前视图条目）。 */
export async function fetchMaterials(
  query: MaterialListQuery,
): Promise<MaterialListResult> {
  const params = new URLSearchParams();
  if (query.projectId) params.set("projectId", query.projectId);
  params.set("scope", query.scope);
  if (query.q) params.set("q", query.q);
  else if (query.folder) params.set("folder", query.folder);

  const res = await fetch(`${ENDPOINT}?${params.toString()}`);
  const body = await readJson(res);
  if (!res.ok)
    throw new Error(readMaterialError(body) ?? `请求失败 (${res.status})`);
  return parseList(body);
}

/** 上传的公共部分：拼 FormData、发请求、按错误信封抛错。 */
async function postMaterial(
  file: File,
  opts: { folder: string; projectId?: string | null },
): Promise<unknown> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", opts.folder);
  if (opts.projectId) fd.append("projectId", opts.projectId);
  else fd.append("shared", "true");

  const res = await fetch(ENDPOINT, { method: "POST", body: fd });
  const body = await readJson(res);
  if (!res.ok)
    throw new Error(readMaterialError(body) ?? `上传失败 (${res.status})`);
  return body;
}

/** 上传素材（不需要回执时用它）。projectId 为空时传 shared=true 落到共享目录。 */
export async function uploadMaterial(
  file: File,
  opts: { folder: string; projectId?: string | null },
): Promise<void> {
  await postMaterial(file, opts);
}

/** 上传成功回执里的可用信息 —— POST 只回 url/id/name 等基础字段，
 *  不含 kind / updatedAt，故不等于完整的 MaterialItem。 */
export interface MaterialUploadResult {
  /** 稳定 id：`scope/folder/name` */
  id: string;
  name: string;
  /** 浏览器可直接引用的地址（走 /api/generated 读盘） */
  url: string;
}

/** 上传素材并取回落盘地址（工坊「定妆照」导入需要把图写进素材库再引用）。 */
export async function uploadMaterialItem(
  file: File,
  opts: { folder: string; projectId?: string | null },
): Promise<MaterialUploadResult> {
  const body = await postMaterial(file, opts);
  const item = isRecord(body) ? body.item : undefined;
  const url = isRecord(item) && typeof item.url === "string" ? item.url : "";
  if (!url) throw new Error("上传成功但服务端未返回素材地址");
  return {
    url,
    id: isRecord(item) && typeof item.id === "string" ? item.id : url,
    name:
      isRecord(item) && typeof item.name === "string" ? item.name : file.name,
  };
}

/** 删除素材。id 形如 `scope/folder/name`，服务端据此定位。 */
export async function deleteMaterial(id: string): Promise<void> {
  const res = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const body = await readJson(res);
  if (!res.ok)
    throw new Error(readMaterialError(body) ?? `删除失败 (${res.status})`);
}
