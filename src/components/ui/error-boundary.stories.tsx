import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { ErrorBoundary } from "~/components/ui/error-boundary";

/**
 * `ErrorBoundary` 是**客户端错误边界**：包在业务子树外层，捕获渲染期异常
 * 并展示降级 UI，避免整页白屏。
 *
 * 与 `app/error.tsx` 的分工（两者互补、不互相替代）：
 * - `app/error.tsx` 处理 **Next 路由层**的错误（整页 / 整段路由）；
 * - 本组件处理**页面内局部组件**的渲染错误（一块面板炸了，别的地方照常）。
 *
 * ## 为什么它此前没有 story，以及这次怎么补的
 *
 * 它的降级 UI **只有子树真的抛错时才渲染**，Args 面板注不进去 ——
 * 这也是台账里「只有出错时才渲染的边界件」那一类。补法是给它配一个
 * **真的会抛的兄弟组件**（下面那个 `Boom`），由 story 的按钮控制抛不抛。
 * 这不是「作弊」：这条 story 要验的正是「子树的错误有没有被接住」，
 * 而触发它的唯一办法就是让子树出错。
 *
 * 三条要看的事：
 * 1. **默认降级 UI**（不传 `fallback`）：一块红色卡片 + 「重试」按钮，
 *    重试会把 `hasError` 复位、重新渲染子树（若子树仍抛，会再落回这里）；
 * 2. **`fallback` 传函数**可以拿到**真实错误对象**（传节点只拿到一块静态 UI）；
 * 3. **`onError` 是上报口**：`componentDidCatch` 里同时 `console.error`
 *    与调它 —— 生产里接日志 / 埋点。
 */
const meta = {
  title: "UI/ErrorBoundary",
  component: ErrorBoundary,
  args: { children: null, fallback: "降级 UI" },
} satisfies Meta<typeof ErrorBoundary>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 一个**真的会抛**的子树：story 里的「故障注入」。
 *  抛在渲染期，正是 ErrorBoundary 接的那一类。 */
function Boom({ explode }: { explode: boolean }) {
  if (explode) {
    throw new Error("渲染期炸了：这个子树的 props 不合法");
  }
  return (
    <p className="text-ink-muted text-sm">
      子树正常渲染。点上面的按钮让它抛一次。
    </p>
  );
}

/** 默认降级 UI（不传 `fallback`）：红色卡片 + 重试。
 *  重试后子树重新渲染 —— 仍抛就再落回来（这一条是 `getDerivedStateFromError`
 *  与「重试」按钮那对状态的现场）。 */
export const DefaultFallback: Story = {
  render: () => <BoomDemo />,
};

function BoomDemo() {
  const [explode, setExplode] = useState(false);
  /* `key` 变化时把边界整个重挂一次 —— 这是「重试」之外的第二种复位方式，
   * 也是调用处的常见做法（换了数据源就换一个边界）。 */
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="flex w-lg flex-col gap-3">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setExplode((e) => !e)}
        >
          {explode ? "停止抛错" : "让子树抛错"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setExplode(false);
            setAttempt((a) => a + 1);
          }}
        >
          重挂边界（换 key）
        </Button>
      </div>
      <div className="rounded-lg border p-3">
        <ErrorBoundary key={attempt}>
          <Boom explode={explode} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

/**
 * `fallback` 传函数：能拿到**真实错误对象**（`message` / `stack`），
 * 这是它与「传一块静态节点」的实质差别。
 *
 * ⚠️ 这条 story 会**故意**在控制台留一条错误（子树真抛了），这是它的现场、
 * 不是缺陷 —— 同理 `onError` 也被接上，用来展示「上报口拿到的是什么」。
 * 其余 story 保持零 console 输出，所以逐条核对时这条会被单独认出来。
 */
export const FallbackWithError: Story = {
  parameters: {
    /* 这条 story 的 console 输出是**预期**的（子树真抛），在 Storybook 的
       a11y / 交互面板里不当作失败；结论由人看上面那块降级 UI 得出。 */
    test: { dangerouslyIgnoreUnhandledErrors: true },
  },
  render: () => (
    <div className="flex w-lg flex-col gap-3">
      <ErrorBoundary
        fallback={(error) => (
          <div className="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-lg border p-3">
            <span className="text-destructive text-sm font-semibold">
              这块面板炸了
            </span>
            <pre className="text-ink-muted font-mono text-xs whitespace-pre-wrap">
              {error?.message ?? "没有错误对象"}
            </pre>
            <p className="text-ink-muted text-xs">
              其余页面照常 —— 这就是局部边界与 error.tsx 的分工。
            </p>
          </div>
        )}
      >
        <Boom explode />
      </ErrorBoundary>
      <p className="text-ink-muted text-xs">
        上面那块就是 `fallback`（函数形态）收到真实 `error` 之后画出来的。
      </p>
    </div>
  ),
};

/** 子树不抛：`children` 原样渲染，边界**零开销**（不产生额外 DOM）
 *  —— 这条要在，免得有人以为它会包一层容器。 */
export const PassThrough: Story = {
  render: () => (
    <div className="w-lg rounded-lg border p-3">
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>
    </div>
  ),
};
