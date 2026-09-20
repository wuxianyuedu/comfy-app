// ── 数据集图片上传：浏览器侧 API 客户端（规范 17 §17.2 第②层的网络部分）──────
// 原先 `fetch("/api/upload")` 内联在 TrainingStudio 的 onUpload 事件处理器里。
// 集中到此处后：错误信封（含 ComfyUI 不可达的 hint）只解析一次，
// 逐张上传的循环逻辑留在 hook 里，视图不再碰网络。

import { readApiError, readJsonBody } from "~/lib/api-error";
import { asRecord } from "~/lib/is-record";

const ENDPOINT = "/api/upload";

/* 错误信封的读法收在 `~/lib/api-error`（规范 16 §16.2.4.35）：
 * 这里此前自己声明了一份 `readUploadError` 与 `readJson`，
 * 与 materials / bgm 两份**逐字相同**。 */

/**
 * 上传一张数据集图片，返回服务端/ComfyUI 落盘后的文件名。
 * 失败时抛带中文文案的 Error（硬规则：失败路径必须有用户可见出口）。
 */
export async function uploadDatasetImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(ENDPOINT, { method: "POST", body: form });
  const body = await readJsonBody(res);
  if (!res.ok) throw new Error(readApiError(body) ?? "上传失败");
  const name = asRecord(body)?.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("上传失败：响应缺少文件名");
  }
  return name;
}
