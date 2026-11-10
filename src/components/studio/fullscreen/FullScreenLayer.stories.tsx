import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { FullScreenLayer } from "~/components/studio/fullscreen/FullScreenLayer";
import { titleBarHeightPx } from "~/lib/full-screen-layer";
import { zClass } from "~/lib/shell/overlay-z";

/** 全屏视图层 story —— 应用内「全屏」统一容器（设置、工作流编辑器、脚本编辑器、消息中心…）。
 * 纯 props（zClass + 布局 class + 三个 a11y 属性），但铺在哪儿是判据：用 `top-title-bar` 而非 `inset-0`，
 * 让出标题行，页签与窗口按钮始终可见可点 —— 铺满的是标题行下方内容区，不是整个窗口。
 * 三起事故各一档：① inset-0 盖住页签；② 让位后被 InternalBackdrop 压住命中测试（标题行须抬到 z-chrome）；
 * ③ 铺到 bottom-0 被状态栏压住 24px。zClass 由调用处从刻度表取，本件不猜层级。 */
const TITLE_BAR_PX = titleBarHeightPx();

/**
 * 假 chrome 的层级也取自刻度表（~/lib/shell/overlay-z），不写裸数字：
 * 标题行走 chrome（应用级，恒在其余档之上）、底部状态栏走 toast。
 * `check-overlay-z` 硬闸会拦裸 z-<数字>，报错是对的：假 chrome 用别处层级就演示了不存在的世界。
 */
const Z_CHROME = zClass("chrome");
const Z_TOAST = zClass("toast");

/**
 * 本件的入参里也有 `children`，所以与 `ViewContainer.stories.tsx` 同一口径：
 * 声明一份 story 自己的 Args，`component` 指向适配件。
 */
type StoryArgs = { zClass: string };

/** 适配件：`zClass` 进 Args，正文由各 story 的 `render` 给。 */
function LayerSample({ zClass: z, children }: StoryArgs & { children?: React.ReactNode }) {
  return (
    <FullScreenLayer className="bg-bg flex flex-col" zClass={z}>
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
 * 模拟 chrome：它浮在 story 容器之上，不是容器里的 div —— FullScreenLayer 自己写 `fixed`（相对视口），
 * 本件唯一真实形态就是「铺满视口、顶端让出一条」。
 * 早先放在 relative 容器里导致假 chrome 与真浮层不在同一坐标系，让位关系完全没被表达；
 * 现在与 fixed 同级定位，并显式说明它就是 titleBarHeightPx() 那一条。 */
function ChromeFrame({
  showStatusBar = false,
  children,
}: {
  children: React.ReactNode;
  showStatusBar?: boolean;
}) {
  return (
    <div className="bg-canvas-deep border-border-strong relative h-104 w-full overflow-hidden rounded-xl border">
      {children}
      <div
        className={`bg-canvas border-border h-title-bar absolute inset-x-0 top-0 flex items-center gap-2 border-b px-3 ${Z_CHROME}`}
      >
        <span className="text-ink-soft text-[11px]">标题行（页签栏 · z-chrome）</span>
        <span className="bg-primary text-primary-foreground rounded px-2 py-0.5 text-[11px]">
          画布
        </span>
        <span className="text-ink-faint rounded px-2 py-0.5 text-[11px]">工坊</span>
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
 * 把 `fixed` 换回 `absolute` 的展示壳。判据模块 class 串第一条是 `fixed`（真机相对视口是对的），
 * 但 story 画布本身也是视口，直接用会铺满工作台、盖掉参照物。
 * 所以只在 story 内把 fixed 换成 absolute，让定位祖先变成该容器；`top-title-bar right-0 bottom-0 left-0` 一条不动。
 */
function InContainer({
  zClass: z,
  chrome = "title",
  a11y,
  children,
}: {
  a11y?: {
    "aria-label"?: string;
    "aria-modal"?: boolean;
    role?: string;
  };
  children: React.ReactNode;
  chrome?: "title" | "title+status";
  zClass: string;
}) {
  return (
    <ChromeFrame showStatusBar={chrome === "title+status"}>
      <div className="absolute inset-0">
        <FullScreenLayer className="bg-bg absolute flex flex-col" zClass={z} {...a11y}>
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
      a11y={{
        role: "dialog",
        "aria-modal": true,
        "aria-label": "系统消息中心",
      }}
      zClass={args.zClass}
    >
      <div className="text-ink-soft flex flex-1 items-center justify-center text-xs">
        遮罩式全屏面板（读屏器播报 aria-label）
      </div>
    </InContainer>
  ),
};

/**
 * 底边让位：铺到 `bottom-0` 会被状态栏压住最后 24px（「日志最下方几行看不全」事故的形状）。
 * 需要让出底边的浮层应改用 FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS（bottom-6），那属另一档，不归本件管。
 */
export const StatusBarOverlap: Story = {
  render: (args) => (
    <InContainer chrome="title+status" zClass={args.zClass}>
      <div className="text-ink-soft flex flex-1 items-center justify-center text-xs">
        内容铺到 bottom-0 —— 最后 24px 被状态栏压住
      </div>
    </InContainer>
  ),
};
