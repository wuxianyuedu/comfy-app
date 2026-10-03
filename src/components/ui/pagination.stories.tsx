import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "~/components/ui/pagination";

/**
 * `ui/pagination` 是**受控**分页导航：它只画，不存状态（当前页归调用处的
 * URL State 或 store —— 规范 09 §9.3）。所以 story 给的是**几种页数形状**，
 * 而不是「点一下会变」（那是调用处的逻辑，不是基元的形态）。
 *
 * 两件事只有渲染出来才看得出：
 * 1. `PaginationPrevious` / `PaginationNext` 的文案在 `sm` 以下**收成图标**
 *    （`hidden sm:block` 的 span）—— 窄画布下它只剩一个箭头；
 * 2. `PaginationLink` 的 `isActive` 走 `variant="outline"` + `aria-current`，
 *    不是自己写底色。
 */
const meta = {
  title: "UI/Pagination",
  component: Pagination,
} satisfies Meta<typeof Pagination>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 页数不多：全部页码平铺，当前页用 `isActive`。 */
export const Default: Story = {
  render: (args) => (
    <Pagination {...args}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        {[1, 2, 3].map((page) => (
          <PaginationItem key={page}>
            <PaginationLink href="#" isActive={page === 2}>
              {page}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
};

/** 页数很多：中间用 `PaginationEllipsis` 折叠
 *  —— 它自己带 `aria-hidden` 与 `sr-only` 的「More pages」。 */
export const WithEllipsis: Story = {
  render: (args) => (
    <Pagination {...args}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive>
            12
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">48</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
};

/** 边界两档：第一页（上一页禁用）与最后一页（下一页禁用）。禁用走的是
 *  `aria-disabled` + `pointer-events-none`，**不是** `disabled` —— 这么写
 *  是为了让链接在键盘上仍可被读到，而不是从 tab 序列里消失。 */
export const Boundaries: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-4">
      <Pagination {...args}>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious aria-disabled href="#" />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#" isActive>
              1
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#">2</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href="#" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious href="#" />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#">47</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#" isActive>
              48
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext aria-disabled href="#" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  ),
};
