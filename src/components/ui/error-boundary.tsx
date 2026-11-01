"use client";

import React from "react";

/**
 * ErrorBoundary — 客户端错误边界。
 *
 * 包在业务子树外层，捕获渲染期异常并展示降级 UI，
 * 避免整页白屏。与 app/error.tsx 互补：
 * - app/error.tsx 处理 Next 路由层错误
 * - 本组件处理页面内局部组件的渲染错误
 */
export class ErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    /** 降级 UI：可传 ReactNode，也可传 (error) => ReactNode 函数以拿到真实错误对象。
     * 函数形态返回 `null` / `undefined` 表示「这次不接管」，退回本组件的默认降级 UI —
     * 让调用点只处理它认得的那一类错误，其余照旧（见 `useLazyChunkFallback`）。 */
    fallback?: React.ReactNode | ((error: Error | null) => React.ReactNode | null | undefined);
    onError?: (error: Error, info: React.ErrorInfo) => void;
  },
  { error: Error | null; hasError: boolean }
> {
  state: { error: Error | null; hasError: boolean } = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 生产级：上报可观测性（pino 服务端 / Sentry 可选）
    if (typeof window !== "undefined") {
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.hasError) {
      /* 函数形态可能对某一类错误说「我不接管」（返回 `null`）：那时必须继续走到
       * 下面的默认降级 UI，而不是把它当成降级的全部内容 —— 后者渲染出来是**整块
       * 空白**，用户既看不到出了什么事、也没有「重试」。 */
      const custom = this.props.fallback;
      if (typeof custom === "function") {
        const node = /* SAFETY: 类型断言已复核 */ (
          custom as (error: Error | null) => React.ReactNode
        )(this.state.error);
        if (node !== null && node !== undefined) {
          return node;
        }
      } else if (custom) {
        return custom;
      }
      return (
        <div className="border-destructive/25 bg-destructive/5 flex flex-col items-center justify-center gap-3 rounded-2xl border px-6 py-12 text-center">
          <p className="text-danger-strong text-sm font-semibold">组件渲染出错</p>
          <button
            className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            onClick={() => this.setState({ hasError: false, error: null })}
            type="button"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
