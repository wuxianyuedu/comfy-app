import type { Meta, StoryObj } from "@storybook/nextjs";

import { JsonViewer } from "~/components/ui/json-viewer";
import {
  resolveSource,
  sourceNameArgType,
  type JsonSourceName,
} from "../../../.storybook/data-sources";

/**
 * `JsonViewer` 是这一批里第一个**真的需要数据源**的组件：它的入参是
 * `data: unknown`，而「这份 JSON 长什么样」决定了它要回答的问题 ——
 *
 * - 几百个节点的 `prompt_preview` 首屏会不会卡（`collapseObjectsAfterLength`
 *   那段注释里的事故现场）；
 * - 搜索命中在深嵌套里怎么高亮、命中计数对不对；
 * - 长字符串（prompt 那条 150 字符的）折叠成什么样。
 *
 * 所以载荷不在 story 里现编：走注入层的 `json` 值源（真报文形状），
 * `sourceName` 那条下拉可以现场换一份。**为什么不 mock**：见
 * `.storybook/data-sources.tsx` 的模块头 —— 假形态的截图会被当成真证据。
 */

/**
 * Args 的形状 = **可调的那几个**（面板上真会出现的东西）。
 *
 * 逐个列而不是 `Omit<JsonViewerProps, "data">`：`data` 由注入层给，它不该出现在
 * story 的 Args 里；而「哪几个是可调的」本来就是这一组 story 要回答的问题，
 * 逐行写出来是它的答案，不是从别处减出来的余数。
 *
 * 另外，`Omit<React.ComponentProps<…>, "…">` 这个**形状**恰好撞上
 * `scripts/check-ui-primitives.cjs` 的 P57（「自写剔掉私有 prop 再透传的剔除表」）
 * —— 那条判据锚的形态是对的（那种表真该收进 `~/lib/dom-props`），这里只是长得像。
 * 不用豁免去绕，改成逐项列，两边都清楚。
 */
interface StoryArgs {
  /** 注入层的数据源旋钮（真报文的名字，见 `.storybook/data-sources.tsx`）。 */
  sourceName: JsonSourceName;
  /** Toolbar 副标题。 */
  title?: string;
  /** 首屏折叠档位：0 = 全展开；>=1 时项数超过 `30 + N*40` 的容器折成 `…`。 */
  initialCollapsedDepth?: number;
}

/**
 * Storybook 要的「组件」在这里是个**适配件**：它不改变渲染，只把
 * `args.sourceName` 经注入层解析成 `data` 再交给真组件。
 *
 * 为什么不直接 `component: JsonViewer` 再把 `sourceName` 塞进 Args：
 * `Meta<typeof JsonViewer>` 的 Args 就是 `JsonViewerProps`，多一个键过不了类型；
 * 而 `Meta<StoryArgs>` 又要求 `component` 能接住 `StoryArgs`（少了必填的 `data`，
 * 同样过不了）。适配件把两件事一次说清 —— 而且它读起来就是这一层在干的事。
 */
function JsonViewerWithSource({ sourceName, ...rest }: StoryArgs) {
  return <JsonViewer {...rest} data={resolveSource("json", sourceName)} />;
}

const meta = {
  title: "UI/JsonViewer",
  component: JsonViewerWithSource,
  parameters: {
    /* `layout: fullscreen`：本组件是 `h-full` 的弹性布局，塞进默认的居中内边距
       容器里量不到真实高度（`bodyRef` 那个滚动区会塌成 0）。 */
    layout: "fullscreen",
  },
  args: {
    sourceName: "comfy-prompt",
    title: "JSON",
    initialCollapsedDepth: 1,
  },
  argTypes: {
    sourceName: sourceNameArgType("json"),
    initialCollapsedDepth: {
      control: { type: "number" },
      description:
        "首屏折叠档位：0 = 全展开；>=1 时项数超过 `30 + N*40` 的容器折成 `…`",
    },
  },
} satisfies Meta<StoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 默认档：小容器展开、大容器折成 `…` —— 真机上首屏就是这么落的。 */
export const Default: Story = {};

/** 全展开：一张图看完整结构，也是「大 payload 不折叠会不会卡」的对照面。 */
export const FullyExpanded: Story = {
  args: { initialCollapsedDepth: 0, title: "prompt_preview（全展开）" },
};

/** 工作流列表那一份报文：浅、小，是「没什么可折」的另一头。 */
export const WorkflowList: Story = {
  args: { sourceName: "workflow-list", title: "workflow.list" },
};

/**
 * `data === undefined` 时组件自己画 `(empty)` —— 一个真实的空态分支
 *（真机上出现在「还没产出」的那一刻）。
 *
 * 这一条**刻意绕过**注入层（直接给 `undefined`）：它要看的不是「哪份报文」，
 * 而是「没有报文」。给注入层加一个「空载荷」的名字是行不通的 —— 那会让「名字
 * 写错了」和「就是没有」变成同一件事，而前者正是这一层要暴露的。
 */
export const Empty: Story = {
  render: (args) => (
    <JsonViewer
      data={undefined}
      title={args.title}
      initialCollapsedDepth={args.initialCollapsedDepth}
    />
  ),
};
