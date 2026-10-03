import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  MediaThumbnail,
  type MediaThumbnailProps,
} from "~/components/ui/media-thumbnail";
import {
  resolveSource,
  sourceNameArgType,
  type MediaSourceName,
} from "../../../.storybook/data-sources";

/**
 * `MediaThumbnail` 是「渲染一张可能加载失败的图 / 视频」的唯一出口
 *（规范 16 §16.2.4.21）。它要回答的问题是**失败那一侧**：
 *
 * - 加载失败时兜底长什么样（默认占位 / `"none"` 整格不渲染 / 自定义节点）；
 * - 兜底盒子与调用处的盒子同尺寸吗（收口前那两处 `display:none` 会把格子抽走，
 *   留下一个空洞）；
 * - 换图之后失败态会不会传染（`failedSrc` 存的是「哪一个 src 失败了」的用意）。
 *
 * 所以图必须是**真文件**：`data:` URL 永远加载成功，失败分支根本不会被走到。
 * 注入层的 `media` 值源里有三张真图（横 / 纵 / 超宽）与一个**故意不存在**的
 * 名字（`missing.png`）—— 后者才是这张 story 的主角。
 */
/** Args 的形状 = 可调的那几个（`src` 由注入层给，不进 Args）。 */
interface StoryArgs {
  /** 注入层的数据源旋钮（真文件的名字，见 `.storybook/data-sources.tsx`）。 */
  sourceName: MediaSourceName;
  alt?: string;
  className?: string;
  /** 失败兜底形态：`placeholder`（默认）/ `none`；自定义节点走 `render`。 */
  fallback?: MediaThumbnailProps["fallback"];
}

/** 适配件：把 `sourceName` 经注入层解析成真地址再交给真组件（见 `data-sources.tsx`）。 */
function ThumbnailWithSource({ sourceName, ...rest }: StoryArgs) {
  return (
    <MediaThumbnail
      {...rest}
      src={String(resolveSource("media", sourceName))}
    />
  );
}

const meta = {
  title: "UI/MediaThumbnail",
  component: ThumbnailWithSource,
  args: {
    sourceName: "sample-landscape.svg",
    alt: "样例图",
    className: "h-40 w-64 rounded-lg object-cover",
  },
  argTypes: {
    sourceName: sourceNameArgType("media"),
    fallback: {
      control: { type: "select" },
      options: ["placeholder", "none"],
      description:
        "失败兜底形态：占位（默认）/ 不渲染；自定义 ReactNode 走 render，不进 Args",
    },
  },
} satisfies Meta<StoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 一张能正常加载的真图。 */
export const Default: Story = {};

/** 三张真图并排：尺寸差异明显，看得见 `object-cover` 在不同宽高比下的裁法。 */
export const RealSources: Story = {
  args: { className: "h-40 w-64 rounded-lg object-cover" },
  render: (args) => (
    <div className="flex flex-wrap items-start gap-4">
      {(
        [
          "sample-landscape.svg",
          "sample-portrait.svg",
          "sample-wide.svg",
        ] as const
      ).map((name) => (
        <div key={name} className="flex flex-col items-center gap-1.5">
          <ThumbnailWithSource {...args} sourceName={name} alt={name} />
          <span className="text-ink-muted font-mono text-[11px]">{name}</span>
        </div>
      ))}
    </div>
  ),
};

/**
 * **加载失败** —— 本组 story 的主角。`missing.png` 不存在，于是兜底真的被走到。
 *
 * 左边是默认占位（与调用处的盒子同尺寸，所以没有空洞、也不跳布局），
 * 右边是 `fallback="none"`（宁缺勿错的列表格位）。
 */
export const LoadFailure: Story = {
  args: { sourceName: "missing.png" },
  render: (args) => (
    <div className="flex items-start gap-6">
      <div className="flex flex-col items-center gap-1.5">
        <ThumbnailWithSource {...args} alt="默认占位" />
        <span className="text-ink-muted font-mono text-[11px]">
          fallback=placeholder
        </span>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <div className="border-border-subtle h-40 w-64 rounded-lg border border-dashed" />
        <span className="text-ink-muted font-mono text-[11px]">
          fallback=none
        </span>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <ThumbnailWithSource
          {...args}
          fallback={
            <span className="text-ink-muted bg-canvas-deep flex h-40 w-64 items-center justify-center rounded-lg text-[11px]">
              自定义兜底节点
            </span>
          }
          alt="自定义兜底"
        />
        <span className="text-ink-muted font-mono text-[11px]">
          fallback=自定义
        </span>
      </div>
    </div>
  ),
};

/** `src` 为空时不渲染 —— 真机上出现在「这一格还没有产出」。 */
export const NoSource: Story = {
  args: { className: "h-40 w-64 rounded-lg object-cover" },
  render: (args) => (
    <div className="flex items-center gap-3">
      <div className="border-border-subtle h-40 w-64 rounded-lg border border-dashed" />
      <MediaThumbnail {...args} src={null} alt="空 src" />
      <span className="text-ink-muted text-[11px]">
        右边是 `src=null`（组件返回 null）
      </span>
    </div>
  ),
};
