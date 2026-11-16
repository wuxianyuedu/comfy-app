"use client";

/**
 * 应用级右键菜单兜底（ISSUE #4126）。
 *
 * 单子里那张截图的来源：**WebView2 / Chromium 的默认右键菜单**——画布有自己的
 * 应用主题菜单（`CanvasArea` 的 contextItems，先 `preventDefault`），其余界面
 * 此前没人管右键 ⇒ 默认菜单直接露出来：浅色、系统字体，与应用的主题与字体
 * 都不一致。
 *
 * 这里在全窗口挂一个**兜底**监听（bubble 相位，晚于 React 的根容器处理）：
 * 凡是没被某个表面自处理的 `contextmenu`（`defaultPrevented === false`），
 * 就 `preventDefault` 并渲染一份应用主题的小菜单（刷新 / 后退 / 前进）；
 * 已被处理的（画布）尊重原处理，不重复出菜单。
 */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";

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

  /* 与 CanvasArea 的菜单同一条关闭纪律：下一次 pointerdown（任意处）即收起；
   * 窗口失焦（切去别的应用）也收起，避免一个悬空菜单跨焦点存活。 */
  useEffect(() => {
    if (!menu) {
      return;
    }
    const closeOnNextPointerDown = () => {
      setMenu(null);
    };
    window.addEventListener("pointerdown", closeOnNextPointerDown, { once: true });
    window.addEventListener("blur", closeOnNextPointerDown);
    return () => {
      window.removeEventListener("pointerdown", closeOnNextPointerDown);
      window.removeEventListener("blur", closeOnNextPointerDown);
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
      className={`border-border-strong bg-panel fixed min-w-40 rounded-xl border py-1.5 shadow-2xl shadow-black/20 backdrop-blur-md ${zClass("popup")}`}
      role="menu"
      style={{ left: menu.x, top: menu.y }}
    >
      <MenuButton icon={<RotateCw size={14} />} label="刷新页面" onClick={reload} />
      <div className="bg-border-strong my-1 h-px" />
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
    <button
      className="text-ink-strong hover:bg-subtle flex h-auto w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-xs font-normal"
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="text-ink-fainter shrink-0">{icon}</span>
      {label}
    </button>
  );
}
