import type { Meta, StoryObj } from "@storybook/nextjs";

import { FullScreenLayer } from "~/components/studio/fullscreen/FullScreenLayer";
import { titleBarHeightPx } from "~/lib/full-screen-layer";
import { zClass } from "~/lib/shell/overlay-z";

/**
 * 全屏视图层 —— 应用内「全屏」的统一容器（设置页、工作流编辑器、脚本编辑器、
 * 消息中心…都铺在它里面）。
 *
 * 纯 props（`zClass` + 布局 class + 三个 a11y 属性），但它铺在哪儿**是判据**：
 * 注意这里给的是 `top-title-bar` 而不是 `inset-0` —— 让出标题行，页签与右上角
 * 窗口按钮才一直看得见、点得动。所以下面那个假标题行不是装饰，它是这条 story
 * 唯一要表达的关系：**铺满的是「标题行下方的内容区」，不是整个窗口**。
 *
 * 三条历史事故都收在这件组件与它的判据模块（`~/lib/full-screen-layer`）里：
 *   ① 第一次用 `inset-0` 盖住页签 → 用户再也切不回别的页签；
 *   ② 几何让位了但仍被 base-ui 的 `InternalBackdrop` 压在命中测试之后 →
 *      「看得见、点不动」，所以标题行还必须抬到 `z-chrome`；
 *   ③ 铺到 `bottom-0` 的浮层最后 24px 被底部状态栏压住 → 日志最下方几行看不全。
 * 三件事在 story 里各有一档（前两档看「让出顶部」，第三档看「让出底部」）。
 *
 * `zClass` 由调用处从浮层刻度表取（`zClass("modal")`，调试类视图可下探到
 * `Z.base`）—— 本件不猜层级。
 */
const TITLE_BAR_PX = titleBarHeightPx();

/**
 * 假 chrome 的层级也**取自刻度表**（`~/lib/shell/overlay-z`），不写裸数字：
 * 标题行走 `chrome`（应用级 chrome，恒在其余所有档之上）、底部状态栏走 `toast`
 * —— 真机上就是这两档。`check-overlay-z` 的硬闸会拦下裸 `z-<数字>`，
 * 而这条报错是对的：假 chrome 用别处的层级，这条 story 就演示了一个不存在的世界。
 */
const Z_CHROME = zClass("chrome");
const Z_TOAST = zClass("toast");

/**
 * 本件的入参里也有 `children`，所以与 `ViewContainer.stories.tsx` 同一口径：
 * 声明一份 story 自己的 Args，`component` 指向适配件。
 */
type StoryArgs = { zClass: string };

/** 适配件：`zClass` 进 Args，正文由各 story 的 `render` 给。 */
function LayerSample({
  zClass: z,
  children,
}: StoryArgs & { children?: React.ReactNode }) {
  return (
    <FullScreenLayer zClass={z} className="bg-bg flex flex-col">
      {children}
    </FullScreenLayer>
  );
}

const meta = {
  title: "Studio/FullScreenLayer",
  component: LayerSample,
  args: { zClass: zClass("modal") },
  argTypes: {
    zClass: {
      control: { type: "select" },
      options: [zClass("modal"), zClass("base")],
    },
  },
} satisfies Meta<StoryArgs & { children?: React.ReactNode }>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 模拟 chrome：**它是浮在 story 容器之上的**，不是容器里的一个 div ——
 * 因为 `FullScreenLayer` 自己写的是 `fixed`（相对视口定位），本件唯一的真实
 * 形态就是「铺满整个视口、顶端让出那一条」。
 *
 * 早先的版本把假标题行放在一个 `relative` 容器里，结果是假 chrome 与真浮层
 * **不在同一个坐标系**：画布上看着「浮层把容器盖住了」，而真机上的让位关系
 *（盖住谁、让出谁）完全没被表达出来。所以这里改成与 `fixed` 同级的定位，
 * 并显式说明它就是 `titleBarHeightPx()` 那一条。
 */
function ChromeFrame({
  showStatusBar = false,
  children,
}: {
  showStatusBar?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-canvas-deep border-border-strong relative h-104 w-full overflow-hidden rounded-xl border">
      {children}
      <div
        className={`bg-canvas border-border h-title-bar absolute inset-x-0 top-0 flex items-center gap-2 border-b px-3 ${Z_CHROME}`}
      >
        <span className="text-ink-soft text-[11px]">
          标题行（页签栏 · z-chrome）
        </span>
        <span className="bg-primary text-primary-foreground rounded px-2 py-0.5 text-[11px]">
          画布
        </span>
        <span className="text-ink-faint rounded px-2 py-0.5 text-[11px]">
          工坊
        </span>
        <span className="text-ink-faint ml-auto font-mono text-[10px]">
          {String(TITLE_BAR_PX)}px = 2.25rem × 16px
        </span>
      </div>
      {showStatusBar && (
        <div
          className={`bg-canvas border-border absolute inset-x-0 bottom-0 flex h-6 items-center border-t px-3 ${Z_TOAST}`}
        >
          <span className="text-ink-faint text-[11px]">
            底部状态栏（恒在主页面底部 · 不让位就会被压住）
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * 把 `fixed` 换回 `absolute` 的展示壳。
 *
 * 判据模块算出来的 class 串里第一条就是 `fixed` —— 真机上那是对的（相对视口
 * 定位）。而 story 画布本身也是一个视口，直接用它会把浮层铺满整个工作台、
 * 把它外面的参照物全盖掉（连「让出了多少」都看不见）。
 *
 * 所以这里只做一件事：**在 story 内部**把 `fixed` 换成 `absolute`，让它的
 * 定位祖先变成那个容器。`top-title-bar right-0 bottom-0 left-0` 那三段一条不动
 * —— 要验的正是它们。视图自身布局仍由调用处给（`className`）。
 */
function InContainer({
  zClass: z,
  chrome = "title",
  a11y,
  children,
}: {
  zClass: string;
  chrome?: "title" | "title+status";
  a11y?: {
    role?: string;
    "aria-modal"?: boolean;
    "aria-label"?: string;
  };
  children: React.ReactNode;
}) {
  return (
    <ChromeFrame showStatusBar={chrome === "title+status"}>
      <div className="absolute inset-0">
        <FullScreenLayer
          zClass={z}
          className="bg-bg absolute flex flex-col"
          {...a11y}
        >
          {children}
        </FullScreenLayer>
      </div>
    </ChromeFrame>
  );
}

/** 常规用法：铺满内容区、顶部让出标题行 —— 页签一直在。 */
export const Default: Story = {
  render: (args) => (
    <InContainer zClass={args.zClass}>
      <div className="text-ink-soft flex flex-1 items-center justify-center text-xs">
        全屏视图内容 —— 上面那条标题行没有被盖住
      </div>
    </InContainer>
  ),
};

/** 遮罩式面板：`role="dialog"` + `aria-modal` + `aria-label`（消息中心那一族）。 */
export const MaskedPanel: Story = {
  render: (args) => (
    <InContainer
      zClass={args.zClass}
      a11y={{
        role: "dialog",
        "aria-modal": true,
        "aria-label": "系统消息中心",
      }}
    >
      <div className="text-ink-soft flex flex-1 items-center justify-center text-xs">
        遮罩式全屏面板（读屏器播报 aria-label）
      </div>
    </InContainer>
  ),
};

/**
 * 底边让位：铺到 `bottom-0` 的那一档会被状态栏压住最后 24px。
 *
 * 打开底栏再对比一眼 —— 这正是「日志最下方几行看不全」那条事故的形状；
 * 需要让出底边的浮层应改用 `full-screen-layer` 的
 * `FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS`（`bottom-6`），
 * 那是另一档定位，不归本件管。
 */
export const StatusBarOverlap: Story = {
  render: (args) => (
    <InContainer zClass={args.zClass} chrome="title+status">
      <div className="text-ink-soft flex flex-1 items-center justify-center text-xs">
        内容铺到 bottom-0 —— 最后 24px 被状态栏压住
      </div>
    </InContainer>
  ),
};
