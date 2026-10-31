import type { Meta, StoryObj } from "@storybook/nextjs";

import { MessageCenterPanel } from "./MessageCenterPanel";
/* 注入层走相对路径：`~` 别名映射的是 `./src/*`，`.storybook/` 不在它的取值域里
   （点目录也不在 tsc / eslint 的 glob 默认展开范围 —— 那两条通配是显式列的）。 */
import {
  messageSceneArgType,
  type MESSAGE_SCENE_NAMES,
} from "../../../.storybook/message-center-sources";

/**
 * 消息中心全屏面板 —— 承载「只看一次就消失」的系统级提示（本地更新需重启、
 * dev server 重启、陈旧实例）。
 *
 * ## 为什么它有 story
 *
 * 它的入参只有 `children`（本件甚至没有）—— 看起来是纯展示件。但它的数据
 * **不经过 props**：`messages` 与 `open` 住在 `message-center-store` 里，组件
 * 自己 `useMessageCenterStore(...)` 取。手捏一份 `MessageRecord[]` 塞进 store
 * 就是手捏一份假形态（绕过 `push()` 的 id 生成与 `MAX_MESSAGES` 裁剪），
 * 所以走 `.storybook/message-center-sources.tsx` 那条注入层：story 声明
 * **哪一处生产方在生产**，文案由生产方现算、条目经真 action `push()` 落板。
 *
 * ## 一档容易漏的
 *
 * `open === false` 时本件 `return null` —— 所以「只推消息、不管 `open`」的
 * story 在画布上是**一片空白**，而那与 §16.2.3.4 那个「侧栏有故事、画布一片
 * 空白」的坑同形。场景里的 `open` 因此是场景的一部分，`empty` 那档也照样
 * `open: true`（「面板开着但列表空着」是个真形态，不是「空」的开关）。
 */
const meta = {
  component: MessageCenterPanel,
  title: "MessageCenter/Panel",
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
 *
 * 这一档是**降级形态**的一种 —— 手捏消息时最容易漏，因为手捏的那份默认就是未读。
 * 末态由**真动作** `markAllRead()` 达成（场景的 `markAllRead: true`），不是逐条
 * 写 `read: true` —— 那样抄的是末态，验不到动作本身。
 */
export const AllRead: Story = sceneStory("allRead");

/**
 * 零消息：头部落「暂无消息」、列表落 `Inbox` 空态。
 *
 * 「全部已读」那档与这一档不可互替 —— 前者有列表没有未读，后者连列表都没有。
 */
export const Empty: Story = sceneStory("empty");
