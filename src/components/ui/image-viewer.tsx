"use client";

/**
 * ImageViewer —— 「把一张图看全」的通用出口（规范 16 §16.2.3；缩略图 / 失败兜底复用 §16.2.4.21 的 `MediaThumbnail`）。用法：`<ViewableImage>` 缩略图 + 点开，或受控 `<ImageViewer>`。
 * 滚轮缩放以光标为锚点；拖拽期间只改 transform、松手才写滚动偏移（逐帧写 `scrollLeft` 是主线程滚动，大图 120Hz 明显卡顿）。1:1 直接按像素给宽高，不用 `transform: scale`；Esc / 遮罩 / 关闭走 `ui/dialog`。
 * 刻意不做旋转 / 翻转 / 下载与相邻图切换：那是另一件事，塞进来会变成半成品编辑器。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, X, ZoomIn } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { MediaThumbnail, type MediaFallback } from "~/components/ui/media-thumbnail";
import { SelectChip } from "~/components/ui/select-chip";
import { useElementBox } from "~/components/ui/use-element-box";
import { clampZoomScale, useImageZoom, ZOOM_STEP } from "~/components/ui/use-image-zoom";
import { readElementBox } from "~/lib/dom-rect";
import { readNaturalSize, type NaturalSize } from "~/lib/media/natural-size";
import { onNextFrame, type CancelNextFrame } from "~/lib/next-frame";

/** 画布内单边留白（px）：图片不贴边，也参与「适应窗口」的可视区折算。 */
const VIEWPORT_PADDING = 16;

/** 弹窗尺寸：贴视口但留出四周余量，且不挡住底部状态栏。 */
const VIEWER_POPUP_WIDTH = "w-[min(96vw,1400px)]";
const VIEWER_BODY_HEIGHT = "h-[min(86vh,880px)]";

export type ImageViewerProps = {
  alt?: string;
  /** 弹窗标题；缺省回退到 `alt`，再回退到一句通用文案。 */
  label?: string;
  /** 关闭（Esc / 点遮罩 / 右上角 ✕ 都走它）。 */
  onClose: () => void;
  /** 要查看的图片地址；`null` 时组件不渲染（调用处据此表达「关着」）。 */
  src: string | null;
};

/**
 * 受控的图片查看器。渲染时 `src` 必须有值 —— 需要「关着」的调用处传 `null`。
 */
export function ImageViewer({ src, alt = "", label, onClose }: ImageViewerProps) {
  /* 已解码图片的尺寸与它对应的地址：地址换了旧尺寸立刻失效（否则新图会先按
   * 上一张的尺寸渲染一帧，尺寸差得远时肉眼可见地跳一下）。 */
  const [loaded, setLoaded] = useState<{
    size: NaturalSize;
    src: string;
  } | null>(null);
  const natural = loaded?.src === src ? loaded.size : null;

  /* 画布（滚动容器）既用来量可视区，也用来改滚动偏移，两者必须指向同一个元素。元素存 `ref`
   * 而不是 `state`（往下要写它的 `scrollLeft` / `scrollTop`）；「元素挂上没有」由 `useElementBox`
   * 的读数派生（`box !== null`），effect 依赖是元素本身而不是「弹窗开了没有」（规范 16 §16.2.4.12）。 */
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

  /* 可视区尺寸取矩形（`box.width` / `box.height`）而不是 `clientWidth` / `clientHeight`：后者不含
   * 滚动条，会与「适应窗口」构成正反馈环（算尺寸 → 溢出 → 出现滚动条 → 视口变小 → …抖动）。
   * 矩形是布局尺寸，滚动条出现与否都不改它，适应尺寸因此收敛到「无滚动条」的不动点。 */
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
    left: number;
    scale: number;
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
    if (!el || naturalWidth === null || naturalHeight === null) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = scaleRef.current;
      const next = clampNext(current, event.deltaY < 0);
      if (next === current) {
        return;
      }
      const rect = readElementBox(el);
      if (!rect) {
        return;
      }
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
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [scrollerReady, naturalWidth, naturalHeight]);

  useEffect(() => {
    const el = scrollerRef.current;
    const pending = pendingScrollRef.current;
    if (!el || pending?.scale !== zoom.scale) {
      return;
    }
    pendingScrollRef.current = null;
    el.scrollLeft = pending.left;
    el.scrollTop = pending.top;
  }, [scrollerReady, zoom.scale]);

  /* 拖拽平移：拖动期间只改内层 transform，松手才落到滚动偏移。逐帧写 `scrollLeft` / `scrollTop`
   * 是主线程滚动（每帧重新布局 + 绘制，大图 120Hz 下卡顿）；拖拽实质只是把已画好的内容挪位置，
   * 交给合成器即可。松手一次性写回，滚动条仍如实反映位置；指针捕获保证移出容器后仍收到事件。 */
  const innerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    dx: number;
    dy: number;
    pointerId: number;
    scrollLeft: number;
    scrollTop: number;
    startX: number;
    startY: number;
  } | null>(null);
  /* 本帧是否已排过一次写入（同一帧内的多个 pointermove 合并成一次）。 */
  const panFrameRef = useRef<CancelNextFrame | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (event.button !== 0 || !el) {
      return;
    }
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
    if (innerRef.current) {
      innerRef.current.style.willChange = "transform";
    }
    if (typeof el.setPointerCapture === "function") {
      el.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    drag.dx = event.clientX - drag.startX;
    drag.dy = event.clientY - drag.startY;
    if (panFrameRef.current) {
      return;
    }
    panFrameRef.current = onNextFrame(() => {
      panFrameRef.current = null;
      const inner = innerRef.current;
      const current = dragRef.current;
      if (!inner || !current) {
        return;
      }
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

  if (!src) {
    return null;
  }

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
    zoom.mode === "fit" ? "适应窗口" : zoom.mode === "actual" ? "原始大小" : "自定义缩放";

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open
    >
      <DialogContent
        className="bg-transparent p-0 ring-0"
        data-slot="image-viewer"
        popupClassName={VIEWER_POPUP_WIDTH}
        showCloseButton={false}
      >
        <div
          className={`border-border bg-panel flex flex-col overflow-hidden rounded-2xl border ${VIEWER_BODY_HEIGHT}`}
        >
          <div className="border-border-subtle flex h-11 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <ZoomIn aria-hidden="true" className="text-ink-muted shrink-0" size={15} />
              <DialogTitle className="text-ink min-w-0 truncate text-sm font-semibold">
                {title}
              </DialogTitle>
              {naturalWidth !== null && naturalHeight !== null && (
                <span className="text-ink-fainter text-2xs shrink-0 tabular-nums">
                  {naturalWidth} × {naturalHeight}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-label="缩小"
                className="text-ink-muted hover:text-ink rounded-md"
                onClick={zoom.zoomOut}
                size="icon-sm"
                title="缩小"
                variant="ghost"
              >
                <Minus data-icon="inline-start" size={14} />
              </Button>
              <span
                className="text-ink-muted text-2xs w-12 text-center tabular-nums"
                data-testid="image-viewer-percent"
              >
                {zoom.percent}%
              </span>
              <Button
                aria-label="放大"
                className="text-ink-muted hover:text-ink rounded-md"
                onClick={zoom.zoomIn}
                size="icon-sm"
                title="放大"
                variant="ghost"
              >
                <Plus data-icon="inline-start" size={14} />
              </Button>
              {/* 缩放档位「一排里选一个」走 SelectChip（规范 16 §16.2.4.75）。旧形态手搓三元 + `bg-surface-2`，且没钉字色悬停，`ghost` 的 `hover:text-foreground` 会把已选中那枚字色翻回未选中档。
                  注意 `zoom.mode` 还有第三种 `manual`（滚轮 / ± 按钮缩出来的自由倍数）—— 那时两枚都不选中，正是单选组「可以都不选」的合法状态（双击画布会收回前两档）。 */}
              <div aria-label="缩放档位" className="flex items-center gap-0.5" role="radiogroup">
                <SelectChip
                  className="gap-1 px-2 py-1"
                  onClick={zoom.fit}
                  selected={zoom.mode === "fit"}
                  shape="compact"
                >
                  适应窗口
                </SelectChip>
                <SelectChip
                  className="gap-1 px-2 py-1"
                  onClick={zoom.actualSize}
                  selected={zoom.mode === "actual"}
                  shape="compact"
                >
                  <Maximize2 data-icon="inline-start" size={11} />
                  原始大小
                </SelectChip>
              </div>
              <Button
                aria-label="关闭"
                className="text-ink-muted hover:text-ink rounded-md"
                onClick={onClose}
                size="icon-sm"
                title="关闭"
                variant="ghost"
              >
                <X data-icon="inline-start" size={15} />
              </Button>
            </div>
          </div>

          {/* 画布：双击切换适应窗口 / 原始大小；滚轮与拖拽见上方 handler。 */}
          <div
            className="bg-canvas-deep relative min-h-0 flex-1 cursor-grab touch-none overflow-auto overscroll-contain active:cursor-grabbing"
            data-testid="image-viewer-canvas"
            onDoubleClick={zoom.toggleFitActual}
            onPointerCancel={handlePointerUp}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            ref={setScroller}
          >
            {/* 内层用 `w-max min-w-full h-max min-h-full` + 居中：图比可视区小时
                居中显示，比可视区大时内层恰好等于图宽/高，`justify-center` 不再
                产生偏移（经典 flex 居中会裁掉溢出内容的左/上边缘）。 */}
            <div
              className="flex h-max min-h-full w-max min-w-full items-center justify-center"
              data-testid="image-viewer-content"
              ref={innerRef}
              style={{ padding: VIEWPORT_PADDING }}
            >
              <MediaThumbnail
                alt={alt}
                className={mediaClass}
                draggable={false}
                fallback={<span className="text-ink-fainter text-xs">图片不可用</span>}
                onLoad={(media) => {
                  const size = readNaturalSize(media);
                  if (size) {
                    setLoaded({ src, size });
                  }
                }}
                src={src}
                style={mediaStyle}
              />
            </div>
          </div>

          <div className="border-border-subtle text-ink-fainter text-2xs flex h-8 shrink-0 items-center justify-between gap-3 border-t px-4">
            <span className="truncate">滚轮缩放 · 按住拖拽平移 · 双击切换适应窗口 / 原始大小</span>
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
 * 取第一个「真的给了」的文案：空串与只有空白都算没给。`label ?? alt` 会让 `label=""` 挡住 `alt`，
 * 而 `label || alt` 会被 lint 判为该用 `??` —— 两者的差别恰是要表达的语义，故显式筛选。
 */
function firstText(...values: Array<string | undefined>): string | null {
  return values.find((value) => (value ?? "").trim() !== "") ?? null;
}

export type ViewableImageProps = {
  alt?: string;
  /** 缩略图自身的 class（与 `MediaThumbnail` 同义）。 */
  className?: string;
  /** 加载失败兜底（透传 `MediaThumbnail`）。 */
  fallback?: MediaFallback;
  /** 查看器标题；缺省用 `alt`。 */
  label?: string;
  src?: string | null;
  /** 缩略图上的提示文案（鼠标悬停）。 */
  title?: string;
};

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
  if (!src) {
    return null;
  }
  const name = firstText(label, alt);
  return (
    <>
      <Button
        aria-label={name ? `查看大图：${name}` : "查看大图"}
        /* `h-full` 而不是 `h-auto`：调用处常在**有确定高度**的盒子里塞它
           （`aspect-square` 网格、定高缩略图位），缩略图的 `h-full` 要有参照
           才撑得满；父级高度是 auto 时 `h-full` 计算为 auto，行为不变。 */
        className="h-full w-full cursor-zoom-in rounded-xl p-0 hover:bg-transparent"
        onClick={() => {
          setOpen(true);
        }}
        title={title}
        variant="ghost"
      >
        <MediaThumbnail alt={alt} className={className} fallback={fallback} src={src} />
      </Button>
      {open && (
        <ImageViewer
          alt={alt}
          label={name ?? undefined}
          onClose={() => {
            setOpen(false);
          }}
          src={src}
        />
      )}
    </>
  );
}
