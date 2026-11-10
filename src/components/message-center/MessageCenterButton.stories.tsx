import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { MessageCenterButton } from "./MessageCenterButton";
import { messageSceneArgType } from "../../../.storybook/message-center-sources";

/**
 * 底部状态栏的「消息」铃铛 —— 未读角标 + 开关全屏面板。
 * 要看的三件派生事：角标封顶 `99+`、`unread === 0` 时角标不渲染、「亮着」有两条来路
 *（有未读 / 面板开着）——手摆 `unread` 会全跳过，故条目经真 action `push()` 落板。
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
 * 与上一档只差数量，而边界（`> 99`）恰在这一档才在场：只看 1 条的话，
 * `99+` 那条分支从来没被看见过。
 */
export const OverflowingUnread: Story = sceneStory("closed");

/**
 * 面板开着、消息都已读 —— 角标不该出现，而色调**仍然亮着**（`open === true` 这条来路）。
 * `MessageCenterPanel` 是全局挂的 `fixed` 全屏层，`open: true` 时会把本件盖在视口底下，
 * 故这一档显式声明 `parameters.messagePanelHidden: true`：外壳不挂面板，`open` 照常为真。
 */
export const OpenAndAllRead: Story = {
  args: { sceneName: "allRead" },
  /* 只换 `open`：消息仍是「都已读」那批（`allRead` 场景 push 完且 `markAllRead`
     过了），而面板不铺出来 —— 见上面那段。`open` 那一维由按钮自己的 class 表达
     （`open || unread > 0` ⇒ `text-primary`），不必真的把面板画出来。 */
  parameters: { messageScene: "allRead", messagePanelHidden: true },
};
