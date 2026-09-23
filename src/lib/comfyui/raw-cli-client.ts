/* comfy-cli 完整原始输出的网络层（§17 把 IO 收进 lib，视图只渲染）。
 *
 * 面板摘要是截断的，这里按需拉取某次执行的完整 comfy-cli stdout/stderr
 * 原文，供「查看完整输出」弹窗使用。 */

export interface RawCliResponse {
  lines: string[];
}

/** 拉取某次执行的 comfy-cli 完整原始输出（按行）。请求失败时返回空数组。 */
export async function fetchRawCli(taskId: string): Promise<string[]> {
  try {
    const res = await fetch(
      `/api/tasks/${encodeURIComponent(taskId)}/raw-cli`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Partial<RawCliResponse>;
    return Array.isArray(data.lines) ? data.lines : [];
  } catch {
    return [];
  }
}
