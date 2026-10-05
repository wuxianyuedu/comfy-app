/**
 * `~/lib/db` 是数据访问实例的统一出口：转发 `~/server/db` 的 Drizzle `db`。
 * 调用方一律 `import { db } from "~/lib/db"`，不再有别名分支。
 */
import "server-only";

export { db } from "~/server/db";
