"use client";

/**
 * 「这份数据存在哪儿」的徽标 —— 一枚带图标的小徽章，落在**这类数据被配置的地方**
 * （ISSUE #3625）。
 *
 * 为什么是「按存放位置类别配图标」而不是「按数据种类配」：用户问的是「存在哪儿」。
 * 同一个落点上的数据（模型适配 / 远程模型 / 任务记录……）用的是同一枚图标，
 * 于是界面上那一片徽标扫一眼就知道「这几类都在库里」「那两类在磁盘上」。
 *
 * 徽标本身只说「哪一类位置」；**具体落在哪个文件 / 哪张表、迁移时怎么搬**在悬浮
 * 说明里 —— 那两句是迁移操作时唯一要照着做的东西，所以它们跟着徽标走，而不是
 * 散在别的文档里。
 *
 * ⚠️ 悬浮说明走 `ui/hint` 的 `<Hint>`（`Tooltip`），**不用原生 `title=`**：原生
 * tooltip 由浏览器画，样式与主题都不归设计 token 管（暗色下就是一块白底气泡、
 * 长文案单行铺开读着费劲，ISSUE #3672）—— 换成 Tooltip 后两态都跟随主题、
 * 长文案按 `max-w-xs` 折行，与顶栏那颗问号（`ui/header-help`）同一件东西。
 *
 * 口径全部来自 `~/lib/data-location/data-locations`（登记本体的**唯一出处**），
 * 本件不持有任何落点字面量 —— 改落点时不需要碰界面。
 */

import { Badge } from "~/components/ui/badge";
import { Hint } from "~/components/ui/hint";
import { Icon } from "~/components/ui/icon";
import {
  DATA_LOCATION_CATEGORIES,
  DATA_LOCATIONS,
  type DataLocationId,
} from "~/lib/data-location/data-locations";

/** 悬浮说明的拼装口径：落点与迁移办法各占一句，中间用「；」断开。 */
function badgeTitle(id: DataLocationId): string {
  const entry = DATA_LOCATIONS[id];
  const category = DATA_LOCATION_CATEGORIES[entry.category];
  return `${entry.kindLabel} · ${category.label}：${entry.target}；迁移：${entry.migration}`;
}

/**
 * 一枚「数据存放位置」徽标。
 *
 * `id` 指的是登记项（一种数据 × 它的某一个存放位置），不是数据种类 —— 一类数据
 * 落在两个地方时（例如模式契约的本机覆盖与项目默认）要挂两枚，各说各的落点。
 *
 * 徽标**只画图标与类别名**，不带「存放位置」引导字，旁边也不再有说明段（ISSUE
 * #3625 reopen 的口径：徽标放在标题处，说明一律走悬浮气泡，界面上不留关于
 * 存放在哪的额外描述）—— 落点与迁移办法都在上面的悬浮说明里。
 */
export function DataLocationBadge({ id }: { id: DataLocationId }) {
  const entry = DATA_LOCATIONS[id];
  const category = DATA_LOCATION_CATEGORIES[entry.category];
  return (
    <span className="inline-flex items-center">
      {/* `side="top"`：徽标坐在设置卡片正文里，气泡向上让出下方那两行说明；
          与顶栏问号（`side="bottom"`）分档的理由是锚点在屏幕里的位置，不是风格。 */}
      <Hint label={badgeTitle(id)} side="top">
        <Badge size="sm" tone={category.tone}>
          <Icon name={category.icon} />
          {category.label}
        </Badge>
      </Hint>
    </span>
  );
}
