"use client";

/**
 * 独立路由 `/settings` —— 只是「设置」这个界面的**一个挂载点**。
 *
 * 三态（首帧 loading / 失败降级 / 就绪）、外壳与分区导航都在
 * `~/components/settings/SettingsView`，与页签「设置」共用**同一份实现**；
 * 这里只负责「不经过应用外壳时，视口高度由自己给」。
 *
 * 为什么还留着这条路由：地址栏直达与外部链接要有个落点，且它不依赖 workspace 的
 * 页签状态。应用内的入口（侧栏、顶栏菜单、队列的「去设置」、首页算力卡的
 * 「去设置」）现在都走页签，不再打开这一条。
 */

import { SettingsView } from "~/components/settings/SettingsView";

export default function SettingsPage() {
  return <SettingsView />;
}
