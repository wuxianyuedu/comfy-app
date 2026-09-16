import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "~/lib/auth-server";
import {
  SUBMIT_PENDING_DETAIL,
  USAGE_TEST_KINDS,
  callChat,
  callImage,
  callVideo,
  parseExtraJson,
  readUsageTestPrologue,
  saveMediaToLocalTemp,
  strField,
} from "~/lib/llm/usage-test.server";
import { errorMessage } from "~/lib/error-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/llm/test-usage —— 按用途（chat / image / video）发起**一次真实调用**。
 *
 * 请求解析、连接参数回落（弹窗内填的 → 条目已保存的 → 全局）与上游调用都在
 * `~/lib/llm/usage-test.server`，与「继续等待」路由（`./query`）逐字共用一份
 * —— 两个动作对同一上游必须发出同一形状的请求，密钥解析也必须同一口径。
 *
 * 生视频走任务制时：内置一轮轮询（VIDEO_POLL_TOTAL_MS），仍未就绪即以
 * `{ pending:true, taskId }` 返回，由 `./query` 接收「继续等待」，本路由
 * **不**重新提交。
 *
 * 失败一律 200 + `{ ok:false, detail }`，前端按 detail 展示降级文案。
 */
export async function POST(req: NextRequest) {
  await getServerUser();

  /* 读 body / 取条目名 / 解析连接参数与「继续等待」路由同一份实现（§12.12）。 */
  const prologue = await readUsageTestPrologue(req);
  if (!prologue.ok)
    return NextResponse.json({ ok: false, detail: prologue.detail });
  const { name, rec, up } = prologue;

  const kind = strField(rec, "kind");
  const prompt = strField(rec, "prompt");
  const size = strField(rec, "size");
  const extraJson = strField(rec, "extraJson");

  if (!(USAGE_TEST_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({
      ok: false,
      detail: `未知用途：${kind || "(空)"}`,
    });
  }
  if (!prompt) return NextResponse.json({ ok: false, detail: "请填写提示词" });

  // 条目名即模型参数值（设置页清单按模型名建条目）
  const model = name;

  const parsedExtra = parseExtraJson(extraJson);
  if (!parsedExtra.ok)
    return NextResponse.json({ ok: false, detail: parsedExtra.detail });
  const { extra } = parsedExtra;

  const startedAt = Date.now();
  try {
    if (kind === "chat") {
      const r = await callChat(up, model, prompt, extra);
      if (!r.ok) return NextResponse.json({ ok: false, detail: r.detail });
      return NextResponse.json({
        ok: true,
        detail: "调用成功",
        chatText: r.text,
        elapsedMs: Date.now() - startedAt,
      });
    }

    if (kind === "image") {
      const r = await callImage(up, model, prompt, size, extra);
      if (!r.ok) return NextResponse.json({ ok: false, detail: r.detail });
      /* 产出的图片落到本地 temp 子目录一份（不是只给远端 URL） */
      const savedPath = await saveMediaToLocalTemp("image", name, r.url);
      return NextResponse.json({
        ok: true,
        detail: "生成成功",
        imageUrl: r.url,
        savedPath,
        elapsedMs: Date.now() - startedAt,
      });
    }

    // ── video：提交（同步 URL 或任务 ID），任务制则轮询到完成或超时 ──
    const outcome = await callVideo(up, model, prompt, extra);
    if (outcome.status === "error") {
      return NextResponse.json({ ok: false, detail: outcome.detail });
    }
    if (outcome.status === "pending") {
      return NextResponse.json({
        ok: true,
        detail: SUBMIT_PENDING_DETAIL,
        taskId: outcome.taskId,
        pending: true,
        elapsedMs: Date.now() - startedAt,
      });
    }
    const savedPath = await saveMediaToLocalTemp("video", name, outcome.url);
    return NextResponse.json({
      ok: true,
      detail: "生成成功",
      videoUrl: outcome.url,
      savedPath,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      detail: errorMessage(e, "调用失败"),
      elapsedMs: Date.now() - startedAt,
    });
  }
}
