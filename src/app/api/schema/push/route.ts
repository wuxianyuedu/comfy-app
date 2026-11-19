import fs from "node:fs";
import { type NextRequest, NextResponse } from "next/server";

import { spawnSchemaSync } from "../../../../../scripts/db/db-schema-state.mjs";
import { isRecord } from "~/lib/is-record";
import { SCHEMA_SYNC_STATUS_FILE } from "~/lib/log/log-paths";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { isSplashOrigin } from "~/lib/shell/splash-origin";

/**
 * `POST /api/schema/push` —— 状态栏「立即同步」按钮的执行端：`stale` / `missing` 意味着启动时的自动同步没能把库带到当前 schema（dry-run 白名单判出这批变更含
 * 删列 / 重建表这类会丢数据的语句，启动链路不替用户决定），此前只能让用户去终端跑 `pnpm db:push`；本端点在确认弹窗后以 `--force` 口径 spawn 一次 `db-sync.mjs`，
 * 结果照旧写 `log/current/tools/schema-sync.json`（页面 2s 轮询原样拿到迁移，不引入第二条状态通道）。守卫三层、失败方向都是「不执行」：相位非 stale/missing → 409；`syncing` → 409（两个 drizzle 并发写同一库）；执行件不在（桌包刻意不带）→ 404，前端据 `canPush` 不显示按钮。
 */
export const dynamic = "force-dynamic";

/** 同进程内的并发闸：spawn 与子进程写下 `syncing` 之间有个窗口，双击会撞上。
 *  挂 globalThis 而不是模块顶层（#4455）：dev 的 HMR 会重置模块变量，而闸要
 *  保持到子进程退出（最坏 600s）——模块被重新求值时闸归零，第二个请求会穿过
 *  两道闸并发 push 同一个 SQLite。与 ollama-start 的启动锁同一形态。 */
const GATE_KEY = "__comfySchemaPushGate_v1";

function isSchemaPushGate(v: unknown): v is { spawning: boolean } {
  return isRecord(v) && typeof v.spawning === "boolean";
}

const existingGate: unknown = Reflect.get(globalThis, GATE_KEY);
const gate: { spawning: boolean } = isSchemaPushGate(existingGate)
  ? existingGate
  : { spawning: false };
Reflect.set(globalThis, GATE_KEY, gate);

export async function POST(req: NextRequest) {
  /* 鉴权 + 同源校验（#4040）：本端点会以 `--force` 口径 spawn schema 同步
   * （含删列 / 重建表这类会丢数据的语句），不能被任意网页的「简单请求」
   * 跨站触发（不读 body、不带自定义头 = 浏览器照常发出）。Origin 必须是
   * 本机界面同源或启动页那一族（白名单唯一事实源 `~/lib/shell/splash-origin`）；
   * 缺 Origin（本机工具 / curl）放行——桌面应用的合法调用方是本机界面与本机工具，
   * 而跨站攻击的 fetch 必带 Origin。 */
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  const origin = req.headers.get("origin");
  const sameOrigin = origin !== null && origin === req.nextUrl.origin;
  if (origin !== null && !sameOrigin && !isSplashOrigin(origin)) {
    return NextResponse.json({ ok: false, error: "跨站请求已拒绝" }, { status: 403 });
  }

  if (gate.spawning) {
    return NextResponse.json({ ok: false, error: "已有一次同步在发起中" }, { status: 409 });
  }

  const file = SCHEMA_SYNC_STATUS_FILE;
  let current: unknown = null;
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* 读不到状态文件 → current 保持 null，下面的相位守卫会挡下。 */
  }
  const phase = isRecord(current) ? current.phase : null;
  if (phase !== "stale" && phase !== "missing") {
    return NextResponse.json(
      {
        ok: false,
        error:
          phase === "syncing" ? "数据库正在同步中，请等它结束" : "当前没有需要同步的数据库结构变更",
      },
      { status: 409 },
    );
  }

  /* 闸保持到子进程退出（ISSUE #4283）：spawn 同步返回后，子进程还要百毫秒级
   * 才会把相位写成 `syncing`——那只靠 finally 在 spawn 返回后立刻放闸是挡不住
   * 双击/并发的（第二个请求会穿过两道闸去并发 push 同一个 SQLite）。子进程
   * 有 600s 预算兜底（最坏 600s 后闸也会放开），正常几秒退出即放闸。 */
  gate.spawning = true;
  const started = spawnSchemaSync(process.cwd(), { force: true });
  if (!started.started) {
    gate.spawning = false;
    return NextResponse.json(
      { ok: false, error: started.reason ?? "无法发起同步" },
      { status: 404 },
    );
  }
  started.child?.once("exit", () => {
    gate.spawning = false;
  });
  return NextResponse.json({ ok: true });
}
