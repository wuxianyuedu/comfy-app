import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { MessageCenterPanel } from "./MessageCenterPanel";
/* 注入层走相对路径：`~` 别名映射的是 `./src/*`，`.storybook/` 不在它的取值域里
   （点目录也不在 tsc / eslint 的 glob 默认展开范围 —— 那两条通配是显式列的）。 */
import {
  messageSceneArgType,
  type MESSAGE_SCENE_NAMES,
} from "../../../.storybook/message-center-sources";

/**
 * 消息中心全屏面板 —— 承载「只看一次就消失」的系统级提示。数据**不经过 props**：
 * `messages` / `open` 住在 store，手捏塞进去就是假形态（绕过 `push()` 的 id 生成与
 * `MAX_MESSAGES` 裁剪），故走注入层。注意 `open === false` 时本件 `return null`。
 */
const meta = {
  title: "MessageCenter/Panel",
  component: MessageCenterPanel,
  /* 场景旋钮走 `args`：Args 面板只认 args，不认 `parameters` 里的嵌套键
     （与值源那条同口径）。装饰器读的是 `parameters.messageScene`，所以下面
     每一档 story 自己把 args 那个值搬进 parameters —— 见 `sceneStory()`。 */
  argTypes: { sceneName: messageSceneArgType() },
} satisfies Meta<{ sceneName: string }>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 把「选中的场景」同时交给装饰器（`parameters`）与 Args 面板（`args`）。 */
function sceneStory(sceneName: (typeof MESSAGE_SCENE_NAMES)[number]): Story {
  return {
    args: { sceneName },
    parameters: { messageScene: sceneName },
  };
}

/** 三种 kind 同屏 —— `KIND_META` 三档的图标 / 色调 / 描边一起在场。 */
export const Mixed: Story = sceneStory("mixed");

/** 一条未读：头部「1 条 · 1 条未读」，列表一条。 */
export const SingleUnread: Story = sceneStory("singleUnread");

/**
 * 未读计数溢出：角标公式是 `unread > 99 ? "99+" : String(unread)`，所以
 * 100 条是**边界值**（99 显数字、100 显 `99+`）。
 */
export const OverflowingUnread: Story = sceneStory("overflowingUnread");

/**
 * 全部已读：头部「N 条 · 0 条未读」，「全部已读」按钮 `disabled`（`unread === 0`）。
 * 手捏消息最容易漏这档（手捏默认未读）；末态由真动作 `markAllRead()` 达成，
 * 不是逐条写 `read: true` —— 那样抄的是末态，验不到动作本身。
 */
export const AllRead: Story = sceneStory("allRead");

/**
 * 零消息：头部落「暂无消息」、列表落 `Inbox` 空态。
 *
 * 「全部已读」那档与这一档不可互替 —— 前者有列表没有未读，后者连列表都没有。
 */
export const Empty: Story = sceneStory("empty");
