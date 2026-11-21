/**
 * ship-exec.mjs — `pnpm ship` 的**效应适配层**：外部命令怎么真起得来、JSON 怎么取、
 * 一次性临时文件落在哪儿。
 *
 * ── 为什么单独一件 ─────────────────────────────────────────────
 *
 * `ship.mjs` 里那条编排（读状态 → 调 git / cnb → 打印）与本层是两种变化方向：
 * 本层只因**宿主**而变（Windows 垫片、argv 上限、git 目录解析、stderr 要不要接），
 * 编排只因**流程**而变（加一段、改判据出处）。混在一份里时，每加一个阶段都要
 * 在同一个 900 行硬闸下重排一次，而宿主那几处最容易动的注释恰恰是编排不该
 * 跟着改的。拆开之后，编排入口只 import 本层，本层不认识任何阶段名。
 *
 * ⚠️ 本层唯一的**判断**是「取不到 ⇒ 回 null」，且每一处 null 都交给调用方按
 * `CODE.NOT_RUN` 处理 —— 「没拿到测量」与「测量结果是红的」是两件事（三态退出码，
 * 见 `ship.mjs` 文件头第 2 条纪律）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { gitScratchPath, resolveGitDir } from "../lib/git-dir.mjs";
import { pnpmInvocation, runGateStep } from "../launcher-core/shell.mjs";
/* push 预算的判据只有一份出处：钩子那侧的复算预算解析器（ISSUE #4753）。
 * ship 不重抄一份「怎么读 COMFY_PREMERGE_TIMEOUT_MS」—— 抄了就会漂。 */
import { recomputeTimeoutMs } from "../gates/premerge-proof.mjs";

/**
 * 一次外部命令的结果。`stderr` 是**必需**字段，不是可选（见 `makeRunner`）。
 *
 * @typedef {Object} ExecResult
 * @property {number} status 退出码；取不到时为 -1
 * @property {string} stdout 标准输出原文
 * @property {string} stderr 标准错误原文
 * @property {string | null} error spawn 层错误码（如 `ENOENT`），没有时为 null
 */

/**
 * 把 `cnb <args>` 解析成「这一族真正起得来的形态」。
 *
 * ⚠️ Windows 上 `cnb` 是 pnpm 全局目录里的三个垫片：无扩展名那份 node 不认
 * （ENOENT）、`cnb.cmd` 在无 shell 下被 Node 直接拒（**EINVAL**，CVE-2021-22940
 * 那批修复的副作用）、没有 `cnb.exe`。而本仓刻意 `shell: false`
 * （`launcher-core/shell.mjs` 头注第 2 条：多一层 `cmd /C` 就多一层失败面）。
 * 所以「`spawnSync("cnb")` 失败」**不等于**「这台机器没有 cnb」——
 * 实测 `usableCommand("cnb").ok` 与 `commandInvocation("cnb")` 都会给出否，
 * 而同一时刻命令行里 `cnb` 好得很。
 *
 * 出路不是自己摸 PATH、更不是偷偷开 `shell: true`，而是走**已经为 pnpm 解决过
 * 同一件事的那份唯一实现**：`pnpmInvocation(args, {name})` —— 它把
 * `cnb.ps1` 经 PowerShell 宿主起起来（实测 `viaHost: true`，spawn 退 0）。
 * 那个 `name` 选项就是它通用的一面，别因为函数名里有 pnpm 就另写一份。
 *
 * @param {string[]} args cnb 参数
 * @returns {{command:string,args:string[]} | null} 起得来的形态；找不到命令时 null
 */
export function cnbSpawn(args) {
  const inv = pnpmInvocation(args, { name: "cnb" });
  return inv ? { command: inv.command, args: inv.args } : null;
}

/**
 * `git push` 预算里、罩住「复算之外」那部分的余量：pre-push 钩子先跑
 * `git lfs pre-push`（大文件走网络上传）再跑复算，git 自身的连接 / 协商也在这份
 * 余量里。它不必精确 —— 复算预算那半边本来就有量级余量 —— 只要不把「正常慢」
 * 读成「被砍」就行。不导出：只有 {@link pushBudgetMs} 用它（零消费导出会被
 * `check-dead-exports` 判）。
 */
const PUSH_BUDGET_HEADROOM_MS = 180_000;

/**
 * `git push` 那一跳的墙钟预算（ISSUE #4753）。
 *
 * push 会触发 pre-push 钩子里的**合并前复算**（分钟级：本机实测 84s ~ 5m35s，
 * 光 type-aware oxlint 一档就 97~134s；共享机上还能更慢）。此前 ship 的执行器
 * 给**所有**外部命令统一 180s 预算，复算一超过它，`spawnSync` 就把 `git push`
 * 连同钩子整棵砍掉 —— `status` 为 null、被 `?? -1` 读成「push 失败（exit -1）」，
 * 看起来像宿主杀进程，其实是 ship 自己的预算。所以 push 的预算**随复算预算走**：
 * 复算那侧抬了（`COMFY_PREMERGE_TIMEOUT_MS`），这侧自动跟着抬；默认
 * 600s（复算）+ 180s（LFS / 网络余量）。复算预算非法时钩子自己会退 2，这里
 * 回落默认即可 —— 不必替钩子猜。
 *
 * @param {Record<string, string | undefined>} [env] 环境变量（缺省读本进程的）
 * @returns {number} 毫秒
 */
export function pushBudgetMs(env = process.env) {
  const recompute = recomputeTimeoutMs(env?.COMFY_PREMERGE_TIMEOUT_MS);
  return (recompute ?? 600_000) + PUSH_BUDGET_HEADROOM_MS;
}

/**
 * 造一个「跑外部命令」的执行者（测试里整体替换掉）。
 *
 * ⚠️ **`stderr` 必须一起带回来**：`git commit` 被 pre-commit 拦下时，钩子把全部
 * 原因写在 **stderr** 上。第一版只接了 `stdout`，于是屏幕上只剩一句
 * 「提交被门槛拦下」而**一个理由都没有** —— 对一个职责就是「如实转述执行者」的
 * 工具，这是它能犯的最重的错。
 *
 * @param {string} cwd 工作目录
 * @returns {(cmd:string,args:string[],opts?:{env?:Record<string,string>,timeoutMs?:number})=>ExecResult}
 *   执行函数。第三个入参只用来**叠加**环境变量与按调用放宽墙钟预算
 *   （`git push` 那一跳带 {@link pushBudgetMs}，其余维持 180s），不是替换环境。
 */
export function makeRunner(cwd) {
  return (cmd, args, opts = {}) => {
    const inv = cmd === "cnb" ? cnbSpawn(args) : { command: cmd, args };
    if (!inv) {
      return {
        status: -1,
        stdout: "",
        stderr: "",
        error: "ENOENT",
      };
    }
    /* `opts.env` 是**叠加**而不是替换：换掉整个环境会把 PATH/HOME 一起带走，
     * 那会让一次「只想多带一个旗标」的调用变成另一件事（且失败形态是 ENOENT，看不出关系）。
     * 目前唯一的用处是给刻意空提交带 `COMFY_INTENTIONAL_EMPTY_COMMIT`（ISSUE #2354）。
     * 预算缺省 180s（ISSUE #4601）：cnb 是网络调用（含取日志 / 传正文的大包），挂死
     * 不再无限卡住 ship 链路；`git push` 那一跳由调用方按 {@link pushBudgetMs} 放宽
     * （ISSUE #4753），否则分钟级的 pre-push 复算会被这里砍成 exit -1。 */
    const r = runGateStep(inv.command, inv.args, {
      cwd,
      timeoutMs: opts.timeoutMs ?? 180_000,
      echo: false,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    // 这里刻意保留 ||：error.code 可能是空串，那时要念 error 本身。
    const err = r.error
      ? /** @type {Error & {code?:string}} */ (r.error).code || String(r.error)
      : null;
    return {
      status: r.status ?? -1,
      stdout: r.stdout || "",
      stderr: r.stderr || "",
      error: err,
    };
  };
}

/**
 * 从 `start-build` 的输出里读回构建号（`cnb-…`）。
 *
 * 「写动作成没成」只认回读到的对象，不认退出码：start-build 真起了一跑时，
 * 输出里必有一个 `sn`；起不成（403 / scope 不足那一族，ISSUE #2378 的现场）时
 * cnb 可能**照旧退 0** —— 把退出码 0 读成「发出去」正是让那条红静默的通道
 * （与 ISSUE #2436 的教训同源：退出码 0 既不许读成「写成功」）。取不到 ⇒ null，
 * 调用方按「没发出去」收（fail-closed：宁可红，不可放行）。
 *
 * @param {string} raw start-build 的 stdout + stderr 原文
 * @returns {string | null} 构建号；读不到时 null
 */
export function buildSnFromOutput(raw) {
  const m = /"?sn"?\s*[:=]\s*"?(?<buildNumber>cnb-[A-Za-z0-9-]+)"?/.exec(String(raw ?? ""));
  return m ? (m.groups?.buildNumber ?? null) : null;
}

/**
 * 跑一次 `cnb … -v` 并把 stdout 当 JSON 解析。
 *
 * 解析失败**返回 null 而不是抛**：调用方据此判「没跑起来」（`CODE.NOT_RUN`），
 * 而不是让它冒成一条栈 —— 栈会被读成「命令跑过且失败」，那正是这一族要避免的误读。
 *
 * @param {(cmd:string,args:string[])=>ExecResult} run 执行者
 * @param {string[]} args cnb 参数
 * @returns {{json:any,code:number,raw:string,stderr:string} | null} 解析结果；取不到时 null
 */
export function cnbJson(run, args) {
  const r = run("cnb", args);
  if (r.error === "ENOENT") {
    return null;
  }
  const text = r.stdout.trim();
  const at = text.indexOf("{");
  if (at === -1) {
    return null;
  }
  try {
    return {
      json: JSON.parse(text.slice(at)),
      code: r.status,
      raw: text,
      stderr: r.stderr || "",
    };
  } catch {
    return null;
  }
}

/**
 * 把一份「只给这一次调用用」的文本落到 git 目录里（机器本地、不入库），
 * 与 `comfy-premerge-proof.json` / `comfy-precommit-timing.jsonl` 同一户、同一理由。
 *
 * 取不到 git 目录时回 `null` —— 调用方据此**跳过**这一步，而不是往工作区里猜一个落点：
 * 落在工作区就得靠 `.gitignore` 兜，而「靠 gitignore 兜住的临时文件」正是
 * AGENTS 硬规则 12 点名的那一族（`MERGE_MSG` / `COMMIT_EDITMSG` 落进工作区
 * 只说明「用 `-F` 写提交说明、提交完忘了删」）。
 *
 * @param {string} root 仓库根
 * @param {string} name 临时文件名前缀
 * @param {string} text 内容
 * @param {(cwd?:string)=>string | null} [resolve] git 目录解析器（测试可注入）
 * @returns {string | null} 写出的绝对路径；没有落点时 null
 */
export function writeScratch(root, name, text, resolve = resolveGitDir) {
  const dir = gitScratchPath(root, "comfy-ship-tmp", resolve);
  if (!dir) {
    return null;
  }
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}-${process.pid}.tmp`);
  fs.writeFileSync(p, text, "utf8");
  return p;
}

/**
 * @param {string} root 仓库根
 * @param {string} rel 相对路径
 * @returns {string} 内容；读不到回空串
 */
export function safeRead(root, rel) {
  try {
    return fs.readFileSync(path.resolve(root, rel), "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {string | undefined} s 长串
 * @returns {string} 前 8 位或占位
 */
export function short(s) {
  return s ? String(s).slice(0, 8) : "?";
}
