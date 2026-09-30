"use client";

// ── 资源库（项目页签）：逻辑层（规范 17 §17.2 第②层）─────────────────────────
// 页面级容器只做「取 controller → 传视图」，本文件负责：
//   ① 跟随 canvas-store 的活跃项目（服务端读不到，SSR 首帧为 null）；
//   ② 复用画布素材库的 `useMaterialLibrary`（同一份取数 / 上传 / 删除语义），
//      不重造第二套网络层（§12.18 复用优先）；
//   ③ 提供「一个分类下的素材」这一页签特有的派生（分类计数汇总）。

import { useCallback, useEffect, useState } from "react";

import { subscribeAppEvent } from "~/lib/app-events";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import {
  useMaterialLibrary,
  type MaterialLibraryController,
  type MaterialScope,
} from "~/components/studio/project-canvas/hooks/use-material-library";

export interface ResourceLibraryController {
  /** 素材库控制器（分类 / 条目 / 搜索 / 上传 / 删除，与画布那份同源）。 */
  library: MaterialLibraryController;
  /** 当前活跃项目 id；null = 还没有项目（页面据此给引导）。 */
  projectId: string | null;
  /** 所有分类的素材总数（各分类 count 之和）。 */
  totalCount: number;
  /** 切「本项目 / 跨项目」。 */
  setScope: (scope: MaterialScope) => void;
}

/**
 * 活跃项目 id 跟随 canvas-store。
 *
 * 为什么不放进 `useMaterialLibrary`：素材库面板由画布传入 projectId（它自己
 * 就在项目里），而资源库是个独立页签 —— 它得自己订阅 store。订阅方式与
 * `ProjectOutputs` / `workspace/page.tsx` 同一约定（`canvas-store-changed` 事件）。
 */
function useActiveProjectId(): string | null {
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    // 首帧后同步一次：getActiveId 读 localStorage，SSR 阶段拿不到。
    // （setState 发生在 `sync` 里而不是 effect 体直接调用，规范 08 §8.6
    //   那条 lint 不会触发，因此这里不需要 disable 指令。）
    const sync = () => setProjectId(getActiveId());
    sync();
    return subscribeAppEvent("comfyapp:canvas-store-changed", sync);
  }, []);
  return projectId;
}

export function useResourceLibrary(): ResourceLibraryController {
  const projectId = useActiveProjectId();
  const library = useMaterialLibrary({ projectId });

  /* 「跨项目」聚合没有活跃项目也成立（它就是所有项目 + 共享的合集），
   * 所以只在「本项目」档下把项目缺失当成前置未满足 —— 判据交给视图。 */
  const setScope = useCallback(
    (scope: MaterialScope) => library.setScope(scope),
    [library],
  );

  const totalCount = library.folders.reduce(
    (sum, folder) => sum + folder.count,
    0,
  );

  return { library, projectId, totalCount, setScope };
}
