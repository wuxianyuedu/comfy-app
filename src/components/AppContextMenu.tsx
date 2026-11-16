"use client";

/**
 * 应用内右键菜单（ISSUE #4132）——样式做成与 **WebView2 / Chromium 默认菜单同款**
 * （用户偏好：浅色实底、系统字体栈、原生尺寸与悬停态，见 #4130 的对比讨论；
 * 交互与 #4126 版一致）。
 *
 * 全窗口兜底监听（bubble 相位，晚于 React 根容器处理）：凡没被某个表面自处理的
 * `contextmenu`（`defaultPrevented === false`）就 `preventDefault` 并渲染本菜单；
 * 已被处理的尊重原处理，不重复出菜单。关闭纪律：下一次 pointerdown / 失焦即收起。
 */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { zClass } from "~/lib/shell/overlay-z";

type MenuPosition = { x: number; y: number };

export function AppContextMenu() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);

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
   * 窗口失焦（切去别的应用）也收起，避免一个悬空菜单跨焦点存活。 */
  useEffect(() => {
    if (!menu) {
      return;
    }
    const closeOnNext = () => {
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

  if (!menu) {
    return null;
  }
  return (
    <div
      className={`fixed min-w-[220px] rounded-lg border border-black/10 bg-[#f3f3f3] py-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.25)] ${zClass("popup")}`}
      role="menu"
      style={{
        left: menu.x,
        top: menu.y,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <MenuButton icon={<RotateCw size={14} />} label="刷新页面" onClick={reload} />
      <div className="mx-2 my-1 h-px bg-[#dadce0]" />
      <MenuButton icon={<ArrowLeft size={14} />} label="后退" onClick={back} />
      <MenuButton icon={<ArrowRight size={14} />} label="前进" onClick={forward} />
    </div>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="h-auto! w-full! justify-start! rounded-[6px]! border-0! px-2.5! py-1.5! text-[13px]! font-normal! text-[#3c4043]! hover:bg-[#e8eaed]! hover:text-[#3c4043]! dark:hover:bg-[#e8eaed]!"
      onClick={onClick}
      role="menuitem"
      variant="ghost"
    >
      <span className="shrink-0 text-[#5f6368]">{icon}</span>
      {label}
    </Button>
  );
}
