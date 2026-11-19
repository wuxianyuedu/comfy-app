/**
 * schema 表定义共用的列构造器（`dateNotNull` / `cuid`）。独立成零依赖叶子：schema.ts 经 `export * from
 * "./schema-series"` 再导出拆分件，ESM import 提升使 schema-series 先求值，而它初始化期就要**调用**这两个
 * 构造器 —— 从 schema.ts 拿会撞上未初始化绑定。`user` 表则在 `() => user.id` 惰性回调里才触碰，可留在 schema.ts。
 */

import { customType, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";

export const dateNotNull = customType<{ data: Date; driverData: string }>({
  dataType() {
    return "text";
  },
  fromDriver: (v) => new Date(v),
  toDriver: (v) => v.toISOString(),
});

export const cuid = () =>
  text("id")
    .$defaultFn(() => createId())
    .primaryKey();

/**
 * Better Auth 的 `user` 表（单数名，对齐 better-auth 默认命名）也住这份叶子：schema.ts 与
 * schema-series.ts 都要在 FK 回调里引用它（`() => user.id`），而 schema.ts 经 `export *`
 * 先加载拆分件 —— 只有零依赖叶子能让依赖图保持单向（§12.7 禁环；schema.ts 原样再导出）。
 */
export const user = sqliteTable("user", {
  id: cuid(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  password: text("password"),
  createdAt: dateNotNull("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: dateNotNull("updatedAt")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});
