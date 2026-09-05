/* ── 本地日志文件的网络客户端（第②层的网络部分）──────────────────────
 * 日志面板通过 `/api/logs/current` 轮询 launcher / dev-launcher 的输出文件。
 * 此前这段 fetch 直接写在 LogProvider.tsx（视图）里——它是该文件唯一的裸 fetch，
 * 收口到这里后视图只关心「每次轮询读到的内容与游标」。
 *
 * 约定：返回的 offset 是服务端累计字节数，客户端用它做增量拉取游标。
 */

export interface FileLogSlice {
  content: string;
  size: number;
  offset: number;
}

export type LogSourceKind =
  | "dev"
  | "launcher"
  | "comfyui-runtime"
  | "drizzle-studio-runtime";

/** source 参数 → /api/logs/current 的 source 查询值。 */
function sourceQuery(source: LogSourceKind): string {
  if (source === "dev") return "dev-launcher";
  if (source === "comfyui-runtime") return "comfyui-runtime";
  if (source === "drizzle-studio-runtime") return "drizzle-studio-runtime";
  return "launcher";
}

/** 拉取某日志文件从 offset 起的新增内容；服务端未就绪 / 文件不存在时返回 null。 */
export async function fetchFileLogSlice(
  source: LogSourceKind,
  offset: number,
): Promise<FileLogSlice | null> {
  const res = await fetch(
    `/api/logs/current?source=${sourceQuery(source)}&offset=${offset}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as FileLogSlice;
}
