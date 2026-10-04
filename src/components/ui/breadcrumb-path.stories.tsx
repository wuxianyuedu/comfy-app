import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  BreadcrumbPath,
  type BreadcrumbSegment,
} from "~/components/ui/breadcrumb-path";

/**
 * `ui/breadcrumb-path` 是「一段路径 `A / B / 当前 C`」的**唯一实现**
 * （规范 16 §16.2.4.72）—— 素材库抽屉与资源库页此前各手写一份同一段渲染
 * （class 串逐字相同），差别只在分隔符的 `mx` 档。
 *
 * 三件值得单看的事：
 *
 * 1. **它建在 `ui/breadcrumb` 上**：`nav` + `ol` + `li` 的层级与
 *    `aria-current="page"` 一并给到 —— 手搓的 `span` + `/` 里这两样都没有；
 * 2. **末段不可点**（当前所在处，点它会重入同一层），中间段可点并回调
 *    `onNavigate`；
 * 3. **`navigable={false}` 用于搜索态**（层级已失效，回退由「清空搜索」承担）。
 *
 * 只有两段的路径、深三层、搜索态三档在这里并排看，
 * 才能确认「末段的样式档」与「中间段的 hover 档」没有互相漂移。
 */
const meta = {
  title: "UI/BreadcrumbPath",
  component: BreadcrumbPath,
  args: {
    segments: [
      { label: "参考素材", key: null },
      { label: "角色参考", key: "characters" },
      { label: "小夜", key: null },
    ] satisfies BreadcrumbSegment[],
    onNavigate: () => undefined,
    navigable: true,
  },
} satisfies Meta<typeof BreadcrumbPath>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 素材库里的真实形态：根 → 分类 → 当前条目（末段不可点）。 */
export const Default: Story = {};

/** 只有一段：路径就是当前所在处 —— 调用处不必为「首页」写特例分支。 */
export const SingleLevel: Story = {
  args: {
    segments: [{ label: "参考素材", key: null }],
  },
};

/** 深四层：中间段的 hover 档（下划线 + 主色）与末段的当前档要一眼分得开。 */
export const Deep: Story = {
  args: {
    segments: [
      { label: "本项目", key: null },
      { label: "素材", key: "materials" },
      { label: "角色参考", key: "characters" },
      { label: "小夜", key: null },
    ],
  },
};

/** 搜索态：层级已失效，全部段渲染成不可点 —— 回退由「清空搜索」那一处承担。 */
export const Searching: Story = {
  args: {
    navigable: false,
  },
};

/** 空数组：不渲染任何东西（调用处不必先判长度，与 `map` 的空结果同形）。 */
export const Empty: Story = {
  args: {
    segments: [],
  },
};
