import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";

/**
 * `ui/accordion` 是 base-ui Accordion 的封装（**列表式折叠**）。
 *
 * 与 `ui/disclosure` 的差别值得说清，两者很容易被混为一谈：
 * - `Disclosure` 是**单个**折叠区（一行 + 一段内容），且形态由调用处拼；
 * - 本件是**一组**带 `AccordionItem` 分隔线的折叠区，`AccordionTrigger`
 *   自带上下两个 chevron（按 `aria-expanded` 互斥显示），
 *   `AccordionContent` 自带 `--accordion-panel-height` 驱动的展开动画。
 *
 * 于是 story 要看的是**组内联动**（`openMultiple`）与**分隔线**
 * （`not-last:border-b`）—— 这两件事在单项里都看不出来。
 *
 * 与 `ui/disclosure` 同源的口径：`AccordionContent` 也是
 * `hidden="until-found"` 那一路（浏览器页内查找会自动展开命中内容）。
 */
const meta = {
  title: "UI/Accordion",
  component: Accordion,
} satisfies Meta<typeof Accordion>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 默认（单开）：展开一项时另一项自动收起 —— 分隔线 `not-last:border-b`
 *  只在两项之间出现。 */
export const Default: Story = {
  render: () => (
    <Accordion className="w-lg">
      <AccordionItem value="a">
        <AccordionTrigger>输出设置</AccordionTrigger>
        <AccordionContent>
          <p className="text-ink-muted">
            默认 1024×1024，节点上的同名字段以节点为准。
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>采样设置</AccordionTrigger>
        <AccordionContent>
          <p className="text-ink-muted">
            dpmpp_2m + karras，24 步；这一组由工作流模板给出。
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="c">
        <AccordionTrigger>高级</AccordionTrigger>
        <AccordionContent>
          <p className="text-ink-muted">多数情况下不需要改这里。</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

/** 多开：`multiple` 让多项可以同时展开 —— 与默认档的差别只有这一处，
 *  但并排看才知道「一组里能同时开几个」是本件的一个开关。 */
export const MultipleOpen: Story = {
  render: () => (
    <Accordion className="w-lg" multiple defaultValue={["a", "c"]}>
      <AccordionItem value="a">
        <AccordionTrigger>输出设置</AccordionTrigger>
        <AccordionContent>
          <p className="text-ink-muted">这一项默认就展开。</p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>采样设置</AccordionTrigger>
        <AccordionContent>
          <p className="text-ink-muted">这一项点开不会把上面那个关掉。</p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="c">
        <AccordionTrigger>高级</AccordionTrigger>
        <AccordionContent>
          <p className="text-ink-muted">这一项也默认展开。</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

/** 禁用项：`disabled` 时触发开关 `pointer-events-none` + 半透明
 *  —— 「这一节现在不能改」的形态。 */
export const WithDisabled: Story = {
  render: () => (
    <Accordion className="w-lg">
      <AccordionItem value="a">
        <AccordionTrigger>可用</AccordionTrigger>
        <AccordionContent>这一节能展开。</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b" disabled>
        <AccordionTrigger>运行时不可改（禁用）</AccordionTrigger>
        <AccordionContent>按理看不到这段。</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

/** 展开动画：`AccordionContent` 走 `--accordion-panel-height` 驱动的
 *  `animate-accordion-down/up`（高度过渡）—— 静态截图看不出来，
 *  但**点开时的高度过渡**就是这条；两态并存可对照收起后的高度为 0。 */
export const AnimatedContent: Story = {
  render: () => (
    <Accordion className="w-lg" multiple defaultValue={["a"]}>
      <AccordionItem value="a">
        <AccordionTrigger>展开态（有内容高度）</AccordionTrigger>
        <AccordionContent>
          <p className="text-ink-muted">
            展开靠 `h-(--accordion-panel-height)`；收起时是 `h-0`。
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>收起态（高度为 0）</AccordionTrigger>
        <AccordionContent>
          <p className="text-ink-muted">点开看高度过渡。</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
