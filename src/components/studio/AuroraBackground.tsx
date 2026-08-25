/**
 * AuroraBackground — shared decorative backdrop matching the Ardot design system.
 * Two SCREEN-blended radial glows (violet top-right, cyan bottom-left) over the
 * dark page base. Replicates the `aurora-violet` / `aurora-cyan` ellipses found in
 * every Ardot workspace screen (e.g. HistoryList 710167695590819, ProjectCanvas 710166477116494).
 *
 * Place once near the root of a transparent (non-opaque) page; it is fixed and
 * pointer-events-none so it never interferes with layout or interaction.
 */
export function AuroraBackground({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      data-testid="aurora-bg"
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${className}`}
    >
      {/* 极光晕 1：紫罗兰（右上） — 强发光 + screen 混合 */}
      <div
        className="absolute -right-[10%] -top-[20%] h-[70%] w-[55%] rounded-full opacity-60 mix-blend-screen"
        style={{
          background:
            "radial-gradient(circle, rgba(139,92,246,0.48) 0%, rgba(139,92,246,0) 70%)",
          filter: "blur(40px)",
        }}
      />
      {/* 极光晕 2：青蓝（左下） — 强发光 + screen 混合 */}
      <div
        className="absolute -left-[15%] bottom-[10%] h-[60%] w-[50%] rounded-full opacity-50 mix-blend-screen"
        style={{
          background:
            "radial-gradient(circle, rgba(34,212,237,0.32) 0%, rgba(34,212,237,0) 70%)",
          filter: "blur(50px)",
        }}
      />
      {/* 极光晕 3：品红（中下，柔光点缀） */}
      <div
        className="absolute left-[20%] bottom-[-10%] h-[40%] w-[35%] rounded-full opacity-30 mix-blend-screen"
        style={{
          background:
            "radial-gradient(circle, rgba(255,92,168,0.22) 0%, rgba(255,92,168,0) 70%)",
          filter: "blur(60px)",
        }}
      />
    </div>
  );
}
