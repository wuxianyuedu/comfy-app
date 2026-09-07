/* ── 运行期「本地更新」检测的网络客户端（规范 17 第②层网络部分）────
 * 通过 `/api/update-check`（服务端扫描需重启才生效的文件并对比运行期基线）
 * 轮询「是否有本地文件改动需要重启才生效」。收口在这里后，视图/逻辑层只关心
 * 「是否脏、哪一组、哪些文件」，不直接发 fetch。
 */

export interface UpdateGroup {
  key: "restart" | "recompile";
  label: string;
  hint: string;
  /** 相对仓库根的文件路径（改动或删除） */
  files: string[];
  dirty: boolean;
}

export interface UpdateCheckPayload {
  ok: boolean;
  /** 基线是否已建立；首轮请求前为 false（前端应跳过，不做任何提示） */
  armed: boolean;
  dirty: boolean;
  groups: UpdateGroup[];
}

const EMPTY: UpdateCheckPayload = {
  ok: false,
  armed: false,
  dirty: false,
  groups: [],
};

/** 拉一次更新检测；请求失败（路由不可达等）返回空态便于降级静默。 */
export async function fetchUpdateCheck(): Promise<UpdateCheckPayload> {
  try {
    const res = await fetch(`/api/update-check`, { cache: "no-store" });
    if (!res.ok) return EMPTY;
    const data = (await res.json()) as UpdateCheckPayload;
    return {
      ok: true,
      armed: data.armed === true,
      dirty: data.dirty === true,
      groups: Array.isArray(data.groups) ? data.groups : [],
    };
  } catch {
    return EMPTY;
  }
}
