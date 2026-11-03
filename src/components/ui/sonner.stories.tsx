import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";

/** `ui/sonner` 的 `Toaster` 是浮层消息容器（sonner 封装）：它**自己不画任何东西** —— 挂一次、监听全局 `toast(...)`，
 * 有消息才在视口角落渲染卡片，所以只能**真的弹一条**才看得出形态。三条口径：① 主题跟随应用（`useTheme()` 的 `theme`
 * 传给 sonner，`system` 兜底）；② 图标与语义档一一对应（`loading` 是旋转 `Loader2`）；③ 颜色全走语义 token（`--normal-bg` 等
 * 指向 `--popover` / `--border` / `--radius`）。业务侧发消息走 `ToastProvider` 的 `useToast()`（全库唯一出口），本件是它底下的渲染容器。 */
const meta = {
  title: "UI/Sonner",
  component: Toaster,
} satisfies Meta<typeof Toaster>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 四档语义色：`success` / `info` / `warning` / `error`
 *  —— 图标与左边框色一一对应，并排弹才看得出差异。 */
export const Variants: Story = {
  render: () => <ToastDemo />,
};

function ToastDemo() {
  /* 动态 import：`sonner` 的 `toast()` 是模块级函数，而容器由本组件挂。
     这里只用它发消息，不重复挂容器。 */
  const fire = (kind: string) => {
    void import("sonner").then(({ toast }) => {
      const text = `这是一条 ${kind} 消息`;
      if (kind === "success") {
        toast.success(text);
      } else if (kind === "info") {
        toast.info(text);
      } else if (kind === "warning") {
        toast.warning(text);
      } else if (kind === "error") {
        toast.error(text);
      } else {
        toast(text);
      }
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <Toaster />
      <div className="flex flex-wrap gap-2">
        {["default", "success", "info", "warning", "error"].map((kind) => (
          <Button
            key={kind}
            onClick={() => {
              fire(kind);
            }}
            size="sm"
            variant="outline"
          >
            {kind}
          </Button>
        ))}
      </div>
      <p className="text-ink-muted text-xs">
        点一个按钮：消息卡片从视口角落弹出。切明暗两态，卡片跟着换主题。
      </p>
    </div>
  );
}

/** 带描述的卡片：`description` 给第二行小字 —— 「发生了什么 + 下一步」
 *  是通知的标准形态（规范 10.5）。 */
export const WithDescription: Story = {
  render: () => <DescriptionDemo />,
};

function DescriptionDemo() {
  return (
    <div className="flex flex-col gap-3">
      <Toaster />
      <Button
        onClick={() => {
          void import("sonner").then(({ toast }) => {
            toast.error("读取工作流失败", {
              description: "workflow.json 不是合法的 JSON，请检查后重试。",
            });
          });
        }}
        size="sm"
        variant="outline"
      >
        弹一条带描述的
      </Button>
    </div>
  );
}

/** 加载态与自动接续：`loading` 图标是旋转的，且同一个 `id` 上再发一条会
 *  **替换**那一条（「先转圈、再变结果」的唯一写法）。 */
export const LoadingThenResolve: Story = {
  render: () => <LoadingDemo />,
};

function LoadingDemo() {
  return (
    <div className="flex flex-col gap-3">
      <Toaster />
      <Button
        onClick={() => {
          void import("sonner").then(({ toast }) => {
            toast.loading("正在导出…", { id: "export" });
            setTimeout(() => {
              toast.success("导出完成", { id: "export" });
            }, 1500);
          });
        }}
        size="sm"
        variant="outline"
      >
        导出（转圈 → 成功）
      </Button>
      <p className="text-ink-muted text-xs">
        同一个 id 上再发一条会替换那一条 —— 否则会看到两条（一条永远转着）。
      </p>
    </div>
  );
}
