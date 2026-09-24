"use client";

/**
 * ImageViewer —— 「把一张图看全」的通用出口（浮层口径见规范 16 §16.2.3；
 * 缩略图与失败兜底复用 §16.2.4.21 的 `MediaThumbnail`，不另写一份）。
 *
 * 起因是运行结果图在详情面板里被裁：缩略图那个盒子只有几百像素宽，用户
 * 想看清提示词画出来的细节时没有任何放大入口（既不能按原始像素看，也不能
 * 缩放到某个局部）。此前全库的图片都只是「渲染出来」，没有「查看」这一档。
 *
 * 两种用法：
 *
 * - `<ViewableImage src={url} ... />` —— 缩略图 + 点开查看（多数落点用这个，
 *   调用处一行替换掉原来的 `MediaThumbnail`）；
 * - `<ImageViewer src={url} onClose={...} />` —— 受控弹窗（调用处自己管开关，
 *   例如点整张卡片才打开）。
 *
 * 交互按「看图」的通行口径给全：
 *
 * - **适应窗口**（默认）与 **原始大小（1:1）** 两个档位，加上按 1.25 倍的
 *   放大 / 缩小；倍数与百分比由 `use-image-zoom` 算（数值侧单测）；
 * - **滚轮缩放**：以光标为锚点 —— 缩放后光标下的那块像素仍停在光标处，
 *   否则放大时想看的地方会从指针底下跑掉；
 * - **按住拖拽平移**：1:1 看长图时靠滚动条太慢。**拖动期间只改 transform、
 *   松手才把位移落到滚动偏移** —— 逐帧写 `scrollLeft` / `scrollTop` 是主线程
 *   滚动，浏览器要为每一帧重新布局 + 绘制（大图尤其贵，指针 120Hz 下就是
 *   肉眼可见的卡顿），而「把已经画好的内容挪个位置」交给合成器就够了；
 * - **双击**在适应窗口与原始大小之间切换；Esc / 点遮罩 / 右上角关闭都走
 *   `ui/dialog`（焦点锁与归还、遮罩让位标题行都在基元里，见其文件头）。
 *
 * 三条刻意不做的：
 *
 * - 不做「旋转 / 翻转 / 下载」这类编辑动作：它们是另一件事，塞进来会让
 *   「看图」这个出口变成一个半成品编辑器；
 * - 不做图片预加载 / 相邻图切换：调用处只给一张图，多图切换是列表的事；
 * - 不用 `transform: scale` 缩放：那样「原始大小」的像素与容器滚动都对不上，
 *   滚动条也失去了长度信息。这里直接按像素给宽高，滚动交给容器。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, X, ZoomIn } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  MediaThumbnail,
  type MediaFallback,
} from "~/components/ui/media-thumbnail";
import { useElementBox } from "~/components/ui/use-element-box";
import {
  clampZoomScale,
  useImageZoom,
  ZOOM_STEP,
} from "~/components/ui/use-image-zoom";
import { readElementBox } from "~/lib/dom-rect";
import { readNaturalSize, type NaturalSize } from "~/lib/media/natural-size";
import { onNextFrame, type CancelNextFrame } from "~/lib/next-frame";

/** 画布内单边留白（px）：图片不贴边，也参与「适应窗口」的可视区折算。 */
const VIEWPORT_PADDING = 16;

/** 弹窗尺寸：贴视口但留出四周余量，且不挡住底部状态栏。 */
const VIEWER_POPUP_WIDTH = "w-[min(96vw,1400px)]";
const VIEWER_BODY_HEIGHT = "h-[min(86vh,880px)]";

export interface ImageViewerProps {
  /** 要查看的图片地址；`null` 时组件不渲染（调用处据此表达「关着」）。 */
  src: string | null;
  alt?: string;
  /** 弹窗标题；缺省回退到 `alt`，再回退到一句通用文案。 */
  label?: string;
  /** 关闭（Esc / 点遮罩 / 右上角 ✕ 都走它）。 */
  onClose: () => void;
}

/**
 * 受控的图片查看器。渲染时 `src` 必须有值 —— 需要「关着」的调用处传 `null`。
 */
export function ImageViewer({
  src,
  alt = "",
  label,
  onClose,
}: ImageViewerProps) {
  /* 已解码图片的尺寸与它对应的地址：地址换了旧尺寸立刻失效（否则新图会先按
   * 上一张的尺寸渲染一帧，尺寸差得远时肉眼可见地跳一下）。 */
  const [loaded, setLoaded] = useState<{
    src: string;
    size: NaturalSize;
  } | null>(null);
  const natural = loaded?.src === src ? loaded.size : null;

  /* 画布（滚动容器）：既用来量可视区（算「适应窗口」），也用来改滚动偏移
   * （拖拽平移 / 滚轮锚点）。两者必须指向同一个元素。
   *
   * 元素存 `ref` 而不是 `state`：往下要改它的 `scrollLeft` / `scrollTop`，
   * 而「改 `useState` 拿到的值」是 React 明令禁止的（元素本身不是状态，
   * 状态是它量出来的读数）。「元素出现了没有」这件事由 `useElementBox`
   * 的读数派生（`box !== null` 即已挂上并量到）—— 这样 effect 的依赖仍然是
   * 「元素本身」，而不是「弹窗开了没有」（规范 16 §16.2.4.12 末尾那条）。 */
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [boxRef, box] = useElementBox();
  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el;
      boxRef(el);
    },
    [boxRef],
  );
  const scrollerReady = box !== null;

  /* 可视区尺寸取**矩形**（`box.width` / `box.height`）而不是 `clientWidth` /
   * `clientHeight`：后两者**不含滚动条**，会随「内容是否溢出」而变，于是
   * 「适应窗口」算出的尺寸 ↔ 滚动条出现/消失 构成正反馈环 —— 按适应尺寸渲染
   * → 差一点点溢出 → 出现滚动条 → 可视区变小 → 重算更小的适应尺寸 → 滚动条
   * 消失 → 可视区变大 → …… 用户看到的就是「不停抖动、滚动条一来一去」，逐帧
   * 重排还让拖拽发卡。矩形是**布局尺寸**，滚动条出现与否都不改它，适应尺寸
   * 因此是矩形的纯函数，收敛到「无滚动条」这个不动点。 */
  const zoom = useImageZoom({
    naturalSize: natural,
    viewportWidth: box ? box.width : null,
    viewportHeight: box ? box.height : null,
    padding: VIEWPORT_PADDING,
  });
  const naturalWidth = natural?.width ?? null;
  const naturalHeight = natural?.height ?? null;

  /* 缩放后要落到的滚动位置。**不能在 setState 之后立刻写** —— 那一刻 DOM
   * 里还是旧尺寸，写进去会被旧的内容范围夹掉。存下来、等这一轮渲染提交完
   * 再由 effect 应用（`scale` 表示它属于哪一轮，避免残留值被下一轮误用）。 */
  const pendingScrollRef = useRef<{
    scale: number;
    left: number;
    top: number;
  } | null>(null);

  /* 滚轮处理挂在原生监听上（而不是 React 的 `onWheel`）：React 对 wheel
   * 用 passive 监听，`preventDefault` 会被忽略（缩放的同时容器还在滚）。
   * 回调里读的值一律走 ref —— 监听只挂一次，不能闭包住首帧的 state。 */
  const zoomRef = useRef(zoom);
  const scaleRef = useRef(zoom.scale);
  useEffect(() => {
    zoomRef.current = zoom;
    scaleRef.current = zoom.scale;
  });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || naturalWidth === null || naturalHeight === null) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = scaleRef.current;
      const next = clampNext(current, event.deltaY < 0);
      if (next === current) return;
      const rect = readElementBox(el);
      if (!rect) return;
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      /* 光标下的**内容坐标**保持不变：新滚动位置 = 该内容坐标 × 缩放比 − 光标在视口里的偏移。 */
      const ratio = next / current;
      pendingScrollRef.current = {
        scale: next,
        left: (el.scrollLeft + offsetX) * ratio - offsetX,
        top: (el.scrollTop + offsetY) * ratio - offsetY,
      };
      scaleRef.current = next;
      zoomRef.current.scaleTo(next);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scrollerReady, naturalWidth, naturalHeight]);

  useEffect(() => {
    const el = scrollerRef.current;
    const pending = pendingScrollRef.current;
    if (!el || pending?.scale !== zoom.scale) return;
    pendingScrollRef.current = null;
    el.scrollLeft = pending.left;
    el.scrollTop = pending.top;
  }, [scrollerReady, zoom.scale]);

  /* 拖拽平移：**拖动期间只改内层的 transform，松手才落到滚动偏移**。
   *
   * 为什么不能逐帧写 `scrollLeft` / `scrollTop`（用户实测「拖动有卡顿」）：
   * 那是**主线程滚动** —— 浏览器必须为每一帧重新做布局与绘制，图片越大越贵
   * （缩放后动辄几千像素宽），而指针设备一秒能来 120 次。拖拽这件事的实质
   * 只是「把已经画好的内容挪个位置」，交给合成器（transform）不必碰布局。
   *
   * 松手时把累计位移一次性写回 `scrollLeft` / `scrollTop`：滚动条因此仍如实
   * 反映位置，后续的滚轮锚定、双击缩放也就有了正确的基准。
   *
   * 指针捕获让指针移出容器后仍能收到事件（否则拖到边缘就断）。 */
  const innerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    dx: number;
    dy: number;
  } | null>(null);
  /* 本帧是否已排过一次写入（同一帧内的多个 pointermove 合并成一次）。 */
  const panFrameRef = useRef<CancelNextFrame | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (event.button !== 0 || !el) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      dx: 0,
      dy: 0,
    };
    /* 拖拽期间把内层提为合成层（松手即撤），免得每帧重新栅格化整张图。 */
    if (innerRef.current) innerRef.current.style.willChange = "transform";
    if (typeof el.setPointerCapture === "function") {
      el.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.dx = event.clientX - drag.startX;
    drag.dy = event.clientY - drag.startY;
    if (panFrameRef.current) return;
    panFrameRef.current = onNextFrame(() => {
      panFrameRef.current = null;
      const inner = innerRef.current;
      const current = dragRef.current;
      if (!inner || !current) return;
      inner.style.transform = `translate3d(${current.dx}px, ${current.dy}px, 0)`;
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    const drag = dragRef.current;
    /* 先撤 transform 再写滚动偏移：两件事在同一帧里完成，浏览器只重绘一次；
     * 反过来会先看到「内容弹回原位」再「滚到位」的闪动。 */
    if (innerRef.current) {
      innerRef.current.style.transform = "";
      innerRef.current.style.willChange = "";
    }
    if (el && drag) {
      el.scrollLeft = drag.scrollLeft - drag.dx;
      el.scrollTop = drag.scrollTop - drag.dy;
    }
    if (drag && el && typeof el.releasePointerCapture === "function") {
      el.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  /* 卸载时撤掉可能还排着的那一帧（弹窗在拖拽中被关掉）。 */
  useEffect(() => () => panFrameRef.current?.(), []);

  if (!src) return null;

  const title = firstText(label, alt) ?? "图片查看";
  /* 尺寸未知（解码中）时先按「不超过可视区」显示，读到自然尺寸再切成像素尺寸
   * —— 直接按 1:1 渲染会让大图在第一帧撑出容器，看着像抖了一下。 */
  const mediaStyle =
    naturalWidth !== null && naturalHeight !== null
      ? {
          width: Math.round(naturalWidth * zoom.scale),
          height: Math.round(naturalHeight * zoom.scale),
        }
      : undefined;
  const mediaClass =
    mediaStyle === undefined
      ? "block max-h-full max-w-full object-contain select-none"
      : "block max-h-none max-w-none select-none";
  const modeLabel =
    zoom.mode === "fit"
      ? "适应窗口"
      : zoom.mode === "actual"
        ? "原始大小"
        : "自定义缩放";

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-slot="image-viewer"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName={VIEWER_POPUP_WIDTH}
      >
        <div
          className={`border-border bg-panel flex flex-col overflow-hidden rounded-2xl border ${VIEWER_BODY_HEIGHT}`}
        >
          <div className="border-border-subtle flex h-11 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <ZoomIn
                size={15}
                className="text-ink-muted shrink-0"
                aria-hidden="true"
              />
              <DialogTitle className="text-ink min-w-0 truncate text-[13px] font-semibold">
                {title}
              </DialogTitle>
              {naturalWidth !== null && naturalHeight !== null && (
                <span className="text-ink-fainter shrink-0 text-[11px] tabular-nums">
                  {naturalWidth} × {naturalHeight}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={zoom.zoomOut}
                aria-label="缩小"
                title="缩小"
                className="text-ink-muted hover:text-ink rounded-md"
              >
                <Minus size={14} />
              </Button>
              <span
                className="text-ink-muted w-12 text-center text-[11px] tabular-nums"
                data-testid="image-viewer-percent"
              >
                {zoom.percent}%
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={zoom.zoomIn}
                aria-label="放大"
                title="放大"
                className="text-ink-muted hover:text-ink rounded-md"
              >
                <Plus size={14} />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={zoom.fit}
                aria-pressed={zoom.mode === "fit"}
                className={`h-auto rounded-md px-2 py-1 text-[11px] ${
                  zoom.mode === "fit"
                    ? "bg-surface-2 text-ink"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                适应窗口
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={zoom.actualSize}
                aria-pressed={zoom.mode === "actual"}
                className={`h-auto gap-1 rounded-md px-2 py-1 text-[11px] ${
                  zoom.mode === "actual"
                    ? "bg-surface-2 text-ink"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                <Maximize2 size={11} />
                原始大小
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label="关闭"
                title="关闭"
                className="text-ink-muted hover:text-ink rounded-md"
              >
                <X size={15} />
              </Button>
            </div>
          </div>

          {/* 画布：双击切换适应窗口 / 原始大小；滚轮与拖拽见上方 handler。 */}
          <div
            ref={setScroller}
            data-testid="image-viewer-canvas"
            onDoubleClick={zoom.toggleFitActual}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="bg-canvas-deep relative min-h-0 flex-1 cursor-grab touch-none overflow-auto overscroll-contain active:cursor-grabbing"
          >
            {/* 内层用 `w-max min-w-full h-max min-h-full` + 居中：图比可视区小时
                居中显示，比可视区大时内层恰好等于图宽/高，`justify-center` 不再
                产生偏移（经典 flex 居中会裁掉溢出内容的左/上边缘）。 */}
            <div
              ref={innerRef}
              data-testid="image-viewer-content"
              className="flex h-max min-h-full w-max min-w-full items-center justify-center"
              style={{ padding: VIEWPORT_PADDING }}
            >
              <MediaThumbnail
                src={src}
                alt={alt}
                fallback={
                  <span className="text-ink-fainter text-xs">图片不可用</span>
                }
                className={mediaClass}
                style={mediaStyle}
                draggable={false}
                onLoad={(media) => {
                  const size = readNaturalSize(media);
                  if (size) setLoaded({ src, size });
                }}
              />
            </div>
          </div>

          <div className="border-border-subtle text-ink-fainter flex h-8 shrink-0 items-center justify-between gap-3 border-t px-4 text-[11px]">
            <span className="truncate">
              滚轮缩放 · 按住拖拽平移 · 双击切换适应窗口 / 原始大小
            </span>
            <span className="shrink-0" data-testid="image-viewer-mode">
              {modeLabel}
            </span>
          </div>
        </div>

        <DialogDescription className="sr-only">
          图片查看器：可缩放、拖拽平移，按 Esc 关闭
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

/** 按滚轮方向算下一个倍数（夹取口径与 hook 内同一份）。 */
function clampNext(current: number, zoomIn: boolean): number {
  const factor = zoomIn ? ZOOM_STEP : 1 / ZOOM_STEP;
  return clampZoomScale(current * factor);
}

/**
 * 取第一个「真的给了」的文案：空串与只有空白都算没给。
 *
 * 用 `??` 串不起来这件事（`label ?? alt` 会让 `label=""` 挡住 `alt`），
 * 而 `label || alt` 会被 lint 判为「该用 `??`」—— 两者的差别恰好是这里
 * 要表达的语义，所以写成显式的筛选而不是二选一的运算符。
 */
function firstText(...values: (string | undefined)[]): string | null {
  return values.find((value) => (value ?? "").trim() !== "") ?? null;
}

export interface ViewableImageProps {
  src?: string | null;
  alt?: string;
  /** 缩略图自身的 class（与 `MediaThumbnail` 同义）。 */
  className?: string;
  /** 查看器标题；缺省用 `alt`。 */
  label?: string;
  /** 加载失败兜底（透传 `MediaThumbnail`）。 */
  fallback?: MediaFallback;
  /** 缩略图上的提示文案（鼠标悬停）。 */
  title?: string;
}

/**
 * 缩略图 + 点开查看的组合形态：把原来的 `MediaThumbnail` 换成它即可获得
 * 查看器（键盘可达 —— 缩略图是按钮，回车 / 空格同样能打开）。
 */
export function ViewableImage({
  src,
  alt = "",
  className,
  label,
  fallback,
  title = "点击查看大图",
}: ViewableImageProps) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  const name = firstText(label, alt);
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={name ? `查看大图：${name}` : "查看大图"}
        /* `h-full` 而不是 `h-auto`：调用处常在**有确定高度**的盒子里塞它
           （`aspect-square` 网格、定高缩略图位），缩略图的 `h-full` 要有参照
           才撑得满；父级高度是 auto 时 `h-full` 计算为 auto，行为不变。 */
        className="h-full w-full cursor-zoom-in rounded-xl p-0 hover:bg-transparent"
      >
        <MediaThumbnail
          src={src}
          alt={alt}
          className={className}
          fallback={fallback}
        />
      </Button>
      {open && (
        <ImageViewer
          src={src}
          alt={alt}
          label={name ?? undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
