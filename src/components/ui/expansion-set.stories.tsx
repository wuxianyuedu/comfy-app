import type { Meta, StoryObj } from "@storybook/nextjs";

import { Disclosure } from "~/components/ui/disclosure";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { TreeChildren } from "~/components/ui/tree-rows";

/**
 * `useExpansionSet` 是「一棵树的展开 / 收起状态」的**唯一出口**
 * （规范 16 §16.2.4.17）。它是 hook、不是组件：树的**渲染**由调用处决定 ——
 * 这一族的分工是三层：
 *
 * | 出口 | 回答的问题 |
 * | ---- | ---------- |
 * | `ExpansionSet`（本件） | **哪些行**折着（状态） |
 * | `Disclosure` | **一行**怎么折（交互与 a11y） |
 * | `TreeRow` / `TreeChildren` | 一棵树的**层级关系**怎么画（缩进与子行归属） |
 *
 * 收口前 `NodesTab` 一棵树用了**三份同形的 `Record<string, boolean>`**
 * （`expandedParents` / `expandedNodeList` / `nodeExpanded`），每份配一组自己
 * 写一遍的读写。出口把三件事分开表达，其中第二件是此前**表达不出来**的：
 *
 * 1. `isExpanded(key)` —— 缺键 = 未表态 = 折叠；
 * 2. `hasKey(key)` —— **键存不存在**与「值是 false」是两件事，而
 *    「默认展开」那段抄了两遍的合并器要的正是这个区分（判的是 `in`、不是
 *    `!!map[key]`）：用户手动收起过的目录，下一轮刷新后不该自己弹回来；
 * 3. `seedDefaults(keys)` —— 「补默认」的唯一实现（那条合并器），
 *    `replace` 才是「整体重置」（两件事，别混）。
 *
 * story 一律用 `Disclosure` 把 `open` / `onOpenChange` 接上 —— 这正是调用处的
 * 真实形态（状态在 hook、交互在 Disclosure）。
 */
const meta = {
  title: "UI/ExpansionSet",
  component: ExpansionDemo,
  render: () => <ExpansionDemo />,
} satisfies Meta<typeof ExpansionDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

const PATHS = ["style_pack", "style_pack/高光", "style_pack/锐化"] as const;

function ExpansionDemo() {
  /* 初始空表 = 全部未表态 = 全部折叠。 */
  const nodes = useExpansionSet();
  return (
    <div className="flex w-[30rem] flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded border px-2 py-1 text-xs"
          onClick={() => nodes.replace({})}
        >
          collapseAll（全收起）
        </button>
        <button
          className="rounded border px-2 py-1 text-xs"
          onClick={() => nodes.seedDefaults(PATHS)}
        >
          seedDefaults（补默认展开）
        </button>
        <button
          className="rounded border px-2 py-1 text-xs"
          onClick={() => nodes.replace({ style_pack: false })}
        >
          replace（保留「已收起」这一条）
        </button>
      </div>
      <div className="rounded-lg border p-3">
        {PATHS.map((path) => (
          <Disclosure
            key={path}
            open={nodes.isExpanded(path)}
            onOpenChange={() => nodes.toggle(path)}
            trigger={<span className="text-sm">{path}</span>}
          >
            <TreeChildren>
              <div className="text-ink-muted text-xs">这一层的内容</div>
            </TreeChildren>
          </Disclosure>
        ))}
      </div>
      <p className="text-ink-muted text-xs">
        当前 map：{JSON.stringify(nodes.map)}
        <br />
        {`hasKey("style_pack") = ${String(nodes.hasKey("style_pack"))}`}
      </p>
    </div>
  );
}

/** 默认档：`isExpanded` / `toggle` 接上 `Disclosure` 的两个 prop
 *  —— 状态与交互各归各的出口。 */
export const Default: Story = {};

/** `seedDefaults` vs `replace`：这是本件**最值钱**的一处区分。
 *  - `seedDefaults(keys)`：**只补缺的键**（判 `in`）—— 用户收起过的目录
 *    不会被弹回来；
 *  - `replace(map)`：整体替换（全展开 / 全收起 / 从持久化恢复）。
 *
 *  现场：先手动收起 `style_pack`，再点 `seedDefaults` —— 它保持收起；
 *  换成 `replace({})` 之后它仍是收起（键还在）。 */
export const SeedDefaultsVsReplace: Story = {
  render: () => <SeedDemo />,
};

function SeedDemo() {
  const nodes = useExpansionSet({ style_pack: false });
  return (
    <div className="flex w-[30rem] flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded border px-2 py-1 text-xs"
          onClick={() => nodes.seedDefaults(PATHS)}
        >
          seedDefaults(PATHS)
        </button>
        <button
          className="rounded border px-2 py-1 text-xs"
          onClick={() => nodes.replace({})}
        >
          replace({"{ }"})
        </button>
      </div>
      <pre className="rounded-lg border p-3 font-mono text-xs">
        {JSON.stringify(nodes.map, null, 2)}
      </pre>
      <p className="text-ink-muted text-xs">
        初始 `{"{ style_pack: false }"}`（= 用户手动收起过）。 点
        seedDefaults：`style_pack` **保持 false**（键已存在、不许被覆盖）； 点
        replace({"{}"})：整表换成空 = 回到「全部未表态」。
      </p>
    </div>
  );
}

/** `hasKey` 与「值为 false」是两件事：这张表里 `{: 去掉 }` 与
 *  `{: false }` 对 `isExpanded` 是同一个答案，对 `hasKey` 不是 ——
 *  这正是上面那条「只补缺的键」能成立的原因。 */
export const HasKeyVsValue: Story = {
  render: () => <HasKeyDemo />,
};

function HasKeyDemo() {
  const nodes = useExpansionSet({ a: true, b: false });
  return (
    <div className="flex w-[30rem] flex-col gap-3">
      <pre className="rounded-lg border p-3 font-mono text-xs">
        {JSON.stringify(nodes.map, null, 2)}
      </pre>
      <ul className="text-ink-muted flex flex-col gap-1 font-mono text-xs">
        {["a", "b", "c"].map((key) => (
          <li key={key}>
            {key}: isExpanded={String(nodes.isExpanded(key))} · hasKey=
            {String(nodes.hasKey(key))}
          </li>
        ))}
      </ul>
    </div>
  );
}
