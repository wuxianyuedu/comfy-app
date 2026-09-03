/**
 * Compatibility shim: 原 Comfy-APP 通过 `@/lib/db` 取数据访问实例。
 * 现统一导出 Drizzle 实例 `db`（原 `prisma` 别名已移除，调用方改 import { db }）。
 */
import "server-only";

export { db } from "~/server/db";
