"use client";

import React from "react";
import { type OmitOwnProps, splitDomProps } from "~/lib/dom-props";
import { isVideo } from "~/lib/media/media";

/**
 * 「渲染一张可能加载失败的图 / 视频」的唯一出口。收口前全库 18 个文件裸 `<img>`，失败侧四种写法（改 DOM 留下空洞 / 自写 `useState(failed)` / 无兜底直接画破图图标）。
 * 判据（§16.2.4.21）是「渲染媒体只允许一处实现」：形态由本模块给，失败兜底由 `fallback` 决定；`loading="lazy"` / `decoding="async"` 不再是调用处的自由项（18 处里只有 2 个写 `lazy`，多数漏）。
 */

/** 加载失败时渲染什么。 */
export type MediaFallback =
  /** 中性占位（默认）：图标 + 「图片不可用」，填满调用处的盒子。 */
  | "placeholder"
  /** 什么都不渲染（`null`）—— 用于「宁缺勿错」的列表格位。 */
  | "none"
  /** 自定义节点（调用处要自己的文案 / 盒子）。 */
  | React.ReactElement;

/** 本基元的私有字段（自己接管，不透传给底层 `<img>` / `<video>`），类型与运行时共用这一份表
 *  （`~/lib/dom-props`）。⚠️ 字段是两个底层元素的并集，剔的必须是两个底层共同接管的那些 ——
 *  写成 `[...A, ...B]` 的并集会把只属于一个底层的字段也剔掉，且没有报错；此处两个底层同名，直接列全。*/
/* SAFETY: 类型断言已复核 */
const OWN_PROPS = [
  "src",
  "alt",
  "className",
  "autoPlay",
  "muted",
  "loop",
  "onLoad",
  "onLoadError",
  "fallback",
  "as",
  "onError",
  "loading",
  "decoding",
] as const;

/** 额外透传给底层 `<img>` / `<video>` 的属性（`onClick` / `title` 等）。 */
export type MediaThumbnailProps = {
  alt?: string;
  /**
   * 强制按图片 / 视频渲染，覆盖按 `src` 后缀的推断。因为「这张媒体是什么」有两个来源：路径后缀
   * 与调用处已有的语义判断（如 `ResultCard` 的 `mediaType`，ComfyUI 某些节点把视频帧存成 `.png`）。
   * 出口自己判后缀，但不推翻调用处已经知道的答案。
   */
  as?: "image" | "video";
  autoPlay?: boolean;
  className?: string;
  /** 失败兜底形态，见 `MediaFallback`。默认 `"placeholder"`。 */
  fallback?: MediaFallback;
  loop?: boolean;
  muted?: boolean;
  /** 加载成功时回调，拿到底层媒体元素。要自然尺寸 / 宽高比的调用处别自己读 `naturalWidth` / `videoWidth`：
   *  口径收在 `~/lib/media/natural-size` 的 `readNaturalSize` / `naturalAspectRatio` / `isPortraitMedia`
   *  （规范 16 §16.2.4.31）—— 两组读数、0 值三态、`×` 的写法只有一处定义。 */
  onLoad?: (media: HTMLImageElement | HTMLVideoElement) => void;
  /** 加载失败时回调（如上报 / 记日志）；兜底渲染由 `fallback` 决定。 */
  onLoadError?: (src: string) => void;
  src?: string | null;
} & OmitOwnProps<
  React.ImgHTMLAttributes<HTMLImageElement> & React.VideoHTMLAttributes<HTMLVideoElement>,
  (typeof OWN_PROPS)[number]
>;

/**
 * 中性失败占位：与调用处的盒子同尺寸（`h-full w-full` + 继承圆角），
 * 所以失败时**不会出现空洞、也不会跳布局** —— 这正是 `display: none`
 * 那两处做不到的（它们把格子抽走了）。
 */
function FailurePlaceholder({ className }: { className?: string }) {
  return (
    <span
      aria-label="图片不可用"
      className={`text-ink-fainter bg-canvas-deep text-3xs flex items-center justify-center ${className ?? ""}`}
      role="img"
    >
      图片不可用
    </span>
  );
}

/**
 * 渲染媒体缩略图：视频就地播放，图片直接显示，失败走 `fallback`。常见用法是
 * `<MediaThumbnail src={item.url} alt={item.name} className="h-full w-full object-cover" />`；
 * 列表里失败宁缺勿错时传 `fallback="none"`。
 */
export const MediaThumbnail = React.memo(function MediaThumbnail(props: MediaThumbnailProps) {
  /* 私有字段与要透传的字段**从同一份表**分开（`OWN_PROPS`）—— 类型侧的
   * `OmitOwnProps` 与这里的 `splitDomProps` 读的是同一个数组。 */
  const { own, rest: mediaProps } = splitDomProps(props, OWN_PROPS);
  const {
    src,
    alt = "",
    className = "",
    autoPlay = false,
    muted = true,
    loop = false,
    onLoad,
    onLoadError,
    fallback = "placeholder",
    as,
  } = own;
  /* 失败态收在这里 —— 这是唯一一处「渲染一张图」的状态机，调用处不必再各写一份 `useState(failed)`。
   * 存的是哪一个 `src` 失败而非布尔量：`src` 变了要重新给机会（复用实例时上一张的失败不该传染），
   * 记下失败 url、渲染时比对是派生，不需要 effect 里再 `setState`（规范 08：同步 setState 会级联渲染）。 */
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === src;

  if (src === undefined || src === null || src === "") {
    return null;
  }
  if (failed) {
    if (fallback === "none") {
      return null;
    }
    if (fallback === "placeholder") {
      return <FailurePlaceholder className={className} />;
    }
    return <>{fallback}</>;
  }

  const handleError = () => {
    setFailedSrc(src);
    onLoadError?.(src);
  };

  if (as === "video" || (as !== "image" && isVideo(src))) {
    return (
      /* `aria-label`：`<video>` 没有 `alt`，可访问名只能走 `aria-label`，不转写就等于没有可访问名。
       * ⚠️ `jsx-a11y/media-has-caption` 要求 `<track>`，本基元刻意不给：它承载缩略图 / 预览（`muted`、
       * 几百像素），ComfyUI 产出的 mp4 本就无音轨，空 `<track>` 只会让读屏器读到假字幕轨（§6.9 口径是
       * 「控件可用」）。真要放带音频视频时，字幕由调用处另给 `<track>`。 */
      /* eslint-disable-next-line jsx-a11y/media-has-caption -- 静音预览媒体，无音轨可配字幕（空 <track> 反而给读屏器一条假字幕轨） */
      <video
        aria-label={alt}
        autoPlay={autoPlay}
        className={className}
        loop={loop}
        muted={muted}
        onError={handleError}
        onLoadedData={(event) => onLoad?.(event.currentTarget)}
        playsInline
        preload="metadata"
        src={src}
        {...mediaProps}
      />
    );
  }

  return (
    <img
      /* 纯装饰缩略图（`alt` 没给）时给 `alt=""` + `aria-hidden`：读屏器跳过它，
       * 与「这张图不携带信息」一致；给了 `alt` 的按正常可访问名走（规范 §6.9）。 */
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      className={className}
      decoding="async"
      loading="lazy"
      onError={handleError}
      onLoad={(event) => onLoad?.(event.currentTarget)}
      src={src}
      {...mediaProps}
    />
  );
});
