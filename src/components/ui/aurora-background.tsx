/** AuroraBackground —— 与 Ardot 设计体系一致的共享装饰性背景：页面底色之上叠屏幕混合的径向光晕（紫 / 青 / 薄荷）。
 * 深色 `mix-blend-screen` 配强光晕；浅色回落 `normal` 并降透明度（`screen` 在白 / 浅色表面不可见），色标 alpha 与 opacity 按模式各自调过。
 * 在透明（非不透明）页面靠近根处放一次；fixed + `pointer-events-none`，永不干扰布局或交互。
 * 色值走 `--color-aurora-*` token（规范 03 §3.6.2）：色相归主题，强度由 `--color-aurora-*-alpha` 纯透明度字面量承载（历史四处写死且 alpha 不一致：0.48 / 0.42 / 0.40）。 */
export function AuroraBackground({ className = "" }: { className?: string }) {
  return (
    /* 应用级背景层，不是浮在内容上的浮层：标题行自身是半透明，背景若从标题行
       下方才开始，顶部会露出一条亮带。故此处保留铺满视口的写法，
       由 scripts/check-title-bar-clearance.cjs 豁免清单放行。 */
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${className}`}
      data-testid="aurora-bg"
      /* 重绘隔离：这层铺满视口、且被几乎每个主页面常驻渲染，`contain` 让它的
       * 布局与绘制不顺着祖先链扩散到整页 —— 页面内容变化时不必连带重算它。 */
      style={{ contain: "layout paint" }}
    >
      {/* 极光晕 1：紫罗兰（右上） */}
      <div
        className="absolute top-[-20%] right-[-10%] h-[70%] w-[55%] rounded-full opacity-10 mix-blend-normal dark:opacity-60 dark:mix-blend-screen"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, var(--color-aurora-violet) 48%, transparent) 0%, transparent 74%)`,
          filter: "blur(24px)",
        }}
      />
      {/* 极光晕 2：青蓝（左下） */}
      <div
        className="absolute bottom-[10%] left-[-15%] h-[60%] w-[50%] rounded-full opacity-10 mix-blend-normal dark:opacity-50 dark:mix-blend-screen"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, var(--color-aurora-cyan) 32%, transparent) 0%, transparent 74%)`,
          filter: "blur(28px)",
        }}
      />
      {/* 极光晕 3：品红（中下，柔光点缀） */}
      <div
        className="absolute bottom-[-10%] left-[20%] h-[40%] w-[35%] rounded-full opacity-5 mix-blend-normal dark:opacity-30 dark:mix-blend-screen"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, var(--color-aurora-magenta) 22%, transparent) 0%, transparent 74%)`,
          filter: "blur(32px)",
        }}
      />
    </div>
  );
}

/** AuroraGlow — 单个极光晕。`AuroraBackground` 之外的页面（登录页 / 首页 / FilmStudio 整屏）要局部或自定义强度时用它，不要各自再抄 `radial-gradient`（历史四处色值不一致 0.48 / 0.42 / 0.40 的来源）。
 * `tone` 只表达色相（走 token），强度由 `alpha` 决定。 */
/** 三种色相各写完整字面名，不许拼成 `--color-aurora-${tone}`：`check-theme-colors.cjs` 的幽灵 token 判据与 Tailwind v4 的 `@theme` tree-shake 都只认源码里的字面名。
 * 拼法今天能活，只因为别处整名写过这三颗 token；哪天重构掉，极光晕会当场失色且无报错。 */
const AURORA_TONE_VAR: Record<"violet" | "cyan" | "magenta", string> = {
  violet: "var(--color-aurora-violet)",
  cyan: "var(--color-aurora-cyan)",
  magenta: "var(--color-aurora-magenta)",
};

export function AuroraGlow({
  tone,
  alpha,
  className = "",
}: {
  /** 光晕中心的不透明度（0~1），只影响这一层。 */
  alpha: number;
  className?: string;
  tone: "violet" | "cyan" | "magenta";
}) {
  const stop = `color-mix(in srgb, ${AURORA_TONE_VAR[tone]} ${Math.round(alpha * 100)}%, transparent)`;
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute rounded-full ${className}`}
      style={{
        background: `radial-gradient(circle, ${stop} 0%, transparent 70%)`,
      }}
    />
  );
}
