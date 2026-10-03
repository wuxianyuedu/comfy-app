import type { Meta, StoryObj } from "@storybook/nextjs";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

/**
 * `ui/table` 是「真 `<table>` + 统一排版」的基元：它自己不产数据、不做排序、
 * 不做分页 —— 那三件事归调用处的状态与 `~/components/ui/pagination`。
 *
 * 本件此前没有 story 的原因不是「有数据依赖」，而是**整族没被用过**
 * （全库零消费点，`~/.components/ui/table` 一次都没被 import）—— 也就是说它
 * 是一个「装了但没人看」的基元。这恰好是 story 该补的那一格：**形态先定下来**，
 * 真要用时不必从零试 class。
 *
 * 下面按真实落点给：历史任务的参数表（`rows` 形态）、模型清单（长内容截断）、
 * 空表（`TableBody` 只有一行空态）。
 */
/** 语义色档的类型从 `Badge` 的 props 派生（不手抄一份字面量）。 */
type BadgeTone = NonNullable<React.ComponentProps<typeof Badge>["tone"]>;

const meta = {
  title: "UI/Table",
  component: Table,
} satisfies Meta<typeof Table>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 参数表：表头 + 脚注。`TableFooter` 的 `bg-muted/50` 与 `TableRow` 的
 *  悬停底色都是这里才看得到的。 */
export const Default: Story = {
  render: () => (
    <Table className="w-[36rem]">
      <TableCaption>本次运行的对外参数（workflowIO 投影）</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-32">参数</TableHead>
          <TableHead>类型</TableHead>
          <TableHead className="text-right">取值</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[
          ["prompt", "string", "a lone lighthouse…"],
          ["width", "number", "1024"],
          ["batch", "number", "1"],
        ].map(([key, type, value]) => (
          <TableRow key={key}>
            <TableCell className="font-mono text-xs">{key}</TableCell>
            <TableCell className="text-ink-muted">{type}</TableCell>
            <TableCell className="text-right font-mono text-xs">
              {value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2}>共 3 项</TableCell>
          <TableCell className="text-right">—</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
};

/** 状态列：`TableCell` 里放徽标与按钮是常态 —— 这条顺带验 `TableCell` 的
 *  `whitespace-nowrap` 与行高（`TableHead h-10`、`TableCell p-2`）。 */
export const WithStatusColumn: Story = {
  render: () => (
    <Table className="w-[36rem]">
      <TableHeader>
        <TableRow>
          <TableHead>模型</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[
          ["sd_xl_base_1.0.safetensors", "已就绪", "success"],
          ["qwen_image_edit.safetensors", "下载中", "neutral"],
          ["flux1-dev.safetensors", "缺失", "danger"],
        ].map(([name, status, tone]) => (
          <TableRow key={name}>
            <TableCell className="font-mono text-xs">{name}</TableCell>
            <TableCell>
              <Badge tone={tone as BadgeTone}>{status}</Badge>
            </TableCell>
            <TableCell className="text-right">
              <Button size="xs" variant="ghost">
                详情
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

/** 长内容：`TableHead` 的 `whitespace-nowrap` 让**列**先撑开、由外层
 *  `table-container` 的 `overflow-x-auto` 接管横向滚动 —— 这正是 `Table`
 *  比裸 `<table>` 多出来的那一层，缩窄画布才看得出。 */
export const Overflowing: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="w-[22rem]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>节点</TableHead>
            <TableHead>class_type</TableHead>
            <TableHead>输出</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[
            ["3", "KSampler", "LATENT"],
            ["4", "CheckpointLoaderSimple", "MODEL, CLIP, VAE"],
            ["8", "VAEDecode", "IMAGE"],
          ].map(([id, type, out]) => (
            <TableRow key={id}>
              <TableCell className="font-mono text-xs">#{id}</TableCell>
              <TableCell className="font-mono text-xs">{type}</TableCell>
              <TableCell className="text-ink-muted text-xs">{out}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};

/** 空表：`<tbody>` 里一行「空态」而不是整张表消失 —— 表头留着，
 *  读的人才知道这里**本应有**一张什么表（规范 10.5 的空态口径）。 */
export const Empty: Story = {
  render: () => (
    <Table className="w-[36rem]">
      <TableHeader>
        <TableRow>
          <TableHead>参数</TableHead>
          <TableHead>取值</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell colSpan={2} className="text-ink-muted py-8 text-center">
            这个工作流没有声明对外参数
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};
