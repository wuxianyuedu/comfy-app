/**
 * schema 表定义共用的列构造器（`dateNotNull` / `cuid`）。
 *
 * 独立成叶子模块的原因：schema.ts 通过 `export * from "./schema-series"` 再导出
 * 拆分件，ESM import 提升使 schema-series 先于 schema.ts 的模块体求值 —— 而它
 * 在初始化期就要**调用**这两个构造器；若从 schema.ts 拿，会撞上「模块体还没跑到
 * 定义」的未初始化绑定。放进这份零依赖的叶子模块，两边都安全。`user` 表的引用
 * 则不同：它在 `() => user.id` 惰性回调里才被触碰，留在 schema.ts 没有问题。
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
 * Better Auth 的 `user` 表（表名单数，对齐 better-auth 的默认命名）也放在这份叶子：
 * schema.ts 与 schema-series.ts 都要在 FK 回调里引用它（`() => user.id`），而
 * schema.ts 经 `export *` 先加载拆分件 —— `user` 只有住在零依赖叶子，依赖图才能
 * 保持单向（§12.7 禁环；schema.ts 原样再导出，既有导入方无损）。
 */
export const user = sqliteTable("user", {
  createdAt: dateNotNull("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  id: cuid(),
  image: text("image"),
  name: text("name"),
  password: text("password"),
  updatedAt: dateNotNull("updatedAt")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});
