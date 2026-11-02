"use client";

/* ── WindowControls · 两条标题行共用的窗口按钮与拖拽判据 ─────────────────
 *
 * 桌面壳关掉原生装饰后，应用里有**两条**标题行要提供同一组窗口动作：
 *   · `TitleBarTabs` —— `ShellTabs` 的应用级标题行（页签 + 拖拽区 + 按钮）；
 *   · `WindowTitleBar` —— 整屏路由页（错误页 / 404 / global-error / 登录页）
 *     自带的精简标题行（只有拖拽区 + 按钮；那些页面一显示，`ShellTabs` 连
 *     同按钮一起卸载，见 ISSUE #1794 第二次修正）。
 *
 * 两处若各写一份按钮与最大化订阅，就是 §12.12 的孪生实现（实测重合 86.7%，
 * 被跨文件重复门禁拦下）——且「最大化 / 还原」图标跟着状态走这种细节漂了
 * 很难发现。所以按钮、状态订阅、拖拽判据都收在本模块，两条标题行各自只留
 * 自己的差异（页签 vs 没有页签）。
 *
 * 动作本体不在这里：`window-controls-client`（非壳降级为空操作）与
 * `title-bar-derive`（图标 / 标签 / 拖拽区判据）是第①层纯逻辑，本模块只
 * 负责把它们接进 React。
 */

import { useCallback, useEffect, useState } from "react";
import { Copy, Square, X, Minus } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { cn } from "~/lib/utils";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  startWindowDrag,
  toggleMaximizeWindow,
} from "~/lib/shell/window-controls-client";
import {
  isDragRegionTarget,
  resolveMaximizeButtonKind,
  WINDOW_BUTTON_LABELS,
  type WindowButtonKind,
} from "~/lib/shell/title-bar-derive";

/** 单个窗口控制按钮 —— `w-11` 全高方键，与系统标题栏的点击热区同形。 */
export function WindowButton({
  kind,
  onClick,
  danger,
}: {
  danger?: boolean;
  kind: WindowButtonKind;
  onClick: () => void;
}) {
  const label = WINDOW_BUTTON_LABELS[kind];
  const icon =
    kind === "minimize" ? (
      <Minus size={14} />
    ) : kind === "maximize" ? (
      <Square size={12} />
    ) : kind === "restore" ? (
      <Copy size={12} />
    ) : (
      <X size={15} />
    );
  return (
    <Hint label={label}>
      <Button
        aria-label={label}
        className={cn(
          "text-ink-soft h-full w-11 rounded-none",
          danger === true
            ? "hover:bg-destructive hover:text-primary-foreground"
            : "hover:bg-subtle hover:text-ink-bright",
        )}
        data-no-drag
        onClick={onClick}
        variant="ghost"
      >
        {icon}
      </Button>
    </Hint>
  );
}

/**
 * 最大化状态：初始读一次，之后订阅窗口尺寸变化。
 *
 * 尺寸变化覆盖最大化 / 还原 / 拖拽边缘三种来路（双击标题栏、拖到屏幕顶、
 * 系统快捷键都会改它），所以不能只在点击时刷新。订阅带 `alive` 标记：
 * 回调落在已卸载组件上会触发 React 的卸载后更新。
 */
export function useWindowMaximized(): [boolean, (next: boolean) => void] {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void (async () => {
      const current = await isWindowMaximized();
      if (alive) {
        setMaximized(current);
      }
      unlisten = await onWindowResized((next) => {
        if (alive) {
          setMaximized(next);
        }
      });
    })();
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return [maximized, setMaximized];
}

/**
 * 标题行拖拽判据：按住拖拽区移动窗口、双击空白处最大化 / 还原。
 *
 * 只响应主键、且目标不在 `data-no-drag` 标记内（页签与按钮要把点击留给自己，
 * 否则会被拖拽行为吞掉 —— 判据在 `title-bar-derive`）。
 *
 * 最大化状态由调用方持有（它与 `WindowControls` 的按钮图标是同一格状态，
 * 两份 state 必然漂）—— 这里只拿到 setter。
 */
export function useTitleBarDrag(setMaximized: (next: boolean) => void) {
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return;
    }
    if (
      !isDragRegionTarget(
        /* SAFETY: 类型断言已复核 */ e.target as unknown as {
          closest?: (s: string) => unknown;
        },
      )
    ) {
      return;
    }
    void startWindowDrag();
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (
        !isDragRegionTarget(
          /* SAFETY: 类型断言已复核 */ e.target as unknown as {
            closest?: (s: string) => unknown;
          },
        )
      ) {
        return;
      }
      void toggleMaximizeWindow().then((next) => {
        if (next !== null) {
          setMaximized(next);
        }
      });
    },
    [setMaximized],
  );

  return { onPointerDown: handlePointerDown, onDoubleClick: handleDoubleClick };
}

/**
 * 三个窗口按钮（最小化 / 最大化-还原 / 关闭）。
 *
 * 两条标题行渲染的是同一组按钮，连「最大化 / 还原」图标跟着状态走都一致 ——
 * 各自写一份的代价见文件头。状态由调用方传入（与拖拽双击共用同一格，
 * 否则双击最大化后按钮图标不刷新）。
 */
export function WindowControls({
  maximized,
  onMaximizedChange,
}: {
  maximized: boolean;
  onMaximizedChange: (next: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-stretch">
      <WindowButton
        kind="minimize"
        onClick={() => {
          void minimizeWindow();
        }}
      />
      <WindowButton
        kind={resolveMaximizeButtonKind(maximized)}
        onClick={() => {
          void toggleMaximizeWindow().then((next) => {
            if (next !== null) {
              onMaximizedChange(next);
            }
          });
        }}
      />
      <WindowButton
        danger
        kind="close"
        onClick={() => {
          void closeWindow();
        }}
      />
    </div>
  );
}
