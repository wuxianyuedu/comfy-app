"use client";

/**
 * 「数据存放位置」分区（ISSUE #3625）。
 *
 * 这一节回答的是设置页此前答不了的那个问题：「我的数据到底存在哪儿」。
 * 每一类数据一枚徽标（图标 = 存放位置类别），旁边是具体落点与迁移办法 ——
 * 迁移操作时照着这一行做即可，不必去翻源码。
 *
 * 分区正文由 `~/components/data-location/data-location-overview` 铺；那件与各处
 * 单点徽标共用同一份登记本体（`~/lib/data-location/data-locations`），
 * 所以总表与界面上的徽标不可能各说各话。
 */

import { SettingsCard } from "~/components/ui/settings-card";
import { DataLocationOverview } from "~/components/data-location/DataLocationOverview";

export function DataLocationSection() {
  return (
    <SettingsCard>
      {/* 说明段不进卡片头（ISSUE #3779）：description 槽渲染在带分隔线的标题行里，
          没有标题的卡片上它就是一行假标题 —— 降为正文首段。 */}
      <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
        每一类数据存在哪儿、迁移时怎么搬；徽标上的图标就是它的存放位置类别。
      </p>
      <DataLocationOverview />
    </SettingsCard>
  );
}
