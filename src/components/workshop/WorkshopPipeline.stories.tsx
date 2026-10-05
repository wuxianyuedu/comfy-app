import type { Meta, StoryObj } from "@storybook/nextjs";

import { WorkshopPipeline } from "~/components/workshop/WorkshopPipeline";
import {
  projectScene,
  useSeededProjects,
} from "../../../.storybook/screen-frame";

/**
 * 工坊管线 —— 整屏容器这一族里**子件最多**的一屏（第三层注入）。
 *
 * 它是薄容器：`useWorkshopPipeline()` 给全部业务状态，本文件只负责「取 controller →
 * 组合视图 → 挂弹层」。所以 story 能给的就是它**需要的前提**，而它需要两层：
 *
 *  · **一个活跃项目**（`canvas-store`）：草稿与成片都挂在 `getActiveId()` 上，
 *    而这个 id 是在**挂载那一刻**读的（`useState` 初始化器）—— 所以项目必须在
 *    子树渲染**之前**就建好，否则这一屏摆的是「没有项目」那个形态。这正是
 *    `useSeededProjects()` 走惰性初始化器而不是 `useEffect` 的原因；
 *  · **tRPC 与 LLM 链路**：全局装饰器已经给了真 tRPC（`data-sources.tsx`），
 *    应用没起时看到的是真实的**降级形态** —— 三栏的骨架还在、阶段数据是空的。
 *    那不是 story 坏了（口径与 `LocalComputeCard` 那一份一致）。
 *
 * 标题那一格有个容易误读的地方，写在这免得下一个人去「修」它：顶栏显示的
 * **不是项目名**，而是**草稿**的 `meta.title`（`~/lib/workshop/script-parser` 给
 * 新草稿的默认值是「未命名项目」）。项目名要等用户在「剧本」阶段给一句话标题/
 * 标题之后才会走上去 —— 所以一个**已命名项目**配一份**新草稿**时，画布上仍是
 * 「未命名项目」，那是真实产品行为。
 *
 * 要看的是整屏才看得出来的东西：**三列（阶段轨道固定列 + 内容 + 右侧检查/素材）
 * 在窄屏下会不会把中间那列挤没**，以及**整屏只有一条纵向滚动条**（外框吃满、
 * 内层自己滚的那条契约 —— 历史上这里叠过两条滚动条）。
 */
const meta = {
  title: "Workshop/WorkshopPipeline",
  component: WorkshopPipeline,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkshopPipeline>;

export default meta;

type Story = StoryObj<typeof WorkshopPipelineHarness>;

/** 适配件：备好真项目，再把整屏摆出来。 */
function WorkshopPipelineHarness() {
  useSeededProjects({
    primary: projectScene("namedProject"),
    extraNames: [],
  });
  return (
    <div className="bg-bg text-ink h-[720px] w-full overflow-hidden">
      <WorkshopPipeline />
    </div>
  );
}

/**
 * 整屏（默认宽度）：三列 + 阶段轨道。
 *
 * 后端没起时这是它真实的**降级形态** —— 骨架在、内容是空态。真机上「只看骨架」
 * 这一档反而最难复现（要么全起、要么全不起）。
 */
export const Default: Story = {
  render: () => <WorkshopPipelineHarness />,
};
