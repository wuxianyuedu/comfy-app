/**
 * 生图暂停控制（ISSUE #5055）：**单行表**（`id` 固定 `'singleton'`）。
 *
 * 暂停期间执行器的领取循环不再领取**生图类**排队任务（当前在跑的那条照常
 * 跑完收尾），恢复后按队列序继续；视频 / 音频任务不受影响。状态落库 ⇒
 * 应用重启后仍保持，直到显式恢复。
 */
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { dateNotNull, dateNull } from "./schema-common";

/** 单行表的固定主键值（读写两侧都用它定位唯一一行）。 */
export const GENERATION_CONTROL_ID = "singleton";

export const generationControl = sqliteTable("generationControl", {
  id: text("id").primaryKey(),
  /** true = 暂停中：不领取新的生图任务。 */
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  /** 最近一次暂停的时刻；null = 未暂停。 */
  pausedAt: dateNull("pausedAt"),
  updatedAt: dateNotNull("updatedAt").$defaultFn(() => new Date()),
});
