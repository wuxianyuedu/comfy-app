/* ── 模型「实际使用」测试的网络客户端（第②层网络部分）────────────────
 * 设置页每个模型条目的「测试」弹窗用：按用途（chat / image / video）发起
 * 一次真实调用，验证「照实际用法能用」，而不只是连通性探测。
 * 密钥解析在服务端：浏览器只传条目名，留空的 apiKey 由服务端取已保存值。
 */

export type UsageTestKind = "chat" | "image" | "video";

export interface UsageTestInput {
  kind: UsageTestKind;
  /** 条目名 —— 服务端据此取该条目已保存的独立密钥（留空 apiKey 时） */
  name: string;
  /** 接口地址（弹窗内可改；留空回落条目已保存值 / 全局值） */
  baseUrl: string;
  /** 端点路径，如 /chat/completions、/images/generations；空串 = 就用 baseUrl */
  path: string;
  /** 留空 = 用该条目已保存密钥（再回落全局密钥） */
  apiKey?: string;
  prompt: string;
  /** 图片：尺寸，如 1024x1024 */
  size?: string;
  /** 额外参数（JSON 对象字符串），逐键合并进请求体，可覆盖默认字段 */
  extraJson?: string;
}

export interface UsageTestResult {
  ok: boolean;
  detail: string;
  /** chat：助手的回复文本 */
  chatText?: string;
  /** image：生成图（远程 URL 或内联 data URL，可直接放进 <img src>） */
  imageUrl?: string;
  /** video：已完成时返回视频地址 */
  videoUrl?: string;
  /** video：提交成功但仍在生成时返回任务 ID（pending=true） */
  taskId?: string;
  pending?: boolean;
  /** 真实调用耗时（毫秒） */
  elapsedMs?: number;
  /** 产物已下载并保存到的本地 temp 子目录绝对路径（可为空 = 未落盘成功） */
  savedPath?: string;
}

export async function testModelUsage(
  input: UsageTestInput,
): Promise<UsageTestResult> {
  const res = await fetch("/api/llm/test-usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseUsageTestResult(res, json);
}

/** 「继续等待」异步视频任务的入参：复用该条目的连接参数 + 已提交的任务 ID。
 *  与 UsageTestInput 的区别是只查既有任务，不再提交，绝不重复扣费。 */
export interface UsageTaskQueryInput {
  name: string;
  baseUrl: string;
  path: string;
  apiKey?: string;
  taskId: string;
}

/** 解析单个 tRPC/fetch 结果对象为 UsageTestResult 的公共收尾。 */
function parseUsageTestResult(
  res: Response,
  json: Record<string, unknown>,
): UsageTestResult {
  const str = (k: string): string | undefined => {
    const v: unknown = json[k];
    return typeof v === "string" ? v : undefined;
  };
  return {
    ok: json.ok === true,
    detail: str("detail") ?? `请求失败 (${res.status})`,
    chatText: str("chatText"),
    imageUrl: str("imageUrl"),
    videoUrl: str("videoUrl"),
    taskId: str("taskId"),
    pending: json.pending === true,
    elapsedMs: typeof json.elapsedMs === "number" ? json.elapsedMs : undefined,
    savedPath: str("savedPath"),
  };
}

/** 对已提交的异步视频任务再等一轮：产物就绪则返回 videoUrl（并落盘本地），
 *  否则仍 pending 返回，供调用方继续提供「继续等待」入口。 */
export async function queryUsageTask(
  input: UsageTaskQueryInput,
): Promise<UsageTestResult> {
  const res = await fetch("/api/llm/test-usage/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseUsageTestResult(res, json);
}
