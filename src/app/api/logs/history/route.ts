import { NextResponse } from "next/server";
import { apiErrorBody } from "~/lib/api-error";
import { requireRequestUser } from "~/server/auth/request-user";
import { isRecord } from "~/lib/is-record";
import fs from "node:fs";
import path from "node:path";
import { unauthorizedResponse } from "~/server/lib/error-response";

const LOG_DIR = path.join(process.cwd(), "log");

export async function GET(request: Request) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const rel = searchParams.get("file") ?? "";
    if (!rel) {
      return NextResponse.json({ content: "", size: 0, error: "missing file" }, { status: 400 });
    }

    // 安全校验：只能读取 log/ 目录下的 .log 文件
    const resolvedLogDir = path.resolve(LOG_DIR);
    const full = path.resolve(resolvedLogDir, rel);
    /* 「这一份不在盘上」与「路径形态不合格」是同一个出口（400 + 同一句原因），
     * 而**其它读故障**（权限 / 磁盘 / 目录当文件读）照旧抛给下面的 500 ——
     * 异步化没有把这两档并成一个 catch-all（ISSUE #2193 的两处风险之一）。
     * 这两处调用原本不带 `turbopackIgnore` 标记，改完也不带：加标记会**改变**
     * 构建期 tracing，而那条链的表现是「构建期过、出厂件缺件」。 */
    const invalidOrMissing = () =>
      NextResponse.json(
        { content: "", size: 0, error: "invalid or missing file" },
        { status: 400 },
      );
    if (!full.startsWith(resolvedLogDir + path.sep) || !full.endsWith(".log")) {
      return invalidOrMissing();
    }

    let content: string;
    try {
      content = await fs.promises.readFile(full, "utf8");
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        return invalidOrMissing();
      }
      throw error;
    }
    return NextResponse.json({ content, size: content.length });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "读取日志历史失败", { content: "", size: 0 }), {
      status: 500,
    });
  }
}
