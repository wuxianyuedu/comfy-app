"use client";

/**
 * 「数据存放位置」总表 —— 把登记本体按数据种类分组铺开，每一行说清三件事：
 * 这一类数据叫什么、存在哪（那枚带图标的徽标 + 具体落点）、迁移时怎么搬
 * （ISSUE #3625）。
 *
 * 徽标与各处的单点徽标是**同一件东西**（`DataLocationBadge`）—— 总表不另画一套图标，
 * 否则「总表说数据库、界面说本机文件」这种事迟早发生。
 *
 * 落点那一句按等宽字体渲染（它是路径 / 表名这类标识符），迁移那一句是散文 ——
 * 两档字不混：前者是「东西在哪」，后者是「怎么操作」。
 */

import { SETTINGS_ROW_CLASS } from "~/components/ui/settings-card";
import { listDataLocationGroups } from "~/lib/data-location/data-locations";

import { DataLocationBadge } from "./DataLocationBadge";

export function DataLocationOverview() {
  const groups = listDataLocationGroups();
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.kind}>
          <h4 className="text-ink text-sm font-semibold">{group.kindLabel}</h4>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {group.locations.map((location) => (
              <div className={`${SETTINGS_ROW_CLASS} flex flex-col gap-1.5`} key={location.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <DataLocationBadge id={location.id} />
                  <code className="text-ink/80 font-mono text-xs">{location.entry.target}</code>
                </div>
                <p className="text-muted-foreground text-2xs leading-relaxed">
                  迁移：{location.entry.migration}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
