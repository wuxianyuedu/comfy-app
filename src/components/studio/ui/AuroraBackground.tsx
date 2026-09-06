/**
 * AuroraBackground — shared decorative backdrop matching the Ardot design system.
 * Screen-blended radial glows (violet / cyan / magenta) over the page base.
 *
 * Theme-aware:
 *  - Dark mode uses `mix-blend-screen` with strong glow (original design).
 *  - Light mode falls back to `normal` blend with **lower opacity**, since
 *    `screen` on a white/light surface produces no visible effect. Both the
 *    rgba alpha and `opacity` utilities are tuned per mode so the aurora stays
 *    subtle rather than washed out.
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
      {/* 极光晕 1：紫罗兰（右上） */}
      <div
        className="absolute right-[-10%] top-[-20%] h-[70%] w-[55%] rounded-full opacity-10 mix-blend-normal dark:opacity-60 dark:mix-blend-screen"
        style={{
          background:
            "radial-gradient(circle, rgba(139,92,246,0.48) 0%, rgba(139,92,246,0) 70%)",
          filter: "blur(40px)",
        }}
      />
      {/* 极光晕 2：青蓝（左下） */}
      <div
        className="absolute left-[-15%] bottom-[10%] h-[60%] w-[50%] rounded-full opacity-10 mix-blend-normal dark:opacity-50 dark:mix-blend-screen"
        style={{
          background:
            "radial-gradient(circle, rgba(34,212,237,0.32) 0%, rgba(34,212,237,0) 70%)",
          filter: "blur(50px)",
        }}
      />
      {/* 极光晕 3：品红（中下，柔光点缀） */}
      <div
        className="absolute left-[20%] bottom-[-10%] h-[40%] w-[35%] rounded-full opacity-5 mix-blend-normal dark:opacity-30 dark:mix-blend-screen"
        style={{
          background:
            "radial-gradient(circle, rgba(255,92,168,0.22) 0%, rgba(255,92,168,0) 70%)",
          filter: "blur(60px)",
        }}
      />
    </div>
  );
}
