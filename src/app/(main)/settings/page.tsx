"use client";

/**
 * 独立路由 `/settings` —— 只是「设置」界面的一个挂载点：三态（首帧 loading / 失败降级 / 就绪）、外壳与分区导航
 * 都在 `~/components/settings/SettingsView`（与页签「设置」共用同一份实现），这里只负责「不经过应用外壳时」的视口高度。
 * 留着这条路由是因为地址栏直达与外部链接要有个落点，且它不依赖 workspace 页签状态；应用内入口现已都走页签。
 */

import { SettingsView } from "~/components/settings/SettingsView";

export default function SettingsPage() {
  return <SettingsView />;
}
