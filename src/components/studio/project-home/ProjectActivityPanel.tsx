"use client";

/** 项目活动流（ISSUE #5208）：多检出共同制作时，显示最近的保存事件与来源时间。 */
import { useProjectActivity } from "./hooks/use-project-activity";

const EVENT_LABEL: Record<string, string> = {
  project_content_saved: "保存了剧本 / 角色 / 分镜",
};

export function ProjectActivityPanel({ projectId }: { projectId?: string }) {
  const { items } = useProjectActivity(projectId);
  if (!projectId) {
    return null;
  }
  return (
    <div className="border-border flex flex-col gap-1.5 border-l-2 pl-3">
      <div className="text-ink-muted text-sm font-medium">最近活动</div>
      {items.length === 0 ? (
        <span className="text-ink-faint text-xs">还没有保存记录。</span>
      ) : (
        items.map((item) => (
          <div className="text-ink-faint flex items-center gap-2 text-xs" key={item.id}>
            <span className="text-ink-muted">{EVENT_LABEL[item.event] ?? item.event}</span>
            <time dateTime={item.createdAt}>{item.createdAt.slice(0, 16).replace("T", " ")}</time>
          </div>
        ))
      )}
    </div>
  );
}
