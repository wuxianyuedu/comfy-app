import type { Meta, StoryObj } from "@storybook/nextjs";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { ImageViewer, ViewableImage } from "~/components/ui/image-viewer";
import {
  resolveSource,
  sourceNameArgType,
  type MediaSourceName,
} from "../../../.storybook/data-sources";

/**
 * `ImageViewer` 是「把一张图看全」的通用出口（规范 16 §16.2.3）。
 *
 * 它要回答的都是**尺寸**问题 —— 而尺寸只有真文件给得出：
 *
 * - 「适应窗口」按图片的**自然尺寸**折算（`readNaturalSize` 读的就是文件的
 *   `width`/`height`），`data:` URL 里看不出这件事；
 * - 竖图与超宽图走的是折算的两个极端分支（`use-image-zoom` 的
 *   `viewportWidth` / `viewportHeight` 谁先触底）；
 * - `ViewableImage` 的缩略图盒子 + `1:1` 档的滚动条长度，都取决于真尺寸。
 *
 * 所以图仍走注入层的 `media` 值源（`scripts/storybook-assets.mjs` 现生成的三张
 * 真 SVG）。`missing.png` 在这里也有用：它是**加载失败**时 `ViewableImage`
 * 的 fallback 现场。
 */

/** 受控弹窗：`ImageViewer` 要求 `src` 有值时渲染，所以 story 自己持开关。 */
type StoryArgs = {
  sourceName: MediaSourceName;
  label?: string;
  /**
   * 是否打开。`ImageViewer` 是**受控**的（`src` 有值即渲染、`onClose` 表示关），
   * 真机上由调用处持开关；story 里同样要有一个真开关，否则关掉之后就没法再开。
   */
  open: boolean;
};

function ViewerWithSource({ sourceName, label, open: initialOpen }: StoryArgs) {
  const [open, setOpen] = useState(initialOpen);
  const src = String(resolveSource("media", sourceName));
  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        打开查看器
      </Button>
      {open && (
        <ImageViewer
          src={src}
          label={label ?? sourceName}
          onClose={() => setOpen(false)}
        />
      )}
      <p className="text-ink-muted text-xs">
        弹窗由 story 自己持有开关（组件是受控的）：点「打开查看器」再开， Esc /
        点遮罩 / 右上角 ✕ 都能关。
      </p>
    </div>
  );
}

const meta = {
  title: "UI/ImageViewer",
  component: ViewerWithSource,
  args: { sourceName: "sample-landscape.svg", label: "样例图", open: true },
  argTypes: { sourceName: sourceNameArgType("media") },
} satisfies Meta<StoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 横向图：适应窗口这一档在宽高都有余量时取「高度触底」。 */
export const Landscape: Story = {};

/** 竖图：折算的另一端（宽度触底），也是「1:1 看长图要拖」那条路径。 */
export const Portrait: Story = {
  args: { sourceName: "sample-portrait.svg", label: "竖图 720 × 1280" },
};

/** 超宽图（2400 × 600）：适应窗口下横向铺满、纵向留白最多的一档。 */
export const Wide: Story = {
  args: { sourceName: "sample-wide.svg", label: "超宽 2400 × 600" },
};

/**
 * 缩略图 + 点开查看的组合形态（真机上多数落点用的是这个）。
 *
 * 左边能加载、右边指向不存在的文件 —— 后者走的是 `MediaThumbnail` 的失败兜底，
 * 是「图没了时用户看到什么」的现场。图失败与查看器是两件事：缩略图失败时**不**
 * 该点开一个空查看器。
 */
export const ViewableImageGrid: Story = {
  parameters: { layout: "centered" },
  render: () => (
    <div className="flex items-start gap-8">
      <div className="flex flex-col items-center gap-2">
        <div className="size-40">
          <ViewableImage
            src={String(resolveSource("media", "sample-landscape.svg"))}
            alt="能加载的缩略图"
            label="能加载"
            className="rounded-xl object-cover"
          />
        </div>
        <span className="text-ink-muted font-mono text-[11px]">
          能加载 → 点开查看器
        </span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="size-40">
          <ViewableImage
            src={String(resolveSource("media", "missing.png"))}
            alt="加载失败的缩略图"
            label="加载失败"
            className="rounded-xl object-cover"
          />
        </div>
        <span className="text-ink-muted font-mono text-[11px]">
          加载失败 → 占位兜底
        </span>
      </div>
    </div>
  ),
};
