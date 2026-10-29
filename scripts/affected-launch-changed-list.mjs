/**
 * affected-launch-changed-list.mjs —— 组 C 的**清单那一跳**：改动面 ⇒ 该跑哪些用例。
 *
 * 单独成文件的理由是那条长度硬闸背后的东西：`run-affected-tests.mjs` 里装着
 * 「分块 / 并发 / 负载判决 / 收尾」四件事，再塞第五件就会长到读不动（§12.6 R5 /
 * §12.13，与话术层收成 `affected-launch-rerun-report.mjs` 是同一刀）。
 *
 * ## 这一跳的判决一个字都没改
 *
 * 「改动面 ⇒ 受影响用例」仍只有 `scripts/affected-tests.mjs` 那一份实现（§12.18 /
 * §12.12：不发明第二套筛法）。本模块只负责**怎么把改动面送过去**。
 *
 * ## 为什么载体是 stdin 而不是 argv（ISSUE #2240）
 *
 * 早先这一跳把改动面**逐个铺进 argv**：`affected-tests.mjs --changed a b c …`。
 * argv 在 Windows 上有硬上限（整条命令行 32767 字符），而「删了一大批产物」那种 PR
 * 的改动面能到几千条 —— 实测 2672 条 / 172796 字符 ⇒ 那个子进程**根本起不来**
 * （`spawnSync` 报 `ENAMETOOLONG`、`status=null`）⇒ 平台「受影响用例」那一格红在
 * 「清单解析失败（退出码 信号）」，**后面 22 个 stage 全 `skipped`**。
 *
 * 环境变量那条路装得下（同一份清单实测回读 172796 字符、退出码 0）⇒ 瓶颈**只在 argv**。
 * 现在改动面走 **stdin**（`--changed-stdin`）：清单一行一个，管道没有那个上限。
 *
 * ## 失败要分得开：「起不来」与「跑起来但判红」是两件事
 *
 * 早先那一格只念一句「退出码 信号」—— 平台上分不出是「清单太长、子进程没起来」
 * 还是「清单算出来是红的」。两者的处置完全不同，所以话术里分开说，并把**条数**一起
 * 念出来（对账用：送过去的条数与改动面条数必须对得上，不许静默截断）。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

/** 本模块所在目录 —— 定位同目录的 `affected-tests.mjs`（**不靠 cwd**，见下）。 */
const HERE = import.meta.dirname;

/**
 * 改动面清单（来自 `COMFY_AFFECTED_CHANGED`，换行或空格分隔）。
 *
 * 来源有两档：默认读**暂存区**（钩子里的常态），而平台那一跳
 * （`scripts/ci-affected-tests.mjs`）没有暂存区可读 —— 它手里是
 * 「这个 PR 改了什么」，从 `COMFY_AFFECTED_CHANGED` 传进来。
 * 走的是**同一条判决链**（`affected-tests.mjs`），不是第二份筛法：
 * 两处各自筛一遍的漂移是静默的，而这一档的红会拦推送。
 *
 * 转出给「拆小建议」那一格（`affected-launch-scope-advice.mjs`）：它要的是**同一份**
 * 改动面，只是拿去问另一个问题（每个改动文件各自拉进来多少份）。让那边自己再读一遍
 * 那个变量就是同一句判断的第二份副本 —— 漂开时那一段归因会静默变成恒空。
 *
 * @returns {string[]}
 */
export function changedFromEnv() {
  return (process.env.COMFY_AFFECTED_CHANGED ?? "")
    .split(/[\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 把改动面送给 `affected-tests.mjs` 的**载体**（stdin，不是 argv）。
 *
 * 落点用**模块自己的目录**而不是 `process.cwd()`：那份脚本与本模块同住 `scripts/`，
 * 定位它靠 cwd 就多一条「从哪跑就得到哪」的隐含前提（实测：从别的目录用绝对路径起
 * 这个启动器，cwd 那一条会让子进程去找一个不存在的脚本）。
 *
 * 转出（而不是另写一份）是为了让**第二跳调用方**也走同一个载体：拆小建议那一格
 * （`affected-launch-scope-advice.mjs`）问的是同一件事的另一个切面 —— 「每个改动文件
 * 各自拉进来多少份」。抄一份命令行形状就会在某一次改动里漂开（多一个旗标、少一层
 * encoding），而漂开的表现是那一格静默回到「拿不到归因」。
 *
 * @param {string[]} extra 子进程要额外带的旗标（如 `--attribute`）
 * @param {string[]} changed 改动面清单
 * @returns {{status: number|null, stdout: string, stderr: string, error?: Error}}
 */
export function spawnAffected(extra, changed) {
  return spawnSync(
    process.execPath,
    [
      path.join(HERE, "affected-tests.mjs"),
      ...extra,
      ...(changed.length > 0 ? ["--changed-stdin"] : []),
    ],
    {
      encoding: "utf8",
      ...(changed.length > 0 ? { input: changed.join("\n") } : {}),
    },
  );
}

/**
 * 清单那一跳失败时的那句话。
 *
 * 「起不来」与「跑起来但退非零」是两件事：前者是门禁自己没跑起来（ISSUE #2240 那次
 * 红的就是它），后者是判红。两者的处置完全不同，而早先只念一句「退出码 信号」——
 * 平台上分不出是「清单太长、子进程没起来」还是「清单算出来是红的」。
 *
 * 条数也要一起念出来（对账用：送过去的条数与改动面条数必须对得上，不许静默截断）。
 *
 * @param {{status?: number|null, error?: {code?: string, message?: string}|null, changedCount?: number}} input
 * @returns {string}
 */
export function describeListFailure({
  status = null,
  error = null,
  changedCount = 0,
} = {}) {
  const why = error
    ? `子进程起不来（${`${error.code ?? ""} ${error.message ?? ""}`.trim()}）`
    : `退出码 ${status ?? "信号"}`;
  return `[affected-launch] 清单解析失败（${why}；改动面 ${changedCount} 条）`;
}

/**
 * 调 `affected-tests.mjs` 拿清单（它的 stdout 只有空格分隔的路径一行）。
 *
 * @returns {string[]} 该跑的用例文件
 */
export function collectList() {
  const changed = changedFromEnv();
  const res = spawnAffected([], changed);
  if (res.status !== 0) {
    process.stderr.write(res.stderr ?? "");
    throw new Error(
      describeListFailure({
        status: res.status,
        error: res.error,
        changedCount: changed.length,
      }),
    );
  }
  // 清单脚本自己的说明走 stderr，stdout 只有那一行路径；按空白切最稳。
  return String(res.stdout ?? "")
    .split(/\s+/)
    .filter(Boolean);
}
