/* IO 编辑 / 预览模式下两处子区共用的区头。
 *  定义在模块级（而非组件内）是刻意的：避免每次渲染重建组件而触发
 *  react-hooks/static-components。 */
import { Separator } from "~/components/ui/separator";

export const SectionHeader = ({
  label,
  count,
  accent,
}: {
  label: string;
  count: number;
  accent: string;
}) => (
  <div className="border-border-strong mt-1 flex items-center gap-2 border-t pt-2.5">
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ background: accent }}
    />
    <span className="text-ink-muted text-3xs font-semibold tracking-wider uppercase">
      {label}
    </span>
    <span className="bg-surface-2 text-ink-soft text-3xs rounded-full px-1.5 py-px font-mono">
      {count}
    </span>
    <Separator className="border-border-strong h-0 flex-1 border-t border-dashed bg-transparent" />
  </div>
);
