import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  KeyValueRows,
  type KeyValueItem,
  type KeyValueLayout,
} from "~/components/ui/key-value-rows";

/**
 * `KeyValueRows` 是「把一个对象渲染成键值行」的**唯一出口**（规范 16 §16.2.4.20）。
 *
 * 它收的是全库 5 处各写一遍的「标签 + 值 + 空值占位」：`ProjectOutputs` 的参数表、
 * `HistoryDetailModal` 的生成参数卡与参数表、`TrainingStudio` 的 Metrics、
 * `BrowserStatusBar` 的显存/内存。同一件事曾有**四种布局语言、五份 `map`** ——
 * 而「空值显示什么」早就由 `~/lib/display-value` 的 `displayValue` 收口了，
 * 剩下的只有**布局**这一层没被说出来。本组件收的就是这一层。
 *
 * 所以 story 按**四档 `layout`** 分组 —— 这就是本件存在的全部理由，
 * 其它 props（`bordered` / `striped` / `hint` / `itemClassName`）都是它的修饰。
 *
 * `value` 有两个互斥的写法：`value`（已渲染的节点，可以含徽标/链接）与
 * `raw`（原始值，交给 `displayValue`，`null`/`undefined`/`""` 自动给 `—`）。
 */
type Layout = NonNullable<KeyValueLayout>;

const LAYOUTS: Layout[] = ["rows", "stacked", "table", "inline"];

const meta = {
  title: "UI/KeyValueRows",
  component: KeyValueRows,
  args: { items: [{ key: "样例", raw: "值" }] },
} satisfies Meta<typeof KeyValueRows>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 样本：一份训练参数（四种布局共用同一份数据，才比得出布局差异）。 */
const PARAMS: KeyValueItem[] = [
  { key: "base_model", raw: "sd_xl_base_1.0.safetensors" },
  { key: "steps", raw: 2400 },
  { key: "learning_rate", raw: 0.0001 },
  { key: "trigger_word", raw: null },
  { key: "分辨率", raw: "1024×1024" },
];

/** `rows`（缺省）：一行一对，标签左、值右，值走等宽字体。
 *  `bordered` / `striped` 是它的两个修饰 —— 参数表那种「扫一眼读数值」。 */
export const Rows: Story = {
  render: () => (
    <div className="flex w-120 flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          rows（默认）
        </span>
        <KeyValueRows items={PARAMS} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          rows + bordered + striped
        </span>
        <KeyValueRows items={PARAMS} bordered striped />
      </div>
    </div>
  ),
};

/** `stacked`：标签在值**上方**，多列网格，`hint` 落在值下面一行 ——
 *  仪表盘指标（训练步数 / 触发词 / 底模）的形态。 */
export const Stacked: Story = {
  render: () => (
    <KeyValueRows
      layout="stacked"
      className="w-xl"
      items={PARAMS.map((item) => ({ ...item, hint: "取自最近一次训练" }))}
    />
  ),
};

/** `table`：真正的 `<table>`，行表头走 `<th scope="row">` ——
 *  两列参数表（左列等宽截断）的形态，语义比一堆 div 强。 */
export const TableLayout: Story = {
  render: () => (
    <KeyValueRows layout="table" className="w-120" items={PARAMS} />
  ),
};

/** `inline`：`label value` 挤在一行不换行的内联项 ——
 *  状态栏那种「一行里塞好几个指标」的形态。 */
export const Inline: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border px-3 py-2">
      <KeyValueRows
        layout="inline"
        items={[
          { key: "显存", raw: "6.4 GB" },
          { key: "内存", raw: "11.2 GB" },
          { key: "队列", raw: 2 },
          { key: "错误", raw: null },
        ]}
      />
    </div>
  ),
};

/** 四档并排对照 —— 这是本件最该有的一张图：**同一份数据在四种布局下长什么样**
 *  （五份旧实现各用一种，谁也没见过另外三种）。 */
export const AllLayouts: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      {LAYOUTS.map((layout) => (
        <div key={layout} className="flex flex-col gap-1.5">
          <span className="text-ink-muted font-mono text-[11px]">
            layout={layout}
          </span>
          <KeyValueRows
            layout={layout}
            className="w-136"
            items={PARAMS}
            bordered={layout === "rows"}
          />
        </div>
      ))}
    </div>
  ),
};

/** `value` vs `raw` 两条路：`value` 给已渲染的节点（可含徽标 / 链接），
 *  `raw` 交给 `displayValue`（`null` / `undefined` / `""` 自动给 `—`）。
 *  缺值那三行的占位符就是 `displayValue` 的一句话。 */
export const ValueVsRaw: Story = {
  render: () => (
    <KeyValueRows
      className="w-120"
      bordered
      items={[
        { key: "raw: 数字", raw: 42 },
        { key: "raw: null", raw: null },
        { key: "raw: 空串", raw: "" },
        { key: "raw: undefined", raw: undefined },
        { key: "raw: 布尔", raw: false },
        {
          key: "value: 节点",
          value: <span className="text-primary-strong">已渲染的节点</span>,
        },
      ]}
    />
  ),
};
