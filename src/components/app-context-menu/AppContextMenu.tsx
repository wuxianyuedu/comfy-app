"use client";

/**
 * 应用内右键菜单（ISSUE #4132）——样式做成与 **WebView2 / Chromium 默认菜单同款**
 * （用户偏好：系统字体栈、原生尺寸与悬停态，见 #4130 的对比讨论；
 * 交互与 #4126 版一致）。配色用 `dark:` 变体跟随明暗主题（ISSUE #4822）：
 * 浅色保持 WebView2 默认观感，暗色对齐 Chromium 暗色菜单（深底 / 浅字 / 悬停微亮）。
 *
 * 全窗口兜底监听（bubble 相位，晚于 React 根容器处理）：凡没被某个表面自处理的
 * `contextmenu`（`defaultPrevented === false`）就 `preventDefault` 并渲染本菜单；
 * 已被处理的尊重原处理，不重复出菜单。关闭纪律：下一次 pointerdown / 失焦即收起。
 */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Eraser, MemoryStick, RotateCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { zClass } from "~/lib/shell/overlay-z";

import { useComfyFree } from "./hooks/use-comfy-free";

type MenuPosition = { x: number; y: number };

export function AppContextMenu() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  /* 「ComfyUI」组的两档卸载（ISSUE #4822）：逻辑在 hooks/（§16.2.1 第②层），
   * 这里只拿动作与忙态；两项共享 busy，点完菜单即收起，结果由 toast 带回。 */
  const { freeing, unloadModels, unloadModelsWithCache } = useComfyFree();

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      /* 画布等已自处理（preventDefault）的表面：尊重，不重复出菜单。 */
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  /* 关闭纪律与画布菜单同款：下一次 pointerdown（任意处）即收起；
   * 窗口失焦（切去别的应用）也收起，避免一个悬空菜单跨焦点存活。
   * **菜单自身的 pointerdown 不算**（#4417）：菜单项的动作挂在 onClick 上，
   * 浏览器事件序是 pointerdown → … → click——pointerdown 里把菜单卸了，
   * click 派发时按钮已不在 DOM，三个菜单项永远点不到。 */
  useEffect(() => {
    if (!menu) {
      return;
    }
    const closeOnNext = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      setMenu(null);
    };
    window.addEventListener("pointerdown", closeOnNext, { once: true });
    window.addEventListener("blur", closeOnNext);
    return () => {
      window.removeEventListener("pointerdown", closeOnNext);
      window.removeEventListener("blur", closeOnNext);
    };
  }, [menu]);

  const close = useCallback(() => {
    setMenu(null);
  }, []);

  const reload = useCallback(() => {
    close();
    window.location.reload();
  }, [close]);

  const back = useCallback(() => {
    close();
    window.history.back();
  }, [close]);

  const forward = useCallback(() => {
    close();
    window.history.forward();
  }, [close]);

  const onUnloadModels = useCallback(() => {
    close();
    unloadModels();
  }, [close, unloadModels]);

  const onUnloadModelsWithCache = useCallback(() => {
    close();
    unloadModelsWithCache();
  }, [close, unloadModelsWithCache]);

  if (!menu) {
    return null;
  }
  return (
    <div
      className={`fixed min-w-[220px] rounded-lg border border-black/10 bg-[#f3f3f3] py-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-[#292a2d] ${zClass("popup")}`}
      ref={menuRef}
      role="menu"
      style={{
        left: menu.x,
        top: menu.y,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <MenuButton icon={<RotateCw size={14} />} label="刷新页面" onClick={reload} />
      <div className="mx-2 my-1 h-px bg-[#dadce0] dark:bg-[#3c3b40]" />
      <MenuButton icon={<ArrowLeft size={14} />} label="后退" onClick={back} />
      <MenuButton icon={<ArrowRight size={14} />} label="前进" onClick={forward} />
      <div className="mx-2 my-1 h-px bg-[#dadce0] dark:bg-[#3c3b40]" />
      {/* 「ComfyUI」组：组名只是可见分界（用户以「页签」指认的这一格），
          不参与 role=menu 的菜单项语义。 */}
      <div className="px-2.5 pt-1 pb-0.5 text-xs text-[#5f6368] dark:text-[#9aa0a6]">ComfyUI</div>
      <MenuButton
        disabled={freeing}
        icon={<MemoryStick size={14} />}
        label="卸载模型"
        onClick={onUnloadModels}
      />
      <MenuButton
        disabled={freeing}
        icon={<Eraser size={14} />}
        label="卸载模型和执行缓存"
        onClick={onUnloadModelsWithCache}
      />
    </div>
  );
}

function MenuButton({
  disabled = false,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="h-auto! w-full! justify-start! rounded-md! border-0! px-2.5! py-1.5! text-sm! font-normal! text-[#3c4043]! hover:bg-[#e8eaed]! hover:text-[#3c4043]! dark:text-[#e8eaed]! dark:hover:bg-[#3c3b40]! dark:hover:text-[#e8eaed]!"
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      variant="ghost"
    >
      <span className="shrink-0 text-[#5f6368] dark:text-[#9aa0a6]">{icon}</span>
      {label}
    </Button>
  );
}
