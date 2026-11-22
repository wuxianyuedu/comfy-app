import { NextResponse } from "next/server";
import { apiErrorBody } from "~/lib/api-error";
import { requireRequestUser } from "~/server/auth/request-user";
import { isRecord } from "~/lib/is-record";
import fsp from "node:fs/promises";
import path from "node:path";
import { unauthorizedResponse } from "~/server/lib/error-response";

const LOG_DIR = path.join(process.cwd(), "log");

/** 历史日志一次回读的字节上限（ISSUE #4252）：这份日志会积累到几十 MB，
 *  整文件读进内存再 JSON 序列化，轮询并发下是 MB 级堆尖峰。超限只回尾部
 *  窗口（与壳侧 `read_tail_bytes` 同思路），首行残缺丢弃并加一行说明。 */
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

/** 读文件尾部至多 maxBytes 字节；`truncated` = 文件比上限大、首行可能是残行。 */
async function readLogTail(
  full: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const handle = await fsp.open(full, "r");
  try {
    const { size } = await handle.stat();
    const start = size > maxBytes ? size - maxBytes : 0;
    const buf = Buffer.alloc(size - start);
    await handle.read(buf, 0, buf.length, start);
    return { text: buf.toString("utf8"), truncated: start > 0 };
  } finally {
    /* 清理自身抛错不得覆盖业务异常（#4728）：与 generated 路由的 close 同口径。 */
    await handle.close().catch(() => undefined);
  }
}

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

    let text: string;
    let truncated: boolean;
    try {
      ({ text, truncated } = await readLogTail(full, MAX_HISTORY_BYTES));
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        return invalidOrMissing();
      }
      throw error;
    }
    let content = text;
    if (truncated) {
      /* 首行是被截断点切出来的残行：丢弃，并说明只展示了尾部。 */
      const nl = text.indexOf("\n");
      const body = nl === -1 ? "" : text.slice(nl + 1);
      content = `…（日志过大，仅显示最后 ${Math.floor(MAX_HISTORY_BYTES / 1024 / 1024)}MB）\n${body}`;
    }
    return NextResponse.json({ content, size: content.length });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "读取日志历史失败", { content: "", size: 0 }), {
      status: 500,
    });
  }
}
