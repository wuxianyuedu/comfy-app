import React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { Disclosure, type DisclosureMarker } from "~/components/ui/disclosure";

/**
 * `Disclosure` 是「点一行标题、把一段内容折叠 / 展开」的**唯一实现**
 * （规范 16 §16.2.4.13）。
 *
 * 它替代的是库里**三种**并行写法：原生 `<details>` 六处、自绘
 * 「布尔 state + 条件渲染 + ▸/▾」四处、以及树形结构的 `expandedParents`
 * 那份映射。三种的差别不是风格，而是**无障碍语义各写各的**：`<details>`
 * 天生带 `role` / `aria-expanded` / 键盘切换 / 「页内查找时自动展开」，
 * 自绘那份基本只有 `onClick`（`NodesTab` 还为此专门补了 `role="button"`
 * 与 Enter/Space —— 而注释里写着「不能用原生 button，因为嵌在 button 里非法」，
 * 那正是自绘外壳逼出来的绕路）。
 *
 * 形态取 base-ui `Collapsible` 而不是原生 `<details>`，为的是同时拿到：
 * `hidden="until-found"`（保留 `details` 最值钱的「页内查找自动展开」）、
 * 基元给的 `aria-expanded` / `aria-controls` / 键盘语义、以及受控 / 非受控两用。
 *
 * 三根轴：
 * - `marker`：折叠标记的形态（`caret` ▸▾ / `chevron` / `none` 由调用处自绘）；
 * - `open` + `onOpenChange`：受控（`ErrorPanel` 的展开态会被运行状态重置）；
 * - `leading` / `trailing`：与触发开关**同排**的内容 —— 用途是「一排按钮里
 *   只有一个是折叠开关」（基元的 trigger 是 `<button>`，往里塞 `<Button>`
 *   在 HTML 里非法）。**同排要靠 `rootClassName="flex …"` 给布局**。
 */
type Marker = NonNullable<DisclosureMarker>;

const MARKERS: Marker[] = ["caret", "chevron", "none"];

const meta = {
  title: "UI/Disclosure",
  component: Disclosure,
  args: { trigger: "折叠区域", children: "这里是展开后的内容。" },
} satisfies Meta<typeof Disclosure>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="w-[30rem] rounded-lg border p-3">
      <Disclosure {...args} />
    </div>
  ),
};

/** 三种标记并排：`caret`（▸/▾ 字符）、`chevron`（lucide，展开时转 90°）、
 *  `none`（调用处自绘）—— 三档之间的差别只有真展开才看得出。 */
export const Markers: Story = {
  render: () => (
    <div className="flex w-[30rem] flex-col gap-3">
      {MARKERS.map((marker) => (
        <div key={marker} className="rounded-lg border p-3">
          <Disclosure
            marker={marker}
            defaultOpen={marker !== "none"}
            trigger={
              marker === "none" ? (
                <>
                  <span aria-hidden>▼</span> marker=none（自绘标记）
                </>
              ) : (
                `marker=${marker}`
              )
            }
          >
            <p className="text-ink-muted pt-2 text-sm">
              这一档的标记是这样画的。
            </p>
          </Disclosure>
        </div>
      ))}
    </div>
  ),
};

/** 受控：`open` / `onOpenChange` 由外部状态驱动 —— 这是 `ErrorPanel` 那种
 *  「展开态会被运行状态重置」的场景。按钮与开关是两个状态源，能各自改它。 */
export const Controlled: Story = {
  render: () => <ControlledDemo />,
};

function ControlledDemo() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex w-[30rem] flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Button size="xs" variant="outline" onClick={() => setOpen((o) => !o)}>
          外部按钮切换（当前 {open ? "展开" : "折叠"}）
        </Button>
      </div>
      <Disclosure open={open} onOpenChange={setOpen} trigger="受控的折叠区">
        <p className="text-ink-muted pt-2 text-sm">
          上面那个按钮与这行标题改的是同一份状态。
        </p>
      </Disclosure>
    </div>
  );
}

/** `leading` + `trailing` 同排：一排按钮里只有一个是折叠开关时，
 *  其余放 `leading` / `trailing`（**不能塞进 trigger** —— trigger 是
 *  `<button>`，里面套 `<Button>` 在 HTML 里非法）。
 *  同排要靠 `rootClassName="flex flex-wrap items-center gap-2"`。 */
export const WithLeadingTrailing: Story = {
  render: () => (
    <div className="w-[36rem] rounded-lg border p-3">
      <Disclosure
        rootClassName="flex flex-wrap items-center gap-2"
        panelClassName="basis-full"
        trigger="服务器返回的错误详情"
        leading={
          <>
            <Button size="xs" variant="ghost">
              复制
            </Button>
            <Button size="xs" variant="ghost">
              重试
            </Button>
          </>
        }
        trailing={<span className="text-ink-muted text-xs">14:02:31</span>}
      >
        <pre className="text-ink-muted basis-full pt-2 font-mono text-xs whitespace-pre-wrap">
          {`TypeError: Cannot read properties of undefined (reading 'subscribe')\n  at CommandInput (command.tsx:78)`}
        </pre>
      </Disclosure>
    </div>
  ),
};

/** 禁用：`disabled` 时触发开关不可点（键盘也不响应）—— 权限不足 /
 *  数据没到齐时用它，而不是把这一行藏掉。 */
export const Disabled: Story = {
  render: (args) => (
    <div className="w-[30rem] rounded-lg border p-3">
      <Disclosure {...args} disabled trigger="还没解析出节点（禁用）" />
    </div>
  ),
};
