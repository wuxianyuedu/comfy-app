"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { FilePicker, useFilePicker } from "~/components/ui/file-picker";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { readStorageItem, removeStorageItem, writeStorageItem } from "~/lib/browser-storage";
import { readFileAsDataUrl } from "~/lib/file-io";

/** 侧栏顶部的品牌图片。默认用内置图，用户可换成自己的图片（存本机，不入库、不上传）。 */
const DEFAULT_LOGO = "/brand-logo.svg";
const STORAGE_KEY = "sidebar-brand-logo";

/**
 * 侧栏顶部的品牌图 —— 一张可以点开更换的图片（参考 Issue #4813）。
 * 展开态显示整张图，图标档只留方形缩略；点图片选文件、选完即时替换，「恢复默认」撤销自定义。
 */
export function SidebarBrand() {
  const [logo, setLogo] = useState<string>(DEFAULT_LOGO);
  const [custom, setCustom] = useState(false);

  /* 挂载后读本机自定义图：服务端首帧与客户端都用默认图，避免 hydration 不一致。 */
  useEffect(() => {
    const stored = readStorageItem(STORAGE_KEY);
    if (stored) {
      /* 外部系统（本机存储）同步到视图：首帧故意用默认图，挂载后才补上自定义图。 */
      // oxlint-disable-next-line react/set-state-in-effect
      setLogo(stored);
      setCustom(true);
    }
  }, []);

  const onPick = useCallback((file: File) => {
    void readFileAsDataUrl(file).then((dataUrl) => {
      setLogo(dataUrl);
      setCustom(true);
      /* 写不进去（隐私模式 / 配额满）时图片仍在本次会话生效，只是关掉后不保留。 */
      writeStorageItem(STORAGE_KEY, dataUrl);
    });
  }, []);

  const picker = useFilePicker({ accept: "image/*", onPick });

  const restore = useCallback(() => {
    setLogo(DEFAULT_LOGO);
    setCustom(false);
    removeStorageItem(STORAGE_KEY);
  }, []);

  return (
    <div className="group/data-brand relative flex h-16 shrink-0 items-center justify-center px-2 py-2">
      <Button
        aria-label="更换品牌图片"
        className="hover:bg-sidebar-accent h-full w-full p-0"
        onClick={picker.open}
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
      {custom ? (
        <Button
          aria-label="恢复默认品牌图片"
          className="bg-background absolute top-1 right-1 size-6 opacity-0 transition-opacity group-hover/data-brand:opacity-100 group-data-[collapsible=icon]:hidden focus-visible:opacity-100"
          onClick={restore}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <RotateCcw data-icon="inline-start" size={12} />
        </Button>
      ) : null}
      <FilePicker {...picker.inputProps} />
    </div>
  );
}
