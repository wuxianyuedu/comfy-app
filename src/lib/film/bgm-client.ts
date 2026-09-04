// ── 成片工作室 BGM 上传：浏览器侧 API 客户端（规范 17 §17.2 第②层的网络部分）──
// 之前 `fetch("/api/film/bgm")` 内联在 FilmStudio 的视图里，失败提示与响应收窄
// 散落在 JSX 事件处理器中。集中到此处后：错误信封改一处生效，视图零感知。

const ENDPOINT = "/api/film/bgm";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 从 JSON 响应体里取出 error 字符串（后端该路由一律 `{ error: string }`）。 */
export function readBgmError(body: unknown): string | undefined {
  if (isRecord(body) && typeof body.error === "string") return body.error;
  return undefined;
}

/** 读 JSON 体；非法 JSON 按空对象处理（后端 500 可能返回非 JSON）。 */
async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return {};
  }
}

/**
 * 上传背景音乐，返回服务端落盘后的文件名。
 * 失败时抛带中文文案的 Error（硬规则：失败路径必须有用户可见出口）。
 */
export async function uploadBgm(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(ENDPOINT, { method: "POST", body: form });
  const body = await readJson(res);
  if (!res.ok) throw new Error(readBgmError(body) ?? "BGM 上传失败");
  const name = isRecord(body) ? body.name : undefined;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("BGM 上传失败：响应缺少文件名");
  }
  return name;
}
