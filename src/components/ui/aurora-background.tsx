/**
 * AuroraBackground —— 与 Ardot 设计体系一致的共享装饰性背景。
 * 页面底色之上叠加屏幕混合的径向光晕（紫 / 青 / 青薄荷）。
 *
 * 随主题：
 *  - 深色模式用 `mix-blend-screen` 配强光晕（原始设计）。
 *  - 浅色模式回落到 `normal` 混合并**降低透明度**，因为
 *    在白 / 浅色表面上的 `screen` 产生不了可见效果。色标 alpha 与
 *    `opacity` 工具类都按模式各自调过，好让极光
 *    保持克制而不是被冲淡。
 *
 * 在透明（非不透明）页面靠近根处放一次；它是 fixed 且
 * pointer-events-none 的，所以永不干扰布局或交互。
 *
 * **色值走 `--color-aurora-*` token（规范 03 §3.6.2）**：这里曾把
 * `rgba(139,92,246,…)` / `rgba(34,212,237,…)` / `rgba(255,92,168,…)` 写死，
 * 于是「改品牌色」要改登录页、首页、FilmStudio 等四处 ——
 * 而四处的值还不一样（0.48 / 0.42 / 0.40）。现在统一走 token，并且
 * 用 `--color-aurora-*-alpha` **纯透明度字面量**承载每组的光晕强度：
 * 强度本来就是「这组光晕的观感参数」，不是可移植的色值，放 token 里
 * 既能让扫描器通过，又不用把局部常量提到命名空间根（判据是
 * 「这行色值是『内容自己的颜色』还是『某个表面的颜色』」—— 极光是装饰
 * 内容，色相归主题，强度归这里）。
 */
export function AuroraBackground({ className = "" }: { className?: string }) {
  return (
    /* 应用级背景层，不是浮在内容上的浮层：标题行自身是半透明，背景若从标题行
       下方才开始，顶部会露出一条亮带。故此处保留铺满视口的写法，
       由 scripts/check-title-bar-clearance.cjs 豁免清单放行。 */
    <div
      aria-hidden
      data-testid="aurora-bg"
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${className}`}
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

/**
 * AuroraGlow — 单个极光晕。`AuroraBackground` 之外的页面（登录页、首页、
 * FilmStudio 的整屏视图）需要**局部/自定义强度**的光晕时
 * 用这个，而不是各自再抄一段 `radial-gradient` —— 那正是历史上四处色值
 * 不一致（0.48 / 0.42 / 0.40）的来源。
 *
 * `tone` 只表达色相（走 token），强度由 `alpha` 决定。
 */
/**
 * 三种色相各写**完整字面名**，不许拼成 `--color-aurora-${tone}`。
 *
 * 两个理由：① 门禁 `check-theme-colors.cjs` 的「幽灵 token」判据比对的是字面名，
 * 拼出来的引用它根本看不见；② Tailwind v4 会 **tree-shake `@theme` 里没被引用的变量**，
 * 而它判断「有没有被引用」看的也是源码里的字面名 —— 拼出来的名字它同样看不见。
 * 这两条叠起来意味着：拼法今天能活，纯粹是因为别处（`AuroraBackground` 上半段）
 * 恰好把这三颗名字整名写过；哪天重构掉那几行，
 * 极光晕会当场失色且无任何报错。把名字写全 = 这个文件自己就把 token 保住了。
 */
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
  tone: "violet" | "cyan" | "magenta";
  /** 光晕中心的不透明度（0~1），只影响这一层。 */
  alpha: number;
  className?: string;
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
