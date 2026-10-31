import { NextResponse } from "next/server";
import { apiErrorBody } from "~/lib/api-error";
import { requireRequestUser } from "~/server/auth/request-user";
import fs from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { toDisplayPath } from "~/lib/path-display";

const LOG_DIR = path.join(process.cwd(), "log");

type LogFileInfo = {
  mtimeMs: number;
  name: string;
  relativePath: string;
  size: number;
};

/**
 * 递归列 `log/` 下的 `.log`。异步（ISSUE #2193）：这一份是整棵日志树
 * 「一次 `readdir` + 每个文件一次 `stat`」，同步写法把全部系统调用压在
 * 事件循环线程上；日志文件随运行次数增长，代价也跟着长。
 *
 * 两处语义按原样保住，没有顺手「改进」：
 *   - 目录不存在 ⇒ 空列表（第一次运行 / 从没写过日志）；
 *   - **其它**读故障（权限 / 磁盘 / readdir 与 stat 之间文件被换掉）⇒ 照旧上抛，
 *     由 `GET` 那一层回 500 —— 「读不到」不许被并成「没有」。
 * 这里原本不带 `turbopackIgnore` 标记，改完也不带（加标记会改变构建期 tracing）。
 */
async function scanLogFiles(dir: string, base: string): Promise<Array<LogFileInfo>> {
  let entries: Array<Dirent>;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (/* SAFETY: 类型断言已复核 */ (error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const perEntry = await Promise.all(
    entries.map(async (entry): Promise<Array<LogFileInfo>> => {
      const full = path.join(dir, entry.name);
      const rel = path.join(base, entry.name);
      if (entry.isDirectory()) {
        return scanLogFiles(full, rel);
      }
      if (!entry.isFile() || !entry.name.endsWith(".log")) {
        return [];
      }
      const stat = await fs.promises.stat(full);
      return [
        {
          mtimeMs: stat.mtimeMs,
          name: entry.name,
          relativePath: toDisplayPath(rel),
          size: stat.size,
        },
      ];
    }),
  );
  return perEntry.flat();
}

export async function GET() {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  try {
    const files = (await scanLogFiles(LOG_DIR, ""))
      .filter((f) => f.name !== "dev-launcher.log")
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return NextResponse.json({ files });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "读取日志列表失败", { files: [] }), {
      status: 500,
    });
  }
}
