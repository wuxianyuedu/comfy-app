import type { Meta, StoryObj } from "@storybook/nextjs";

import { MessageCenterButton } from "./MessageCenterButton";
import { messageSceneArgType } from "../../../.storybook/message-center-sources";

/**
 * 底部状态栏的「消息」铃铛 —— 未读角标 + 开关全屏面板。
 *
 * ## 它为什么需要 story（而不是「按钮没什么可看的」）
 *
 * 它读的是 `message-center-store` 的 `messages` / `open`，而画布上真正要看的
 * 是**三件派生的事**：
 *
 * 1. **角标公式** `unread > 99 ? "99+" : unread` —— 封顶那一档（100 条）看不出
 *    来就看不出「99 之后又有一条」和「99 之后又一百条」的区别；
 * 2. **`unread === 0` 时角标整个不渲染**（不是渲染一个 `0`）；
 * 3. **`open || unread > 0` 时的色调**（`text-primary`）vs 都没有时的
 *    `text-ink-muted` —— 换句话说，这一枚按钮的「亮着」有两种来路：有未读，
 *    或者面板正开着。摆一档「面板开着但都读过了」才看得出第二种来路。
 *
 * 三条都是**派生量**，手摆一份 `unread` 数字就把它们全跳过（同 store 层那条
 * 「不许手捏条目」的口径）。所以这里同样走注入层：story 声明生产方，条目经
 * 真 action `push()` 落板，角标由组件自己算。
 *
 * `closed` 那一档是**面板关着**的样子 —— 铃铛在状态栏行内、面板不渲染。
 * 它与 `allRead` 的区别值得摆在一起看：后者面板开着，前者关着，两者的铃铛
 * 都不该亮。
 */
const meta = {
  title: "MessageCenter/Button",
  component: MessageCenterButton,
  argTypes: { sceneName: messageSceneArgType() },
  decorators: [
    /* 真机上它长在底部状态栏那一条里（`h-6` 的一条）。摆进同形状的行内，
       否则量到的是孤立按钮的尺寸、不是它在状态栏里的样子。 */
    (Story) => (
      <div className="bg-canvas border-border-strong text-ink-muted text-2xs flex h-6 w-fit items-center gap-2 border-t px-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<{ sceneName: string }>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 把「选中的场景」同时交给装饰器（`parameters`）与 Args 面板（`args`）。 */
function sceneStory(sceneName: string): Story {
  return { args: { sceneName }, parameters: { messageScene: sceneName } };
}

/** 面板关着、一条未读 —— 角标 `1`、色调亮起（`unread > 0` 那一路）。 */
export const Unread: Story = sceneStory("closed");

/**
 * 100 条未读 —— 角标**封顶**成 `99+`。
 *
 * 与上一档的区别只有数量，而角标公式的边界（`> 99`）恰好在这一档才在场：
 * 只看 1 条的话，`99+` 那条分支从来没被看见过。
 */
export const OverflowingUnread: Story = sceneStory("closed");

/**
 * 面板开着、消息都已读 —— 角标不该出现，而色调**仍然亮着**。
 *
 * 这是「亮着」的第二条来路（`open === true`）：只看未读那一路的话，
 * 会以为「没有未读 = 一定是灰的」，而真机上正开着面板时它不是。
 *
 * ## 这一档必须把全屏面板挪开，否则量的不是这颗按钮
 *
 * `MessageCenterPanel` 是 `fixed`（`top-title-bar right-0 bottom-0 left-0`，见
 * `full-screen-layer`）—— 它是**全局**挂的（`withAppProviders` 里那一处，与
 * `src/app/layout.tsx` 同形）。于是 `open: true` 的场景下，面板把整块视口铺满，
 * 连带把本件（它自己的触发按钮）一起盖在底下：画布上看到的是「面板 + 一个左上
 * 角露出来的铃铛」，而**要看的那颗按钮的角标/色调根本不在画面上**。
 *
 * 所以这一档显式声明 `parameters.messagePanelHidden: true` —— 外壳**不挂**那块
 * 全屏面板，组件照常从 store 读到 `open: true`（面板挂不挂与 store 里的值是两件
 * 事）。不这么做的替代方案有两条，都不如它：改全局装饰器的顺序会牵动其余 122 份
 * story；把面板用 CSS 藏起来则会留下「DOM 在、面板没画」这个第二形态。
 */
export const OpenAndAllRead: Story = {
  args: { sceneName: "allRead" },
  /* 只换 `open`：消息仍是「都已读」那批（`allRead` 场景 push 完且 `markAllRead`
     过了），而面板不铺出来 —— 见上面那段。`open` 那一维由按钮自己的 class 表达
     （`open || unread > 0` ⇒ `text-primary`），不必真的把面板画出来。 */
  parameters: { messageScene: "allRead", messagePanelHidden: true },
};
