"use client";

import { useCallback, useEffect, useState } from "react";

import { DEFAULT_BRAND_LOGO, readBrandLogo } from "~/lib/appearance";
import { subscribeAppEvent } from "~/lib/app-events";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";

/**
 * 侧栏顶部的品牌图 —— **点击回首页**，不是换图入口。
 * 换图已经挪到「设置 → 外观」（品牌图那一档），这里只负责展示与跳转；
 * 悬停给「主页」提示，且不跟着其它侧栏项长出悬停背景框。
 */
export function SidebarBrand({ onHome }: { onHome: (view: "home") => void }) {
  const [logo, setLogo] = useState<string>(DEFAULT_BRAND_LOGO);

  /* 首帧故意用内置图（与 SSR 一致），挂载后读本机，再订阅设置页的换图广播。 */
  useEffect(() => {
    /* 延到提交之后读本机，避免 effect 内同步 setState 的级联渲染（与设置页同款）。 */
    const t = setTimeout(() => {
      setLogo(readBrandLogo());
    }, 0);
    const off = subscribeAppEvent("comfyapp:brand-logo-changed", () => {
      setLogo(readBrandLogo());
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, []);

  const onClick = useCallback(() => {
    onHome("home");
  }, [onHome]);

  return (
    <div className="flex h-16 shrink-0 items-center justify-center px-2 py-2">
      <Hint accessibleName label="主页" side="right">
        <Button
          className="group/brand h-full w-full bg-transparent! p-0 hover:bg-transparent!"
          onClick={onClick}
          type="button"
          variant="ghost"
        >
          <MediaThumbnail
            alt="品牌图片"
            as="image"
            className="max-h-full max-w-full object-contain group-data-[collapsible=icon]:size-8"
            fallback="none"
            src={logo}
          />
        </Button>
      </Hint>
    </div>
  );
}
