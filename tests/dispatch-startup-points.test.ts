/**
 * 派发循环的启动点与「只有一条 pull」的源形态判据
 * （P3 §5 ADR §14 D1 的第二刀）。
 *
 * 为什么是源形态判据而不是行为判据：这一刀的失败形态是**静默**的——
 *   · 谁都没起循环 → 任务永远停在 `QUEUED`，直到被 reaper 判孤儿（表现为
 *     「提交后一会儿就失败」，看不出与启动点有关）；
 *   · 两宿主各起一条 → 双执行，正是 ADR §6 开头写明的「双 finalize 错乱」事故形态；
 *   · 内存队列以另一种形态长回来（提交方直接 push）→ 又变成两条循环，
 *     而两条循环并存时**每次测试都可能只跑到其中一条**。
 * 这三条都没有可单测的运行期入口（要等真进程），所以钉在源码形状上，
 * 与 `tests/reaper-side-effect.test.ts`（谁起回收器）同一族。
 *
 * 别处更强的执行者：领取/门控/槽位的**行为**判据在
 * `src/lib/comfyui/executor-dispatch.test.ts`；两宿主归属谓词同源由
 * `src/lib/core/repository-task-impl.test.ts` 的 §6 归属组钉。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const code = (rel: string): string =>
  stripComments(readFileSync(path.join(ROOT, rel), "utf-8"));

/** 全仓（src + scripts）里出现 `startDispatchLoop(` **调用**的文件。 */
function loopCallSites(): string[] {
  const files = [
    "src/instrumentation.ts",
    "src/lib/comfyui/executor-dispatch.ts",
    "src/lib/comfyui/executor.ts",
    "src/lib/comfyui/enqueue.ts",
    "src/lib/comfyui/reaper.ts",
    "src/lib/comfyui/executor-cli.ts",
    "src/lib/comfyui/executor-finalize.ts",
    "src/lib/comfyui/executor-ws.ts",
    "src/lib/comfyui/firstframe.ts",
    "scripts/executor-host.mjs",
    "scripts/dev-launcher.mjs",
  ];
  /* 只数**调用点**：声明行（`export function startDispatchLoop(`）与 barrel 的
   * 再导出列表都带这个名字，把它们算进来会把 dispatch 自己报成第二个启动点。 */
  return files.filter((rel) =>
    code(rel)
      .split("\n")
      .some(
        (line) =>
          line.includes("startDispatchLoop(") &&
          !line.includes("function startDispatchLoop"),
      ),
  );
}

describe("派发循环的启动点：每宿主一处，且只一处", () => {
  it("Next 侧 = src/instrumentation.ts 的 nodejs 分支（与 reaper 并排一处）", () => {
    const src = code("src/instrumentation.ts");
    const starts = src.match(/m\.startDispatchLoop\(\)/g) ?? [];
    expect(starts, "Next 侧必须有且仅有一处 startDispatchLoop").toHaveLength(1);
    // 顺序也有意义：先转录 stdout、再起 reaper、再起领取循环。
    expect(src.indexOf("installStreamCapture")).toBeLessThan(
      src.indexOf("startReaper"),
    );
    expect(src.indexOf("startReaper")).toBeLessThan(
      src.indexOf("startDispatchLoop"),
    );
    // Edge runtime 的分支里不许出现（Node-only 模块进 Edge 图会构建失败）。
    const edge = src.slice(src.indexOf('process.env.NEXT_RUNTIME === "edge"'));
    expect(edge).not.toMatch("startDispatchLoop");
    expect(edge).not.toMatch("startReaper");
  });

  it("host 侧不另起一条循环：它驱动同一个 claimAndDispatchOnce", () => {
    const host = code("scripts/executor-host.mjs");
    /* 反向判据：host 脚本里出现 startDispatchLoop( 就是「两条常驻循环」——
     * Next 一条 + host 一条，双执行的成因。 */
    expect(host.includes("startDispatchLoop(")).toBe(false);
    expect(host).toMatch("claimAndDispatchOnce");
    expect(host).toMatch(
      /configureDispatch\(\{ taskRepo: hostRepo, owner: "host" \}\)/,
    );
  });

  it("全仓只有 Next 那一处调用 startDispatchLoop", () => {
    expect(loopCallSites()).toEqual(["src/instrumentation.ts"]);
  });
});

describe("只有一条 pull：内存队列不再长回来", () => {
  it("执行链里没有内存队列 / 计数器 / 出队函数", () => {
    for (const rel of [
      "src/lib/comfyui/executor-dispatch.ts",
      "src/lib/comfyui/enqueue.ts",
      "src/lib/comfyui/queue-status.server.ts",
      "src/lib/comfyui/runner-state.ts",
      "src/lib/comfyui/runner-state-shape.ts",
    ]) {
      const src = code(rel);
      expect(src, `${rel} 不该再读内存队列`).not.toMatch(/\.queue\b/);
      expect(src, `${rel} 不该再维护活跃计数器`).not.toMatch(/s\.active\b/);
      expect(src).not.toMatch(/processQueue/);
    }
    expect(code("src/lib/comfyui/executor.ts")).not.toMatch(
      /executor-scheduler/,
    );
  });

  it("调度层文件已删除、barrel 不再导出出队函数", () => {
    expect(() =>
      readFileSync(
        path.join(ROOT, "src/lib/comfyui/executor-scheduler.ts"),
        "utf-8",
      ),
    ).toThrow();
    const barrel = code("src/lib/comfyui/executor.ts");
    expect(barrel).not.toMatch(/processQueue/);
    // barrel 仍要把 dispatch 带进加载图：注册先于第一次收口（见文件头理由）。
    expect(barrel).toMatch(
      /export \{[\s\S]*?claimAndDispatchOnce[\s\S]*?\} from "\.\/executor-dispatch"/,
    );
  });

  it("提交方只写库 + kick，不再往执行器推 Job", () => {
    for (const rel of [
      "src/server/api/routers/generate.ts",
      "src/lib/workshop/workflow-run.server.ts",
    ]) {
      const src = code(rel);
      expect(src, `${rel} 不该再直接 enqueue`).not.toMatch(/\benqueue\(/);
      expect(src, `${rel} 提交后要踢一次领取`).toMatch("kickQueue()");
      expect(src).toMatch("claimedBy: executorClaim");
    }
  });

  it("续跑与广播都走叶子总线（收口侧与通道侧不 import 调度层，规范 12.7）", () => {
    for (const rel of [
      "src/lib/comfyui/executor-finalize.ts",
      "src/lib/comfyui/executor-ws.ts",
      "src/lib/comfyui/enqueue.ts",
    ]) {
      expect(code(rel), `${rel} 引回了调度层`).not.toMatch(/executor-dispatch/);
    }
    const leaf = code("src/lib/comfyui/executor-continuation.ts");
    expect(leaf).toMatch(/export function registerQueueKick/);
    expect(leaf).toMatch(/export function registerQueueAnnounce/);
    expect(leaf).toMatch(/export function kickQueue/);
    expect(leaf).toMatch(/export function announceToQueuedTasks/);
    expect(code("src/lib/comfyui/executor-dispatch.ts")).toMatch(
      "registerQueueAnnounce(announceWaiting)",
    );
  });
});
