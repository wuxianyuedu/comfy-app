"use client";

/**
 * 工作流来源标签：本地 / 在线。
 */
export function SourceTag({
  source,
  local,
}: {
  source?: string | null;
  local?: boolean | null;
}) {
  const isLocal = local ?? source === "local";
  if (isLocal) {
    return (
      <span
        className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
        title="本地工作流 · 已连接磁盘文件"
      >
        本地
      </span>
    );
  }
  return (
    <span
      className="bg-surface-2 text-ink-faint rounded-md px-1.5 py-0.5 text-[10px] font-medium"
      title="在线工作流 · 粘贴/API 导入，保存在数据库"
    >
      在线
    </span>
  );
}
