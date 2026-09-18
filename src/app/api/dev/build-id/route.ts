import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getServerBootId } from "~/lib/shell/dev-server-id";
import { tracingIgnoreArgs } from "~/lib/shell/tracing-ignore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 本机源码改动是否已进入当前运行图 —— 被观测的模块（相对仓库根）。 */
const WATCHED_MODULES = [
  "src/components/studio/workflow-editor/WorkflowStores.tsx",
  "src/components/studio/ToastProvider.tsx",
];

/**
 * 取被观测模块的「改动指纹」：mtime + 大小。
 *
 * 为什么看源码文件的 mtime 而不是 Git 提交号：本项目最常见的用法正是
 * 「桌面壳长开、边改边看」，改动往往还没提交——提交号根本不会变，等于没有
 * 信号。源码 mtime 则如实反映「这台机器上的代码已经变了」。
 *
 * 为什么**不**把这个判定写进 `/api/update-check`：那条通道回答的是「哪些
 * 改动需要重启才生效」（Rust / 配置 / `.env`，前端源码明确被排除在它范围
 * 之外——HMR 会处理）。这里的场景恰恰相反：前端源码 HMR **会**生效，但
 * 「已经挂在页面上的旧组件实例」不会重建，于是旧实例与新模块错位。两件事、
 * 两套判据，混在一起会让那条通道开始对 src/ 的每次改动都报「需重启」。
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
 * GET /api/dev/build-id
 *
 * 给前端一条「运行中的这棵模块图，是不是加载时的那一棵」的判定依据。
 *
 * 判据 = 进程启动标识 + 被观测源码模块的 mtime 指纹。任一方变化都意味着
 * 「当前页面跑的代码不是最新的」：
 *   · 启动标识变 → 应用服务重启过（页面还是旧进程送来的代码）；
 *   · 指纹变 → 源码在本机被改过（页面还没重载到改动后的模块）。
 *
 * `force-dynamic` 且 `no-store`：构建标识必须反映此刻，不做任何缓存。
 */
export async function GET() {
  const buildId = `${getServerBootId()}|${moduleFingerprints()}`;
  return NextResponse.json(
    { buildId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
