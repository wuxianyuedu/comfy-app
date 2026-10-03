import type { Meta, StoryObj } from "@storybook/nextjs";

import { AuroraBackground } from "~/components/ui/aurora-background";

/**
 * `AuroraBackground` 是**共享装饰性背景**：页面底色之上叠一层
 * 「屏幕混合」的径向光晕（紫 / 青 / 薄荷）。
 *
 * 它的形态与主题强相关，story 的价值全在**明暗两态**（工具栏切）：
 *
 * - **深色**：`mix-blend-screen` 配强光晕（原始设计，`dark:opacity-60`）；
 * - **浅色**：落到 `normal` 混合并**大幅降透明度**（`opacity-10`）——
 *   因为 `screen` 在白 / 浅色表面上产生不了可见效果。
 *   色标 alpha 与 `opacity` 工具类按模式各自调过，好让极光保持克制而不是被
 *   冲淡。
 *
 * 它**永不干扰布局或交互**：自身是 `pointer-events-none` 的固定铺满层，
 * 且在透明（非不透明）页面靠近根处**放一次**。`contain: layout paint` 是
 * 重绘隔离 —— 这层铺满视口、被几乎每个主页面常驻渲染，页面内容变化时不必
 * 连带重算它。
 *
 * 它是**出厂豁免**让位硬规则的少数几件之一（见 `check-title-bar-clearance.cjs`
 * 的 `EXEMPT`）：标题行自身半透明，背景若从标题行下方才开始、顶部会露出
 * 一条亮带。所以 story **不给它换定位** —— 换成绝对定位等于在调用点另造一个
 * 内容浮层，顺手违反那条规则。
 *
 * **色值全走 `--color-aurora-*` token**（规范 03 §3.6.2）：这里曾把
 * `rgba(139,92,246,…)` 这类值写死四处、而四处的 alpha 还不一样
 * （0.48 / 0.42 / 0.40）—— 于是「改品牌色」要改四个地方。现在色相归主题
 * token，强度（alpha）由 `--color-aurora-*-alpha` 承载。
 *
 * ⚠️ 因为它是 `fixed -z-10`，在 Storybook 画布里会被框架自己的背景挡住一部分
 *  —— 请看画布**边缘与四角**的光晕，而不是中央。
 */
const meta = {
  title: "UI/AuroraBackground",
  component: AuroraBackground,
} satisfies Meta<typeof AuroraBackground>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 深色（默认档）：画布默认就是 dark，这一条直接看原始设计的强度。 */
export const Dark: Story = {
  render: (args) => (
    <div className="relative h-[24rem] w-full overflow-hidden rounded-lg border">
      <AuroraBackground className={args.className} />
      <div className="relative flex h-full items-center justify-center">
        <p className="text-ink text-sm">
          切到 light 再回来对比：这一档是 mix-blend-screen
        </p>
      </div>
    </div>
  ),
};

/**
 * 两态对照：`AuroraBackground` 是 `fixed` 的**应用级背景**（它必须覆盖标题行，
 * 否则半透明的标题行下方会露出一条亮带 —— 这也是它进出厂豁免清单的理由，
 * 见 `check-title-bar-clearance.cjs` 的 `EXEMPT`）。
 *
 * 所以这条 story **不给它换定位**（换成 `absolute inset-0` 等于在调用点重造一个
 * 内容浮层、顺手违反让位硬规则 —— 本批第一版就是这么被门槛拦下的）。
 * 要看两态差别请用**工具栏**切 `dark` / `light` 再回到这条 story：
 * 深色是高不透明的 `screen` 光晕，浅色是大幅降透明度的 `normal`。
 */
export const BlendModesSideBySide: Story = {
  render: () => (
    <div className="rounded-lg border p-6">
      <p className="text-ink-muted text-sm">
        这一档的装饰层铺在**整个视口**（含标题行），所以你在画布里看到的是
        它真实的样子。用工具栏切 <code>dark</code> / <code>light</code> 对比：
        深色 <code>mix-blend-screen</code> + <code>opacity-60</code>； 浅色{" "}
        <code>normal</code> + <code>opacity-10</code>（<code>screen</code>{" "}
        在白底上产生不了可见效果）。
      </p>
    </div>
  ),
};

/** 它不干扰交互：这一条在装饰层之上放一排真按钮 —— 点击都该正常。
 *  `pointer-events-none` 那条就是为这件事给的。 */
export const DoesNotBlockInteraction: Story = {
  render: () => (
    <div className="relative h-[16rem] w-full overflow-hidden rounded-lg border">
      <div className="relative flex h-full flex-col items-center justify-center gap-3">
        <p className="text-ink text-sm">
          下面这排按钮能点，说明装饰层没吃掉指针事件
        </p>
        <div className="flex gap-2">
          <button className="bg-primary text-primary-foreground rounded-md px-3 py-1 text-sm">
            按钮 A
          </button>
          <button className="rounded-md border px-3 py-1 text-sm">
            按钮 B
          </button>
        </div>
      </div>
    </div>
  ),
};
