import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";

/**
 * `ui/sonner` 的 `Toaster` 是**浮层消息容器**（sonner 的封装）。
 *
 * 这一件与其它基元不同：它**自己不画任何东西** —— 它挂一次、监听全局的
 * `toast(...)` 调用，有消息时才在视口角落渲染一条卡片。所以它的形态没法靠
 * props 摆出来，只能**真的弹一条**。
 *
 * 三条只有真弹才看得出的口径：
 *
 * 1. **主题跟随应用**：`useTheme()` 的 `theme` 传给 sonner（`system` 兜底）
 *    —— 用工具栏切明暗，弹出的卡片应一起换；
 * 2. **图标与语义档一一对应**：`success` / `info` / `warning` / `error`
 *    各配一个 lucide 图标，`loading` 是旋转的 `Loader2`；
 * 3. **颜色全走语义 token**（`--normal-bg` / `--normal-text` /
 *    `--normal-border` / `--border-radius` 四个 CSS 变量指向 `--popover` /
 *    `--border` / `--radius`）—— 这是它「看起来属于这个应用」的原因。
 *
 * ## 与 `ToastProvider` 的关系
 *
 * 项目里业务侧发消息**不走 sonner 的直接调用**，而走
 * `~/components/studio/ToastProvider` 的 `useToast()`（那是全库唯一出口，
 * 注入层 `withAppProviders` 已给每个 story 挂上）。本件是那个出口底下真正
 * 渲染消息的容器 —— 所以两者都要在，本 story 才能弹得出来。
 */
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
      if (kind === "success") toast.success(text);
      else if (kind === "info") toast.info(text);
      else if (kind === "warning") toast.warning(text);
      else if (kind === "error") toast.error(text);
      else toast(text);
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <Toaster />
      <div className="flex flex-wrap gap-2">
        {["default", "success", "info", "warning", "error"].map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant="outline"
            onClick={() => fire(kind)}
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
        size="sm"
        variant="outline"
        onClick={() => {
          void import("sonner").then(({ toast }) => {
            toast.error("读取工作流失败", {
              description: "workflow.json 不是合法的 JSON，请检查后重试。",
            });
          });
        }}
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
        size="sm"
        variant="outline"
        onClick={() => {
          void import("sonner").then(({ toast }) => {
            toast.loading("正在导出…", { id: "export" });
            setTimeout(() => {
              toast.success("导出完成", { id: "export" });
            }, 1500);
          });
        }}
      >
        导出（转圈 → 成功）
      </Button>
      <p className="text-ink-muted text-xs">
        同一个 id 上再发一条会替换那一条 —— 否则会看到两条（一条永远转着）。
      </p>
    </div>
  );
}
