import { Skeleton } from "~/components/ui/skeleton";

/** 动态表单骨架占位（规范 16 §16.2.3 P3）。骨架在库里有 ui/skeleton；Skeleton 的 bg-muted
 * 会被下面的 bg-subtle 覆盖（cn() 走 tailwind-merge，同属性后者赢），故保留下方原底色类。 */
export function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((index) => (
        <div className="flex flex-col gap-1.5" key={`skeleton-${index}`}>
          <Skeleton className="bg-subtle h-2.5 w-16 rounded" />
          <Skeleton className="bg-subtle h-8 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
