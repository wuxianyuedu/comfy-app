"use client";

/**
 * 独立路由 `/settings` —— 只是「设置」界面的一个挂载点：三态（首帧 loading / 失败降级 / 就绪）、外壳与分区导航
 * 都在 `~/components/settings/SettingsView`（与页签「设置」共用同一份实现），这里只负责「不经过应用外壳时」的视口高度。
 * 留着这条路由是因为地址栏直达与外部链接要有个落点，且它不依赖 workspace 页签状态；应用内入口现已都走页签。
 *
 * URL 直达分区（ISSUE #4163）：`/settings#settings-comfyui`（与分区节 DOM 锚点
 * 同形，见 SettingsShell 的 `sectionAnchorId`）直接停驻那个分区，与应用内跳转
 * 事件走同一条收敛路径（`sectionFromLocationHash` → `readInitialSection`）。
 * 截图 / 分享 / 收藏都可以直接指向某个分区，不再需要一次性脚本点击 + 滚动。
 * hash 只在客户端存在（SSR 没有无 location），所以走 `useSyncExternalStore`：
 * 服务端快照恒为 null（默认分区），客户端水合后按 hash 取值 —— 不经 effect
 * setState，也就绕开了 `react/set-state-in-effect` 那条禁令与水合错位。
 */

import { useSyncExternalStore } from "react";

import { sectionFromLocationHash } from "~/app/(main)/settings/hooks/use-settings-page";
import { SettingsView } from "~/components/settings/SettingsView";

/** hash 不订阅变化（直达语义只看进入那一刻）；返回值是稳定原语，不会引发重渲染。 */
function subscribeToNothing(): () => void {
  return () => undefined;
}

export default function SettingsPage() {
  const initialSection = useSyncExternalStore(
    subscribeToNothing,
    () => sectionFromLocationHash(window.location.hash),
    () => null,
  );
  return <SettingsView initialSection={initialSection} />;
}
