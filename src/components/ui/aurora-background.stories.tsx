import type { Meta, StoryObj } from "@storybook/nextjs";

import { AuroraBackground } from "~/components/ui/aurora-background";

/** `AuroraBackground` 是共享装饰性背景：页面底色之上叠一层屏幕混合的径向光晕（紫 / 青 / 薄荷），永不干扰布局或交互。
 * 深色 `mix-blend-screen` + 强光晕；浅色回落 `normal` + 大幅降透明度（`screen` 在白 / 浅底不可见），色标 alpha 与 opacity 按模式各自调过。
 * 固定 `pointer-events-none` 铺满视口、在透明页面靠近根处放一次；`contain: layout paint` 做重绘隔离；色值全走 `--color-aurora-*` token。
 * 它是让位硬规则的出厂豁免（`check-title-bar-clearance.cjs` 的 `EXEMPT`：标题行半透明，背景须覆盖标题行），story 不给它换定位。
 * ⚠️ `fixed -z-10` 在 Storybook 画布会被框架背景挡住一部分：请看画布边缘与四角的光晕，而不是中央。 */
const meta = {
  title: "UI/AuroraBackground",
  component: AuroraBackground,
} satisfies Meta<typeof AuroraBackground>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 深色（默认档）：画布默认就是 dark，这一条直接看原始设计的强度。 */
export const Dark: Story = {
  render: (args) => (
    <div className="relative h-96 w-full overflow-hidden rounded-lg border">
      <AuroraBackground className={args.className} />
      <div className="relative flex h-full items-center justify-center">
        <p className="text-ink text-sm">切到 light 再回来对比：这一档是 mix-blend-screen</p>
      </div>
    </div>
  ),
};

/** 两态对照：它是 `fixed` 的应用级背景，必须覆盖标题行（否则半透明标题行下方露亮带，也是出厂豁免的理由），story 不给它换定位。
 * 用工具栏切 `dark` / `light` 看两态：深色是高不透明的 `screen` 光晕，浅色是大幅降透明度的 `normal`。 */
export const BlendModesSideBySide: Story = {
  render: () => (
    <div className="rounded-lg border p-6">
      <p className="text-ink-muted text-sm">
        这一档的装饰层铺在**整个视口**（含标题行），所以你在画布里看到的是 它真实的样子。用工具栏切{" "}
        <code>dark</code> / <code>light</code> 对比： 深色 <code>mix-blend-screen</code> +{" "}
        <code>opacity-60</code>； 浅色 <code>normal</code> + <code>opacity-10</code>（
        <code>screen</code> 在白底上产生不了可见效果）。
      </p>
    </div>
  ),
};

/** 它不干扰交互：这一条在装饰层之上放一排真按钮 —— 点击都该正常。
 *  `pointer-events-none` 那条就是为这件事给的。 */
export const DoesNotBlockInteraction: Story = {
  render: () => (
    <div className="relative h-64 w-full overflow-hidden rounded-lg border">
      <div className="relative flex h-full flex-col items-center justify-center gap-3">
        <p className="text-ink text-sm">下面这排按钮能点，说明装饰层没吃掉指针事件</p>
        <div className="flex gap-2">
          <button className="bg-primary text-primary-foreground rounded-md px-3 py-1 text-sm">
            按钮 A
          </button>
          <button className="rounded-md border px-3 py-1 text-sm">按钮 B</button>
        </div>
      </div>
    </div>
  ),
};
