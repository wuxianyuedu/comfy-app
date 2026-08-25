import { env } from "~/env";
import { PrismaClient } from "../../generated/prisma";

// 开发模式下默认只打印 error / warn。
// 每条 SQL 都打印会让控制台被 `prisma:query` 刷屏（尤其是工作流库 /
// reaper 轮询），调试 SQL 时再设 PRISMA_LOG_QUERIES=1 开启。
const prismaLogLevels: ("query" | "error" | "warn")[] =
  process.env.PRISMA_LOG_QUERIES === "1"
    ? ["query", "error", "warn"]
    : env.NODE_ENV === "development"
      ? ["error", "warn"]
      : ["error"];

const createPrismaClient = () => new PrismaClient({ log: prismaLogLevels });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
