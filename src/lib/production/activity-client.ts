/** 剧集协作活动流的只读客户端（ISSUE #5208）。视图层不碰 fetch。 */
import { withQuery } from "~/lib/query-string";
import { isRecord } from "~/lib/is-record";
import { fetchWithTimeout } from "~/lib/network/fetch-with-timeout";

export type ActivityItem = {
  createdAt: string;
  event: string;
  id: string;
  /** 来源标签（启动器注入的 handle），无来源的老行缺省。 */
  source?: string;
};

export async function fetchProjectActivity(projectId: string): Promise<Array<ActivityItem>> {
  if (!projectId) {
    return [];
  }
  try {
    const res = await fetchWithTimeout(withQuery("/api/activity", { project: projectId }));
    if (!res.ok) {
      return [];
    }
    const body: unknown = await res.json();
    if (!isRecord(body) || !Array.isArray(body.items)) {
      return [];
    }
    return body.items.flatMap((row): Array<ActivityItem> => {
      if (!isRecord(row) || typeof row.event !== "string" || typeof row.createdAt !== "string") {
        return [];
      }
      return [
        {
          createdAt: row.createdAt,
          event: row.event,
          id: typeof row.id === "string" ? row.id : row.createdAt,
          ...(typeof row.source === "string" ? { source: row.source } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}
