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
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { IN_MEMORY_QUEUE_FACE } from "../scripts/lib/execution-chain-files.mjs";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 判据针对的是代码，所以先剥注释（唯一实现 `./helpers/strip-comments`）。
 * `{ trailing: true }` 连行尾注释一起去 —— 「// 这里别再调 startDispatchLoop」
 * 那种教人别这么写的句子落在同一行行尾时，反向断言会假红。 */
const code = (rel: string): string => {
  const stripped = stripComments(readFileSync(path.join(ROOT, rel), "utf8"), {
    trailing: true,
  });
  // 这一族全是反向断言，前提是"读到了东西"：剥完是空文 ⇒ `not.toMatch` 恒真。
  expect(stripped.trim(), `${rel}：剥完注释是空文，落在它身上的反向断言恒真`).not.toHaveLength(0);
  return stripped;
};

/**
 * 「全仓」这一格的面：`src/**` + `scripts/**` 里所有非测试源文件，**从目录派生**。
 *
 * 原来它是一份 11 项手抄清单，而这句话自称覆盖全仓 —— 手抄清单在新文件里长出第二条循环时
 * 不会红（少判在这一族上的表现是 `toEqual(["src/instrumentation.ts"])` 照样通过）。
 * 排除 `*.test.*`：`src/lib/comfyui/executor-dispatch.test.ts:451` 那两行
 * `mod.startDispatchLoop(50)` 是行为用例的正当夹具，把它算成"第二个启动点"是误报。
 */
const SCAN_LAYERS = ["src", "scripts"];
const SOURCE_EXT = /\.(?:ts|tsx|mjs)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx|mjs)$/;

function scanRepoSources(): Array<string> {
  const out: Array<string> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".") || entry === "node_modules") {
        continue;
      }
      const abs = path.join(dir, entry);
      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (SOURCE_EXT.test(entry) && !TEST_FILE.test(entry)) {
        out.push(path.relative(ROOT, abs).split(path.sep).join("/"));
      }
    }
  };
  for (const layer of SCAN_LAYERS) {
    if (statSync(path.join(ROOT, layer), { throwIfNoEntry: false })?.isDirectory()) {
      walk(path.join(ROOT, layer));
    }
  }
  return out.sort();
}

/** 走一遍就够：两次独立扫面会把这一格的实测成本再翻一倍（下面是 prefilter 的实测数）。 */
const REPO_SOURCES = scanRepoSources();

/** 全仓里出现 `startDispatchLoop(` **调用**的文件。 */
function loopCallSites(): Array<string> {
  /* 先按原文粗筛（实测：面 1371 份、读 + prefilter 188ms、命中 3 份），
   * 只对幸存者剥注释再判形状 —— 这一格的语义不变，成本也不变成 1371 次正则。 */
  return (
    REPO_SOURCES.filter((rel) =>
      readFileSync(path.join(ROOT, rel), "utf8").includes("startDispatchLoop"),
    )
      /* 只数**调用点**：声明行（`export function startDispatchLoop(`）与 barrel 的
       * 再导出列表都带这个名字，把它们算进来会把 dispatch 自己报成第二个启动点。 */
      .filter((rel) =>
        code(rel)
          .split("\n")
          .some(
            (line) =>
              line.includes("startDispatchLoop(") && !line.includes("function startDispatchLoop"),
          ),
      )
  );
}

describe("派发循环的启动点：每宿主一处，且只一处", () => {
  it("面是真的「全仓」：目录里有东西，且两个必须看得见的所在在面里", () => {
    expect(
      REPO_SOURCES.length,
      "src + scripts 扫到 0 份源文件 ⇒ 下面那条「全仓只有 Next 那一处调用」在不判任何东西",
    ).toBeGreaterThan(0);
    for (const rel of [
      "src/instrumentation.ts",
      "src/lib/comfyui/executor-dispatch.ts",
      "scripts/executor-host.mjs",
    ]) {
      expect(
        REPO_SOURCES,
        `面里不见了 ${rel} —— 派生的层或扩展名改了，` + "「全仓」会退化成只判剩下那些文件",
      ).toContain(rel);
    }
  });

  it("Next 侧 = src/instrumentation.ts 的 nodejs 分支（与 reaper 并排一处）", () => {
    const src = code("src/instrumentation.ts");
    const starts = src.match(/m\.startDispatchLoop\(\)/g) ?? [];
    expect(starts, "Next 侧必须有且仅有一处 startDispatchLoop").toHaveLength(1);
    /* 顺序也有意义：先转录 stdout、再起 reaper、再起领取循环。
     * 这三个标记各自先验"在不在"：`indexOf` 取不到是 -1，而 `-1 < 任何正数` 为真 ——
     * 少了这一格，把 `startReaper` 整行删掉反而会让下面两条排序断言通过。 */
    for (const marker of ["installStreamCapture", "startReaper", "startDispatchLoop"]) {
      expect(
        src.indexOf(marker),
        `src/instrumentation.ts 里找不到 ${marker} —— 拿 -1 比大小会恒真，这条顺序判据就不判了`,
      ).not.toBe(-1);
    }
    expect(src.indexOf("installStreamCapture")).toBeLessThan(src.indexOf("startReaper"));
    expect(src.indexOf("startReaper")).toBeLessThan(src.indexOf("startDispatchLoop"));
    /* Edge runtime 的分支里不许出现（Node-only 模块进 Edge 图会构建失败）。
     * `slice(-1)` 只给最后一个字符，所以起点必须先验：标记没了 ⇒ 这两条 `not.toMatch`
     * 判的是一份一字符的文本，而账面仍是绿。 */
    const edgeAt = src.indexOf('process.env.NEXT_RUNTIME === "edge"');
    expect(
      edgeAt,
      "src/instrumentation.ts 里找不到 edge 分支的起点标记 —— slice(-1) 会切成最后一个字符，" +
        "下面两条「Edge 里不许出现」就在判空文",
    ).not.toBe(-1);
    const edge = src.slice(edgeAt);
    expect(edge).not.toMatch("startDispatchLoop");
    expect(edge).not.toMatch("startReaper");
  });

  it("host 侧不另起一条循环：它驱动同一个 claimAndDispatchOnce", () => {
    const host = code("scripts/executor-host.mjs");
    /* 反向判据：host 脚本里出现 startDispatchLoop( 就是「两条常驻循环」——
     * Next 一条 + host 一条，双执行的成因。 */
    expect(host.includes("startDispatchLoop(")).toBe(false);
    expect(host).toMatch("claimAndDispatchOnce");
    expect(host).toMatch(/configureDispatch\(\{ taskRepo: hostRepo, owner: "host" \}\)/);
  });

  it("全仓只有 Next 那一处调用 startDispatchLoop", () => {
    expect(loopCallSites()).toEqual(["src/instrumentation.ts"]);
  });
});

describe("只有一条 pull：内存队列不再长回来", () => {
  it("执行链里没有内存队列 / 计数器 / 出队函数", () => {
    /* 这份面的唯一定义在 `scripts/lib/execution-chain-files.mjs`（ISSUE #2914）：
     * 登记制窄面，每份进面文件的理由写在模块里；为什么它与通道闸那份 17 项派生宽面
     * 不是同一份地图、又为何不合并，见模块文件头。 */
    for (const rel of IN_MEMORY_QUEUE_FACE) {
      const src = code(rel);
      expect(src, `${rel} 不该再读内存队列`).not.toMatch(/\.queue\b/);
      expect(src, `${rel} 不该再维护活跃计数器`).not.toMatch(/s\.active\b/);
      expect(src).not.toMatch(/processQueue/);
    }
    expect(code("src/lib/comfyui/executor.ts")).not.toMatch(/executor-scheduler/);
  });

  it("调度层文件已删除、barrel 不再导出出队函数", () => {
    expect(() =>
      readFileSync(path.join(ROOT, "src/lib/comfyui/executor-scheduler.ts"), "utf8"),
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
