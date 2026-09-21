import { NextResponse } from "next/server";
import { apiErrorBody } from "~/lib/api-error";
import fs from "node:fs";
import path from "node:path";
import { requireRequestUser } from "~/server/auth/request-user";
import { LOG_EXPORT_DIR, LOG_ROOT } from "~/lib/log/log-paths";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { formatCompactStamp } from "~/lib/time-format";
import { toDisplayPath } from "~/lib/path-display";

/**
 * 日志面板「保存到本地」端点：把面板当前筛选出的日志**真的写到磁盘**。
 *
 * 为什么不是只靠浏览器的 `<a download>`：桌面壳里那一步是否弹出保存框、存到
 * 哪里由宿主决定，用户点完常常「本地哪儿都没有」（ISSUE #609 反馈第 3 条：
 * 「应用运行日志，没看到本地有保存」）。排障要的是「路径说得出来、文件确实在」，
 * 因此由服务端落盘到 `log/exports/`，并把**绝对路径**回给面板显示。
 *
 * 契约：
 *   - 鉴权与 `/api/logs/list`、`/api/logs/history` 一致（`requireRequestUser`）；
 *   - 文件名由服务端**自己生成**（只接受前缀白名单），绝不采用客户端传来的路径
 *     ——否则就是一个任意路径写入漏洞；
 *   - 内容大小封顶（日志可能几十 MB，一次导出不该把磁盘写满）；
 *   - 写入失败如实返回 500 + 原因，不谎报成功。
 */

/** 单次导出上限（字符）。与面板每页 2000 条 × 单行上限同量级，够贴出一个现场。 */
const MAX_EXPORT_CHARS = 8 * 1024 * 1024;

/** 允许的导出标签（进文件名，只用于「这是哪一类日志」的可读性）。 */
const ALLOWED_LABELS = new Set([
  "all",
  "app-runtime",
  "app",
  "dev",
  "launcher",
  "console",
]);

/** 本地时间戳文件名（与 runtime 家族日志同口径，本地时区便于用户对照）。
 *
 *  形态（`YYYYMMDD-HHmmss`，无分隔符以便直接进文件名）走 `~/lib/time-format`
 *  的 {@link formatCompactStamp} —— 冒号在 Windows 路径里非法，因此这一档
 *  与日志行首的 `YYYY-MM-DD HH:mm:ss` 是**两个形态**，不是两次实现。 */
function exportFileName(label: string): string {
  return `logs-${label}-${formatCompactStamp(new Date())}.txt`;
}

export async function POST(request: Request) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  /* 读体走唯一出口（规范 16 §16.2.4.44）：此前这里是
   * 类型断言形态 `(await request.json()) as {...}`（label / content 两个字段）——
   * **类型断言不是校验**，畸形正文或非对象会在下一行属性访问处抛 TypeError，
   * 被下面的 catch 兜成 500（用户看到的是「服务端错误」，而病因是他的请求体）。
   * 现在格式不对就明确回 400。 */
  const body = await readJsonRecord(request);
  if (isErrorResponse(body)) return body;

  try {
    const content = typeof body.content === "string" ? body.content : "";
    if (content.length === 0) {
      return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
    }
    if (content.length > MAX_EXPORT_CHARS) {
      return NextResponse.json(
        { ok: false, error: "too-large", limit: MAX_EXPORT_CHARS },
        { status: 413 },
      );
    }
    const rawLabel = typeof body.label === "string" ? body.label : "all";
    const label = ALLOWED_LABELS.has(rawLabel) ? rawLabel : "all";

    fs.mkdirSync(/*turbopackIgnore: true*/ LOG_EXPORT_DIR, { recursive: true });
    const file = path.join(LOG_EXPORT_DIR, exportFileName(label));
    fs.writeFileSync(/*turbopackIgnore: true*/ file, content, "utf-8");

    return NextResponse.json({
      ok: true,
      /** 绝对路径：用户要能在文件管理器里直接找到它。 */
      path: file,
      /** 相对 log/ 的路径：面板空间窄，展示这一截即可。 */
      relativePath: toDisplayPath(file, LOG_ROOT),
      bytes: Buffer.byteLength(content, "utf-8"),
    });
  } catch (error) {
    return NextResponse.json(
      apiErrorBody(error, "导出日志失败", { ok: false }),
      { status: 500 },
    );
  }
}
