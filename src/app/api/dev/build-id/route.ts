import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getServerBootId } from "~/lib/shell/dev-server-id";
import { readDepsFreshness } from "~/lib/shell/deps-freshness.server";
import { tracingIgnoreArgs } from "~/lib/shell/tracing-ignore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 本机源码改动是否已进入当前运行图 —— 被观测的模块（相对仓库根）。 */
const WATCHED_MODULES = [
  "src/components/studio/workflow-editor/WorkflowStores.tsx",
  "src/components/studio/ToastProvider.tsx",
];

/**
 * 取被观测模块的改动指纹（mtime + 大小）：常见用法是边改边看、改动未提交，Git 提交号不变。
 * 不写进 `/api/update-check`：那条回答「哪些改动需重启」，这里是「HMR 生效但旧实例没重建」，
 * 两套判据混在一起会让它对 src/ 每次改动都报需重启。
 */
function moduleFingerprints(): string {
  const root = process.cwd();
  return WATCHED_MODULES.map((rel) => {
    try {
      const st = fs.statSync(path.join(...tracingIgnoreArgs(), root, rel));
      return `${rel}@${Math.trunc(st.mtimeMs)}:${st.size}`;
    } catch {
      /* 读不到（打包形态不含源码）就记 missing，不当作变化。 */
      return `${rel}@missing`;
    }
  }).join("|");
}

/**
 * 端点：GET /api/dev/build-id —— 判定「运行中的模块图是不是加载时那棵」：buildId = bootId + 源码 mtime 指纹，任一变化即页面跑的不是最新。
 * 另回 bootId（只有它变才是真重启）、restartReason/restartDetail（重启原因，归因失败为 null）、
 * depsStale/depsState（依赖面陈旧与否，不随重启变，无法判定为 null）。
 */
export async function GET() {
  const bootId = getServerBootId();
  const buildId = `${bootId}|${moduleFingerprints()}`;
  const restartReason = process.env.COMFYAPP_RESTART_REASON ?? null;
  const restartDetail = process.env.COMFYAPP_RESTART_DETAIL ?? null;
  const deps = readDepsFreshness();
  return NextResponse.json(
    {
      buildId,
      bootId,
      restartReason,
      restartDetail,
      depsStale: deps?.stale ?? null,
      depsState: deps?.state ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
