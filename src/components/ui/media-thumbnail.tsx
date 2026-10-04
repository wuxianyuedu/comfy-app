"use client";

import React from "react";
import { type OmitOwnProps, splitDomProps } from "~/lib/dom-props";
import { isVideo } from "~/lib/media/media";

/**
 * 「渲染一张可能加载失败的图 / 视频」的唯一出口。
 *
 * 此前这件事散在全库 **18 个文件**的裸 `<img>` 里，而**加载失败这一侧**
 * 有四种写法、四种后果：
 *
 *  - `HomePage` 项目缩略图：`event.target.style.display = "none"` —— 直接改
 *    DOM，绕过 React；失败的那一格留下**空洞**（`gap` 还在，缩略图条少一块）；
 *  - 已删的训练工作室数据集缩略图：`style.visibility = "hidden"` —— 同上，
 *    只是换了个属性名；
 *  - `WorkflowImagePreview`：自己 `useState(failed)` + 「图片不可用」方块 ——
 *    写法是对的，但这段状态机在**每个**需要兜底的落点各写一遍；
 *  - `SettingsPrimitives.FieldImagePreview`：同上，只是文案更长。
 *
 * 而**另外 14 个文件压根没有兜底** —— `<img>` 加载失败就交给浏览器画破图图标
 * （Chrome 的碎图片 + `alt` 文本），在深色面板上尤其难看。这不是「样式问题」，
 * 是**同一件事（渲染一张图）在不同落点给出不同行为**：能不能看到「这张图没有
 * 了」取决于它是从哪个面板渲染出来的，而且没有报错、没有告警。
 *
 * 判据（§16.2.4.21）因此是「**渲染媒体这件事只允许一处实现**」：
 *  - 形态（`<img>` / `<video>` 的选择、`loading` / `decoding`）由本模块给；
 *  - 失败兜底由 `fallback` 决定形态（默认一个中性的「图片不可用」占位）；
 *  - **`loading="lazy"` / `decoding="async"` 不再是调用处的自由项** ——
 *    收口前 18 个 `<img>` 里只有 2 个写了 `lazy`、1 个写了 `decoding`，
 *    这种「多数漏、少数写」的项收在出口里才不会继续分叉。
 */

/** 加载失败时渲染什么。 */
export type MediaFallback =
  /** 中性占位（默认）：图标 + 「图片不可用」，填满调用处的盒子。 */
  | "placeholder"
  /** 什么都不渲染（`null`）—— 用于「宁缺勿错」的列表格位。 */
  | "none"
  /** 自定义节点（调用处要自己的文案 / 盒子）。 */
  | React.ReactElement;

/** 本基元的**私有字段**（自己接管，不透传给底层 `<img>` / `<video>`）——
 *  类型侧与运行时侧共用这一份表（`~/lib/dom-props`）。
 *
 *  ⚠️ 这里的字段是**两个底层元素的并集**：`className` / `src` 在 `img` 与
 *  `video` 上同名同义，`loading` / `decoding` 只有 `img` 有，`playsInline`
 *  之类只有 `video` 有。剔的必须是**两个底层共同接管的**那几个 ——
 *  用 `commonOwnProps` 求交集能一眼看出这条边界（写成 `[...A, ...B]` 的
 *  并集会把只属于一个底层的字段也剔掉，那个底层再也拿不到它该有的属性，
 *  且**没有报错**）。此处两个底层同名的字段就是下表，故直接列全。*/
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
export interface MediaThumbnailProps extends OmitOwnProps<
  React.ImgHTMLAttributes<HTMLImageElement> &
    React.VideoHTMLAttributes<HTMLVideoElement>,
  (typeof OWN_PROPS)[number]
> {
  src?: string | null;
  alt?: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  /** 加载成功时回调，拿到底层媒体元素。
   *
   *  要**自然尺寸 / 宽高比**的调用处别在这里自己读 `naturalWidth` / `videoWidth`
   *  —— 那些读数的口径收在 `~/lib/media/natural-size` 的 `readNaturalSize`
   *  / `naturalAspectRatio` / `isPortraitMedia`（规范 16 §16.2.4.31）：
   *  两组读数、0 值三态、`×` 的写法都只有一处定义。 */
  onLoad?: (media: HTMLImageElement | HTMLVideoElement) => void;
  /** 加载失败时回调（如上报 / 记日志）；兜底渲染由 `fallback` 决定。 */
  onLoadError?: (src: string) => void;
  /** 失败兜底形态，见 `MediaFallback`。默认 `"placeholder"`。 */
  fallback?: MediaFallback;
  /**
   * 强制按图片 / 视频渲染，覆盖按 `src` 后缀的推断。
   *
   * 需要它是因为「这张媒体是什么」有两个来源：**路径后缀**（多数情况）
   * 与**调用处已有的语义判断**（如 `ResultCard` 的 `mediaType` 字段 ——
   * ComfyUI 的某些节点把视频帧存成 `.png`）。出口自己判后缀，但**不推翻**
   * 调用处已经知道的答案。
   */
  as?: "image" | "video";
}

/**
 * 中性失败占位：与调用处的盒子同尺寸（`h-full w-full` + 继承圆角），
 * 所以失败时**不会出现空洞、也不会跳布局** —— 这正是 `display: none`
 * 那两处做不到的（它们把格子抽走了）。
 */
function FailurePlaceholder({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="图片不可用"
      className={`text-ink-fainter bg-canvas-deep text-3xs flex items-center justify-center ${className ?? ""}`}
    >
      图片不可用
    </span>
  );
}

/**
 * 渲染媒体缩略图：视频就地播放，图片直接显示，失败走 `fallback`。
 *
 * 最常见是「盒子里一张图，失败显示默认占位」：
 * `<MediaThumbnail src={item.url} alt={item.name} className="h-full w-full object-cover" />`；
 * 列表里失败就整格不渲染（宁缺勿错）时传 `fallback="none"`。
 */
export const MediaThumbnail = React.memo(function MediaThumbnail(
  props: MediaThumbnailProps,
) {
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
  /* 失败态收在这里 —— 这是**唯一**一处「渲染一张图」的状态机，
   * 所以调用处不必再各写一份 `useState(failed)`。
   *
   * 存的是**哪一个 `src` 失败了**而不是一个布尔量：`src` 变了要重新给一次
   * 机会（列表复用同一组件实例时，上一张图的失败不该传染给下一张），
   * 而「记下失败的那个 url、渲染时比对」是**派生**，不需要 effect 里再
   * `setState`（规范 08：effect 里的同步 setState 会引发级联渲染）。
   * 收口前各落点自己管 `src` 变化这一条，漏掉的就是「换图仍是破图」。 */
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === src;

  if (!src) return null;
  if (failed) {
    if (fallback === "none") return null;
    if (fallback === "placeholder")
      return <FailurePlaceholder className={className} />;
    return <>{fallback}</>;
  }

  const handleError = () => {
    setFailedSrc(src);
    onLoadError?.(src);
  };

  if (as === "video" || (as !== "image" && isVideo(src))) {
    return (
      <video
        src={src}
        className={className}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        playsInline
        preload="metadata"
        onLoadedData={(event) => onLoad?.(event.currentTarget)}
        onError={handleError}
        {...mediaProps}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onLoad={(event) => onLoad?.(event.currentTarget)}
      onError={handleError}
      {...mediaProps}
    />
  );
});
