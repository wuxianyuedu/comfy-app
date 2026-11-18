import type { LaunchTimings } from "./launch-timings";

/**
 * 启动耗时分解的**客户端取数**（#4327）：视图层不裸 fetch（硬规则 10），
 * 统一走 lib 客户端。读不到（纯浏览器开发 / 文件还没写 / 接口不在）返回
 * null，由调用方整卡隐藏——这一层不抛错、不弹全局错误。
 */
export async function fetchLaunchTimings(): Promise<LaunchTimings | null> {
  const res = await fetch("/api/dev/launch-timings", { cache: "no-store" });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as {
    phases: LaunchTimings["phases"] | null;
    totalMs: number | null;
  };
  if (!data?.phases || data.phases.length === 0) {
    return null;
  }
  return { phases: data.phases, totalMs: data.totalMs ?? 0 };
}
