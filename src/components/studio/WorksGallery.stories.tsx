import type { Meta, StoryObj } from "@storybook/nextjs";

import { WorksGallery } from "~/components/studio/WorksGallery";
import {
  projectScene,
  useSeededProjects,
} from "../../../.storybook/screen-frame";

/**
 * 「项目」页 —— 整屏容器这一族里最省前提的一屏（真读 `canvas-store`、零 tRPC）。
 *
 * 它是整屏容器的**内容侧**样板：这一族的故事里，容器（`AppShell` / 画布 /
 * 工坊）之所以能摆出真形态，靠的就是把这种真视图装进去 —— 而不是塞一个占位
 * `<div>`（见 `.storybook/screen-frame.tsx` 的第一条口径）。
 *
 * 要看的是**项目卡网格在两种数量下的形态**：
 *
 *  · **没有项目**：空态（不是「没渲染」，是这一档的空态卡）；
 *  · **有几张卡**：卡片网格 + hover 删除；卡片上的「最近更新」时间走 `timeAgo()`
 *    的导出（不手抄一句「刚刚」）。
 *
 * 项目一律走真 action（`useSeededProjects` → `createProject()`），因为
 * 「名字撞了怎么办」「有没有置为活跃」都在这套规则里，手拼字面量会跳过它们。
 */
const meta = {
  title: "Studio/WorksGallery",
  component: WorksGallery,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorksGallery>;

export default meta;

type Story = StoryObj<typeof GallerHarness>;

/** 适配件：真项目 + 真 `WorksGallery`；`count` 决定摆几屏。 */
function GallerHarness({ projectNames }: { projectNames: readonly string[] }) {
  const projects = useSeededProjects({
    primary: projectScene("namedProject"),
    extraNames: projectNames,
  });
  return (
    <div className="bg-bg h-180 w-full overflow-hidden">
      {/* `projects` 是 story 侧准备的真项目（真 action 建的），这里给的是
          「有几个」这个事实 —— 视图自己会从 canvas-store 读回同一批。 */}
      <WorksGallery
        onOpenCanvasProject={() => undefined}
        onOpenTask={() => undefined}
      />
      <span className="sr-only">{projects.length} 个真项目</span>
    </div>
  );
}

/** 一个项目：网格里一张卡（空态与有内容的分界）。 */
export const SingleProject: Story = {
  render: () => <GallerHarness projectNames={[]} />,
};

/** 五个项目：网格排布 + 卡片 hover 删除的那一档现场。 */
export const ManyProjects: Story = {
  render: () => (
    <GallerHarness
      projectNames={["城市夜景", "首帧 → 逐镜生成", "角色设定集", "片头试验"]}
    />
  ),
};

/**
 * 名字很长的项目混在网格里：卡片标题的截断（真机上项目名是一句话描述，
 * 长名会把网格行高撑乱）。
 */
export const LongNames: Story = {
  render: () => (
    <GallerHarness
      projectNames={[
        "角色一致性 · 三视图 + 首帧逐镜生成（第 2 版）",
        "城市夜景重制 · 雨后的霓虹街道",
      ]}
    />
  ),
};
