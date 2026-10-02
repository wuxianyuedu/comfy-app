import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { simpleKeyHandler } from "~/components/ui/simple-key-handler";

/**
 * 它不是一个组件，而是「在非输入框元素上按某个键就做一件事」的**属性包**：
 * `<div role="tab" tabIndex={0} {...simpleKeyHandler(["Space", "Enter"], fn)} />`。
 * 铺出来的元素没有可见外观，所以这一屏的主角是**下方那一行回显**：
 * 先点一下方块让它拿到焦点，再按键，看回显有没有变。
 *
 * 值得单看的两档：
 *   · `ignoreRepeat` 缺省为真 —— 按住不放只触发**一次**；
 *   · 关掉它之后，按住不放会**连续**触发（对比着看才说明这个开关是活的）。
 */
const meta = {
  title: "UI/SimpleKeyHandler",
  args: { keys: ["Space", "Enter"] as readonly string[] },
} satisfies Meta<SimpleKeyHandlerProps>;

export default meta;

interface SimpleKeyHandlerProps {
  keys: readonly string[];
  ignoreRepeat?: boolean;
  preventDefault?: boolean;
}

type Story = StoryObj<typeof meta>;

/** 把回显做进 render：交互结果在画布上直接看得见。 */
function Demo({ keys, ignoreRepeat, preventDefault }: SimpleKeyHandlerProps) {
  const [log, setLog] = useState("（还没按键）");
  const hit = useState(0);
  return (
    <div className="flex flex-col items-start gap-2">
      <div
        role="button"
        tabIndex={0}
        data-slot="key-target"
        className="border-border bg-subtle focus-visible:border-ring rounded-md border border-dashed px-4 py-3 text-xs"
        {...simpleKeyHandler(
          keys,
          (event) => {
            hit[1]((n) => n + 1);
            setLog(`key = ${event.key}`);
          },
          { ignoreRepeat, preventDefault },
        )}
      >
        点我拿到焦点，然后按键（认：{keys.join(" / ")}）
      </div>
      <div className="text-ink-muted text-xs">
        回显：{log}（第 {hit[0]} 次）
      </div>
    </div>
  );
}

export const Default: Story = {
  render: (args) => <Demo {...(args as SimpleKeyHandlerProps)} />,
};

/* 下面几张各自覆写 `keys`，所以类型上把它**声明成可选** —— 故事层要的是
   「哪些 args 允许缺省」，而渲染函数里那一个（`Demo`）要的是「我必须收到什么」，
   两者不是同一个问题。 */
type LooseStory = StoryObj<Meta<SimpleKeyHandlerProps>>;

/** 只认一个键（`normalizeKeyName` 让 `"Space"` 与 `" "` 走同一条判据）。 */
export const SingleKey: LooseStory = {
  args: { keys: ["Enter"] },
  render: (args) => <Demo {...args} />,
};

/** 关掉 `ignoreRepeat`：按住不放会**连续**触发（与默认那一档对比着看）。 */
export const AllowRepeat: LooseStory = {
  args: { keys: ["Space"], ignoreRepeat: false },
  render: (args) => <Demo {...args} />,
};

/** 关掉 `preventDefault`：只观察不拦截（例如 Tab 要留给浏览器走焦点）。 */
export const ObserveOnly: LooseStory = {
  args: { keys: ["Tab"], preventDefault: false },
  render: (args) => <Demo {...args} />,
};
