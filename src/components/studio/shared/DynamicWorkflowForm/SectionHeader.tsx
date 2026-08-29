/* Section header used for the two sub-sections in IO edit/preview mode
 *  (2026-08-09).  Module-level so it isn't re-created on every render
 *  (react-hooks/static-components). */
export const SectionHeader = ({ label, count, accent }: { label: string; count: number; accent: string }) => (
  <div className="mt-1 flex items-center gap-2 border-t border-white/10 pt-2.5">
    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
    <span className="text-[10px] font-semibold uppercase tracking-wider text-(--color-ink-muted)">{label}</span>
    <span className="rounded-full bg-white/10 px-1.5 py-px font-mono text-[10px] text-gray-400">{count}</span>
    <div className="flex-1 border-t border-dashed border-white/8" />
  </div>
);
