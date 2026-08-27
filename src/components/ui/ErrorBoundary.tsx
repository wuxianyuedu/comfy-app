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
    /** 降级 UI：可传 ReactNode，也可传 (error) => ReactNode 函数以拿到真实错误对象 */
    fallback?: React.ReactNode | ((error: Error | null) => React.ReactNode);
    onError?: (error: Error, info: React.ErrorInfo) => void;
  },
  { hasError: boolean; error: Error | null }
> {
  state: { hasError: boolean; error: Error | null } = {
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
      if (this.props.fallback) {
        return typeof this.props.fallback === "function"
          ? (this.props.fallback as (error: Error | null) => React.ReactNode)(this.state.error)
          : this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-red-400">组件渲染出错</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/[0.08]"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
