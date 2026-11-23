"use client";

/* ── 懒加载视图的统一出口 + 全部声明（ISSUE #1900 / #4765）────────────────
 * 所有 `next/dynamic` 都经这里的 `lazyView` 工厂：「分块加载失败」有唯一的自愈点
 *（`~/lib/shell/lazy-chunk-recovery`），loader 也统一登记进空闲预热
 *（`./lazy-view-prefetch`）—— 漏一份裸 `dynamic(...)` 那一屏就绕过自愈整屏崩，
 * 且正常构建下完全看不出（12 屏坏 1 屏、仅 dev 重建后偶发）。
 * 刷新的那一跳返回永不 settle 的 promise：页面正在被换掉，让它悬着比立刻抛错
 * 更好（抛了会先闪 error boundary 再被导航覆盖）；没触发刷新时照常抛，错误照旧
 * 落到 error boundary。
 * 顺带在出口上包 `withViewOpenReport`：分块解析后把内容包住，「界面打开耗时」
 * 的测量点正好落在内容真正挂载那一刻。
 * 声明集中在本文件（原在 WorkspaceViewStack 内联）：项目页改成「一项目一页签、
 * 页内左侧列表切换」之后，画布 / 工坊 / 成片 / 产出等重组件由项目页容器按分区
 * 懒加载 —— 两处各写一遍就会各漂各的（§12.12）。
 */

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

import { reloadOnceForChunkError } from "~/lib/shell/lazy-chunk-recovery";

import { withViewOpenReport } from "./ViewOpenReport";
import { registerLazyViewLoader } from "./lazy-view-prefetch";
import type { WorkspaceView } from "./NavItems";

/** 已登记的懒加载视图 —— WorkspaceViewStack 靠它免掉外层重复包一层打开计时。 */
const LAZY_VIEWS = new Set<WorkspaceView>();

/** 某个视图是否由本工厂懒加载（视图栈据此决定要不要再包一层打开计时）。 */
export function isLazyView(view: WorkspaceView): boolean {
  return LAZY_VIEWS.has(view);
}

/** 一个永不 settle 的 promise（见文件头「刷新的那一跳」）。 */
const NEVER_SETTLES = new Promise<never>(() => {
  /* 故意不给 resolve / reject：页面正在被换掉，这个 promise 不该有任何结算。 */
});

function lazyView<P extends object>(
  view: WorkspaceView,
  loader: () => Promise<ComponentType<P>>,
): ComponentType<P> {
  LAZY_VIEWS.add(view);
  /* 同一份 loader 再登记一份给空闲预热：动态 import 从此不必等用户点开那一屏
   * 才发出（按需编译 / 现拉分块的代价从「点击之后」挪到「挂载之后的空闲里」，
   * 见 ./lazy-view-prefetch）。 */
  registerLazyViewLoader(loader);
  return dynamic(
    () =>
      loader()
        .then((mod) => withViewOpenReport(view, mod))
        .catch((error: unknown) => {
          if (reloadOnceForChunkError(error)) {
            return NEVER_SETTLES;
          }
          throw error;
        }),
    { ssr: false },
  );
}

/* ── 全局配置/观测视图（与项目无关） ── */
/* 设置：只在进入该视图时才拉 —— 它带着全部配置查询与 Ollama 探测，不该摊到别的视图首屏。 */
export const SettingsView = lazyView("settings", () =>
  import("~/components/settings/SettingsView").then((m) => m.SettingsView),
);

/* 模型适配 / 测试模型 / 模式契约：与设置同一族（项目无关的全局配置视图）。 */
export const ModelAdaptersView = lazyView("model-adapters", () =>
  import("~/components/workshop/ModelAdaptersView").then((mod) => mod.ModelAdaptersView),
);
export const ModelTestView = lazyView("model-test", () =>
  import("~/components/workshop/ModelTestView").then((mod) => mod.ModelTestView),
);
export const ModeContractView = lazyView("mode-contract", () =>
  import("~/components/workshop/mode-contract/ModeContractView").then(
    (mod) => mod.ModeContractView,
  ),
);

/* UI 控件总览（ISSUE #3525/#3726）：开发者的基元对照页。 */
export const UIKitGalleryView = lazyView("uiKit", () =>
  import("~/components/ui/ui-kit-gallery").then((mod) => mod.UIKitGallery),
);

/* 队列与运行 / ComfyUI 运行页 / 控制台：与历史同族（「项目无关的全局视图」）。 */
export const QueueMonitor = lazyView("queue", () =>
  import("~/components/studio/queue/QueueMonitor").then((mod) => mod.QueueMonitor),
);
export const ComfyuiControl = lazyView("comfyui", () =>
  import("~/components/studio/comfyui/ComfyuiControl").then((mod) => mod.ComfyuiControl),
);
export const ConsoleView = lazyView("console", () =>
  import("~/components/console/ConsoleView").then((m) => m.ConsoleView),
);

/* 资产库（ISSUE #4868）：公共 / 项目资产 + 分类 + 完整生成参数，与历史同族的全局视图。 */
export const AssetLibraryView = lazyView("assets", () =>
  import("~/components/studio/assets/AssetLibrary").then((mod) => mod.AssetLibrary),
);

/* ── 项目内分区（一项目一页签后由项目页容器按需拉起） ── */

/* 资源库：整页素材管理（分类 / 搜索 / 上传 / 删除），与画布那块抽屉同源取数。 */
export const ResourceLibrary = lazyView("library", () =>
  import("~/components/studio/library/ResourceLibrary").then((mod) => mod.ResourceLibrary),
);

/* 客户端上懒加载更重的画布 / 影片编辑器（ReactFlow 等）。 */
export const FilmStudio = lazyView("film", () =>
  import("~/components/studio/FilmStudio").then((mod) => mod.FilmStudio),
);
export const ProjectCanvas = lazyView("canvas", () =>
  import("~/components/studio/ProjectCanvas").then((mod) => mod.ProjectCanvas),
);

/* 产出：项目生成了什么（图片 / 视频 / 成片清单）。 */
export const ProjectOutputs = lazyView("outputs", () =>
  import("~/components/studio/ProjectOutputs").then((mod) => mod.ProjectOutputs),
);

/* 工坊管线：六阶段（剧本→角色卡→分镜→镜头生图→视频→成片合成）的容器。
 * 项目页里按左侧列表的工坊分区懒加载；独立路由 /workshop 仍静态引它。 */
export const WorkshopPipeline = lazyView("workshop", () =>
  import("~/components/workshop/WorkshopPipeline").then((mod) => mod.WorkshopPipeline),
);
