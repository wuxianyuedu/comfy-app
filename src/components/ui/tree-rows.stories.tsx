import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Disclosure } from "~/components/ui/disclosure";
import { TREE_INDENT_STEP, TreeChildren, TreeRow, indentClass } from "~/components/ui/tree-rows";

/**
 * `TreeRow` / `TreeChildren` 是「一棵树的层级关系怎么画」的唯一实现（规范 16 §16.2.4.39）。它与另两个出口是同一件事的三层：`ExpansionSet` 管哪些行折着（状态）、`Disclosure` 管一行怎么折（交互与 a11y）、本件管缩进与子行归属。
 * 这条账的形状是「渲染那一侧没人管」：`NodesTab` 三层各写各的容器，三处都编译、外观看着都对，差别只在缩进语义（引导线取哪档、`ml-3` 还是 `border-t`、容器属于哪条父行）—— 没有报错，只能靠「同一件事只允许一处实现」从结构上消除。故 story 按层级深度分组。
 */
const meta = {
  title: "UI/TreeRows",
  component: TreeRow,
  args: { row: "一行" },
} satisfies Meta<typeof TreeRow>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 一行（带一个子容器）：缩进档与引导线由 `TreeChildren` 一次给全
 *  —— 调用处只给 `row` 与子行内容。 */
export const SingleLevel: Story = {
  render: () => (
    <div className="w-120 rounded-lg border p-3">
      <TreeRow row={<span className="text-sm font-medium">节点包</span>}>
        <div className="text-ink-muted text-sm">子行 A</div>
        <div className="text-ink-muted text-sm">子行 B</div>
      </TreeRow>
    </div>
  ),
};

/** 三层嵌套：每一层的缩进档**必须同一个值** —— 这正是 `TREE_INDENT_STEP`
 *  是常量而不是让调用处各写 `ml-3` 的理由（各写各的就会出现「第二层缩 12px、
 *  第三层缩 8px」这种只有深树上才看得出来的错位）。 */
export const NestedThreeLevels: Story = {
  render: () => (
    <div className="w-120 rounded-lg border p-3">
      <TreeRow row={<span className="text-sm font-medium">自定义节点目录</span>}>
        <TreeRow depth={1} row={<span className="text-sm">─ style_pack</span>}>
          <TreeRow depth={2} row={<span className="text-sm">─ 高光增强</span>}>
            <div className="text-ink-muted text-xs">3 个节点</div>
          </TreeRow>
          <TreeRow depth={2} row={<span className="text-sm">─ 边缘锐化</span>}>
            <div className="text-ink-muted text-xs">2 个节点</div>
          </TreeRow>
        </TreeRow>
      </TreeRow>
    </div>
  ),
};

/** 缩进档本身：`indentClass(depth)` 在 `depth<=0` 时**返回空串**（第一层由
 *  父行自己承载 —— 父行通常是卡片 / 分组头），从 1 起才是
 *  「缩进 + 引导线」。三档并排，看那条虚线从第几层开始出现。 */
export const IndentSteps: Story = {
  render: () => (
    <div className="flex w-120 flex-col gap-4">
      {[0, 1, 2].map((depth) => (
        <div className="flex flex-col gap-1" key={depth}>
          <span className="text-ink-muted font-mono text-[11px]">
            indentClass({depth}) = &quot;{indentClass(depth)}&quot;
          </span>
          <div className="rounded border border-dashed p-2">
            <TreeChildren depth={depth}>
              <div className="text-ink-muted text-xs">这一层的子行容器</div>
            </TreeChildren>
          </div>
        </div>
      ))}
      <p className="text-ink-muted text-xs">
        TREE_INDENT_STEP = &quot;{TREE_INDENT_STEP}
        &quot;（缩进与引导线是**一组**，分开写会 只写一半 —— `NodesTab` 此前正是「父级那层只有
        border-t、子包那层两样 都有」）
      </p>
    </div>
  ),
};

/** 与 `Disclosure` 配合：这是真实的树 —— 折叠归 `Disclosure`（它管
 *  「一行怎么折」），缩进与子行归属归本件。两层出口各管各的、叠在一起用。 */
export const WithDisclosure: Story = {
  render: () => (
    <div className="w-120 rounded-lg border p-3">
      <Disclosure defaultOpen trigger={<span className="text-sm font-medium">节点包 A</span>}>
        <TreeChildren>
          <Disclosure trigger={<span className="text-sm">─ 子包 A1</span>}>
            <TreeChildren>
              <div className="text-ink-muted text-xs">节点 1</div>
              <div className="text-ink-muted text-xs">节点 2</div>
            </TreeChildren>
          </Disclosure>
        </TreeChildren>
      </Disclosure>
    </div>
  ),
};
