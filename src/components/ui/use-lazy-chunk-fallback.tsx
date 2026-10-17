"use client";

/**
 * 懒加载分块失败的用户可见出口（配合 `~/lib/shell/lazy-chunk-recovery`）。
 *
 * ## 为什么要有这一份
 *
 * 分块加载失败（dev server 重建后，已渲染页面手里的分块哈希指向被换掉的旧文件）
 * 的**自愈**只有一处实现：`~/lib/shell/lazy-chunk-recovery`。但自愈有闸（同一轮
 * 故障不刷第二次，防刷新死循环），没触及刷新时错误会照常抛给 boundary ——
 * 那时用户看到的是「组件渲染出错 / 重试」，而**重试必然再撞同一堵墙**：
 * `reset()` 重新渲染的是同一棵树，它手里的哈希还是旧的那份。
 *
 * 所以这一类故障需要自己的边界：局部隔离（规范 10 §10.1 的 L2）+ 一个**真的
 * 有用**的动作 ——「重新加载页面」（把新的哈希拿回来）。收成 hook 而不是让每个
 * 调用点各写一遍，是因为判据与文案必须在所有懒加载点上完全一致：漏一个，
 * 那一屏就又退回「重试按了没用」。
 *
 * 生产构建里 `import()` 失败意味着**产物缺件**（硬规则 18）。刷新救不了它，
 * 但「重新加载页面」仍是那时唯一正确的用户出口，所以文案不写「刷新一下就好」。
 */

import React from "react";

import { Button } from "~/components/ui/button";
import { isChunkLoadFailure } from "~/lib/shell/lazy-chunk-recovery";

/** 分块加载失败时的降级 UI：说清「缺的是文件、不是你的数据」，给一个真能出去的动作。 */
function ChunkReloadFallback({
  label,
  onReload,
}: {
  /** 说明「哪一块没加载上」，调用点按语境给。 */
  label: string;
  onReload: () => void;
}) {
  return (
    <div className="border-border bg-surface-2 text-ink-muted flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
      <p className="text-ink text-sm font-medium">{label}</p>
      <p className="text-xs">
        这一块的前端文件没有加载上（开发服务器刚重建过就会这样），
        重新加载一次即可，当前内容不会丢。
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onReload}>
        重新加载页面
      </Button>
    </div>
  );
}

/**
 * 给一个懒加载点接上「分块失败」的局部边界。
 *
 * 用法：`const fallback = useLazyChunkFallback("剧本工具")`，再
 * `<ErrorBoundary fallback={fallback}>…</ErrorBoundary>` 包住那段 `Suspense`。
 *
 * **只对分块失败接管**：其它异常返回 `null`（= 不接管，见 `ErrorBoundary` 的
 * `fallback` 契约），退回它自己的默认降级 UI —— 业务错误不该被说成「文件没加载上」。
 */
export function useLazyChunkFallback(
  label: string,
): (error: Error | null) => React.ReactNode {
  const onReload = React.useCallback(() => {
    window.location.reload();
  }, []);

  return React.useCallback(
    (error: Error | null) =>
      isChunkLoadFailure(error) ? (
        <ChunkReloadFallback label={label} onReload={onReload} />
      ) : /* 不是分块失败 → `null` = 不接管，交回 `ErrorBoundary` 自己的降级 UI
       * （业务错误不该被说成「文件没加载上」）。 */
      null,
    [label, onReload],
  );
}
