/**
 * Compatibility shim: original Comfy-APP imported `prisma` from "@/lib/db".
 * T3 stack uses `db` from "~/server/db". Re-export as `prisma` so migrated
 * Repository layer keeps working without import rewrites.
 */
export { db as prisma } from "~/server/db";
