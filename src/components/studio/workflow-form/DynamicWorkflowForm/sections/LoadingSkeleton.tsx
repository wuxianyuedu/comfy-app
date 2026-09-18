import { Skeleton } from "~/components/ui/skeleton";

/** 动态表单的骨架占位（规范 16 §16.2.3 P3）。
 *
 * 此前这里自写 `animate-pulse` 的空 div —— 骨架这件事在库里已有 `ui/skeleton`。
 * `Skeleton` 的 `bg-muted` 会被下面的 `bg-subtle` 覆盖（`cn()` 走 tailwind-merge，
 * 同一属性后面的类赢），所以保留下方原来的底色类即可。
 */
export function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div key={`skeleton-${index}`} className="space-y-1.5">
          <Skeleton className="bg-subtle h-2.5 w-16 rounded" />
          <Skeleton className="bg-subtle h-8 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
