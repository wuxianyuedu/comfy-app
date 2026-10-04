import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { useFilePicker } from "~/components/ui/file-picker";

/**
 * `useFilePicker` 是「隐藏 `<input type="file">` + 谁来点它」的**唯一出口**
 * （视图层用它；`FilePicker` 那个组件是它的实现细节）。
 *
 * 它收的是全库 9 个文件里各写一份的三件事：
 *
 * 1. **`click()` 在 ref 未挂上时是静默空操作** —— 界面「点了没反应」，
 *    既没反馈也不知道该查什么。出口把 ref 转发与 `open()` 收成一对。
 * 2. **选完之后没有复位 `event.target.value`** —— 用户第二次选**同一个文件**
 *    不会触发 `change`（浏览器只在取值变化时派发），看起来像上传坏了。
 *    出口内置了复位。
 * 3. **同一文件里两个隐藏 input + 两个 ref + 两个 `click()` 的样板重复**。
 *
 * 两条形态上的注意：
 *
 * - `picker.Input` 是**组件位置**，用 `useMemo` 固定身份 —— 每次渲染重建会让
 *   React 卸载再挂载 input，**正在进行的系统文件对话框会被打断**。
 *   所以它必须挂在 JSX 里（`<picker.Input />`），不能在条件分支里。
 * - `open` 也身份稳定（`useCallback`），可以放进 `onClick` 甚至依赖数组。
 *
 * ⚠️ storybook 里点开会真的弹出系统文件对话框（浏览器行为）；选完之后
 * 画布上会显示「选了什么」—— 这就是「同一文件选两次仍然有反应」那条的现场。
 */
const meta = {
  title: "UI/FilePicker",
  // 出口是 hook，Meta 的 `component` 必须是能渲染的东西 → 用装饰器组件承载。
  component: FilePickerDemo,
  render: (args) => <FilePickerDemo {...args} />,
} satisfies Meta<typeof FilePickerDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

function FilePickerDemo({
  accept,
  multiple,
}: {
  accept?: string;
  multiple?: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const picker = useFilePicker({
    onPick: (file, files) => {
      setPicked(multiple ? Array.from(files).map((f) => f.name) : [file.name]);
    },
    accept,
    multiple,
  });
  return (
    <div className="flex w-120 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={picker.open}>
          选择文件
        </Button>
        {/* 隐藏 input 挂在树里，ref 转发由出口负责 —— 调用处不用管。 */}
        <picker.Input />
      </div>
      <p className="text-ink-muted text-sm">
        {picked.length === 0 ? "还没选" : `选了：${picked.join(" / ")}`}
      </p>
    </div>
  );
}

/** 单选 + `accept` 过滤：系统对话框只列图片。 */
export const SingleImage: Story = {
  args: { accept: "image/*" },
};

/** 多选：`multiple` 时对话框允许多选，画布上把名字都列出来。 */
export const Multiple: Story = {
  args: { accept: "image/*,video/*", multiple: true },
};

/** 不做类型过滤：`accept` 不给时系统对话框什么都列 —— 导入 `.json` /
 *  `.safetensors` 这类工作流包时就是这个形态。
 *
 * 这条同时是**「同一文件选两次」那条修复**的现场：连续选两个同名文件，
 * 第二次也应该照常触发（出口内置了 `event.target.value` 复位）。 */
export const NoAcceptFilter: Story = {
  render: () => <FilePickerDemo />,
};
