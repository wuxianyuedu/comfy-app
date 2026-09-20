// ── 成片工作室 BGM 上传：浏览器侧 API 客户端（规范 17 §17.2 第②层的网络部分）──
// 之前 `fetch("/api/film/bgm")` 内联在 FilmStudio 的视图里，失败提示与响应收窄
// 散落在 JSX 事件处理器中。集中到此处后：错误信封改一处生效，视图零感知。

import { readApiError, readJsonBody } from "~/lib/api-error";
import { asRecord } from "~/lib/is-record";

const ENDPOINT = "/api/film/bgm";

/* 错误信封的读法收在 `~/lib/api-error`（规范 16 §16.2.4.35）。 */

/**
 * 上传背景音乐，返回服务端落盘后的文件名。
 * 失败时抛带中文文案的 Error（硬规则：失败路径必须有用户可见出口）。
 */
export async function uploadBgm(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(ENDPOINT, { method: "POST", body: form });
  const body = await readJsonBody(res);
  if (!res.ok) throw new Error(readApiError(body) ?? "BGM 上传失败");
  const name = asRecord(body)?.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("BGM 上传失败：响应缺少文件名");
  }
  return name;
}
