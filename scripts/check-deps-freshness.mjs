#!/usr/bin/env node
/**
 * check-deps-freshness.mjs —— 「远端改了库的版本，本地还在旧的上面干活」判据（ISSUE #1569）。
 *
 * 补的是这样一条**没有执行者**的纪律：远端 master 上别人升过依赖
 * （`package.json` 的版本声明 / `pnpm-lock.yaml` 的解析结果 / `pnpm-workspace.yaml`
 * 的 install 配置），而本地检出还停在旧的那一套上 —— 于是 AI（或人）在旧依赖树上
 * 改代码、跑门禁，结论看起来一切正常，其实判据的版本已经不是远端那份了。
 *
 * 为什么「没人想起来」这件事必须机器化：知识本身**早就写下来了**
 * （`docs/guides/sync-after-pull.md` 整篇在讲「拉取更新后本地还要做什么」），
 * 但「想起来去读它」没有任何东西在守 —— 同 §11.12 反复点名的那一族：
 * **比红更糟的是静默跳过，红会挡住提交，静默跳过什么都不会说。**
 *
 * ## 三层各自独立，别合并
 *
 * | 层                | 比较对象                                                  | 漂移的含义                         |
 * | ----------------- | --------------------------------------------------------- | ---------------------------------- |
 * | ① 远端引用新鲜度  | `refs/remotes/origin/master` 自己的 reflog 时间            | ② 可信不可信（**不是**「你落后了」）|
 * | ② 基线依赖 ⇄ 远端 | 分叉点（`merge-base`）的三份依赖文件 vs `origin/master` 的  | 你分叉之后远端改过依赖，基线是旧的 |
 * | ③ 依赖安装 ⇄ 本地 | 仓库 lockfile vs `node_modules/.pnpm/lock.yaml`           | 装了，但装的不是当前检出声明的那套 |
 *
 * ①**不判红**：远端引用陈旧只说明「这次校验看不见远端」，`git fetch` 就能解除；
 * 拿它阻断提交等于让离线 / 久未 fetch 的检出寸步难行。但它**不许被静默吞掉** ——
 * 话术里出现「已最新」是禁止的（同 `check-dependency-audit.mjs` 的「未扫描」口径：
 * 把「没看」与「看了且没有」在输出形态上分开），脚本打的是 `[未校验]`。
 *
 * ## 刻意不做的事（都写在判据旁边，防止「顺手加一点」）
 *
 * · **绝不 `git fetch`**：这是网络请求。塞进每次提交会把「离线 / 远端抖动 / 鉴权
 *   过期」变成提交失败 —— 与 `check-dependency-audit.mjs` 不进钩子是同一条理由
 *   （§13.5.4 的成本判据）。要刷新远端引用是**人**的动作：`git fetch`。
 * · **不判「本地 HEAD 落后几个提交」**：那件事与依赖无关，落后 20 个前端提交而依赖
 *   一字未动是常态，拿它报警会把这条判据淹掉。这里只判**依赖面**的实质差异。
 * · **② 的基准是分叉点，不是 `origin/master`**:拿 `origin/master` 直接比工作区，
 *   在「你在 PR 分支上自己加了依赖」这种**正常**工作流里会反向误报（远端没有你新加的
 *   包 ⇒ 报成「远端改过依赖」）。真正要问的是「**我分叉之后，远端在依赖面上前进过吗**」,
 *   所以基准取 `git merge-base HEAD origin/master` —— 分叉点。自己的工作区改动不进 ②
 *   （那是你自己的改动,不是「忘了同步」）。
 * · **不重写 lockfile 比对**：`diffLockfiles` + `renderLockDiff`（`scripts/lockfile/`）
 *   与 `lockfileDrift`（`launcher-core/worktree.mjs`）都是既有实现，直接 import
 *   —— §12.18 的第一种现场，不在调用点重抄一份。
 *
 * ## 谁在什么时候跑它（这一条不写清，判据就等于没有执行者）
 *
 * | 场景                                   | 形态                              | 判什么 |
 * | -------------------------------------- | --------------------------------- | ------ |
 * | 本次提交**动了依赖面**（钩子）          | `--staged`（D 组）                | ② + ③，任一命中即阻断 |
 * | 本次提交没碰依赖面（钩子）              | `--staged` 的未触发分支            | 立刻退 0、零输出（不给无关提交加时间）|
 * | AI / 人开工前、PR 评审前（**主场景**） | 无参数（`pnpm check:deps-freshness`）| ② + ③ 全判 |
 * | 完整验证那一档                          | `pnpm check:all`（quality-gate）  | 全判 |
 *
 * 为什么钩子这档**只判「动了依赖面」的提交**：在分支上开发时本地 HEAD 与
 * `origin/master` 不同步是**常态**（PR 流程本来就该如此），每次提交都拿它拦人 =
 * 一条天天红的闸，人只会去 skip 它。而「**你自己刚改过依赖**」这件事不一样 ——
 * 那时「我的基线是不是旧的」是**必须回答**的问题（否则你会在旧依赖上解得冲突、
 * 或把一份基于旧基线的 lockfile 推上去），判它才是把闸放在真要出血的地方。
 *
 * 用法：
 *   node scripts/check-deps-freshness.mjs             # 判定（AI 开工前 / 按需召唤）
 *   node scripts/check-deps-freshness.mjs --staged    # 仅当暂存改了依赖面才判定（钩子用）
 *   node scripts/check-deps-freshness.mjs --json      # 出结构化结论（排障 / 自检用）
 *   node scripts/check-deps-freshness.mjs --offline   # 只判 ③（不读 git）——没远端也能跑
 *   node scripts/check-deps-freshness.mjs --root <p>  # 判指定检出（排障 / 契约自测）
 *
 * 退出码：0 = 依赖与远端一致（或未触发 / 远端不可知但本地自身自洽）；
 *         1 = 有漂移（②/③ 任一命中，各自的出口逐条打印）；
 *         2 = 判据坏了（git 调不通这类**环境**故障，不是业务结论）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { diffLockfiles, isEmptyDiff } from "./lockfile/lock-diff.mjs";
import { renderLockDiff } from "./lockfile/render-lock-diff.mjs";
import { lockfileDrift } from "./launcher-core/worktree.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 「远端引用还算新鲜」的宽限期（毫秒）。
 *
 * 取 7 天：本仓的节奏是「开工前 fetch 一次」，而周末 / 休假之后回来时没人会先
 * fetch 再开工 —— 拿几小时去报警，报的只会是「你昨天没 fetch」，这正是把判据淹成
 * 噪音的标准姿势。**这个数字不判红**（见文件头的 ①），它只决定 ② 的话术是
 * 「已核对远端」还是「未校验远端」，所以宽严的代价只是提示质量，不是阻断。
 */
export const REMOTE_REF_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 依赖面的三个输入文件 —— 「动了它就得回答『基线是不是旧的』」的那一份清单。
 *
 * 三个各自不可替代：`package.json` 是版本声明、`pnpm-lock.yaml` 是解析结果、
 * `pnpm-workspace.yaml` 是安装规则（`allowBuilds` / `overrides` 变了，同一份 lockfile
 * 装出来的东西都可能不同）。别按「有没有改 lockfile」一刀切 —— 远端只改
 * `allowBuilds` 那一档正是最容易被漏掉的。
 */
export const DEPENDENCY_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
];

/**
 * 暂存改动是否命中依赖面（`--staged` 的触发面）。
 *
 * 与 `check-docs-api.cjs --staged` 的 `INPUT_RES` **刻意不共用**：那份问的是
 * 「typedoc 产物的输入面变没变」（含 `src/lib|server|trpc/**`），本函数问的是
 * 「依赖声明变没变」——两者恰好都含 `package.json`，但集合与语义都不同，合并会
 * 让任意一侧的收窄静默改变另一侧的行为（§12.12 的反面：不是字面相同就该合并）。
 * @param {string[]} files 相对仓库根、正斜杠
 * @returns {string[]} 命中的文件（空数组 = 不触发）
 */
export function matchedDependencyFiles(files) {
  const set = new Set(DEPENDENCY_FILES);
  return files.filter((f) => set.has(f));
}

/** 读暂存区文件清单（`--staged` 用）。拿不到时返回 `null` = 未触发，不猜。 */
function stagedFiles(root) {
  const r = git(["diff", "--cached", "--name-only"], root);
  if (!r.ok) return null;
  return r.out.split(/\r?\n/).filter(Boolean);
}

/** 默认比对的远端引用（用 `origin/master` 而不是「跟踪分支」：本地分支名各异）。 */
export const DEFAULT_REMOTE_REV = "origin/master";

/** 跑一次 git，返回 `{ ok, out }`（`ok=false` = 命令不可用或非零退出）。 */
function git(args, cwd) {
  const res = spawnSync("git", args, {
    cwd: cwd ?? ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (res.error || res.status !== 0) return { ok: false, out: "" };
  return { ok: true, out: res.stdout ?? "" };
}

/**
 * 本地检出的 gitdir —— 支持 worktree（`.git` 是文件、里面写着 `gitdir: ...`）。
 *
 * 不拼死 `.git/...` 的原因：本仓的开发流程里 `git worktree add` 是常态
 * （§13.6.2 让每个人在干净基线上复算门禁就是这么做的），而 worktree 里 `.git`
 * 是一个**文本文件**。拼死路径的表现是「远端引用永远不可知」—— 一条永远走不
 * 进去的判据。
 * @returns {string} gitdir 绝对路径（读不出时退回 `<root>/.git`，由调用方判可用性）
 */
export function resolveGitDir(root) {
  const dotGit = path.join(root, ".git");
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
    if (m) {
      const target = m[1].trim();
      return path.isAbsolute(target) ? target : path.resolve(root, target);
    }
  } catch {
    /* 掉到下面的兜底 */
  }
  return dotGit;
}

/**
 * 远端引用（`origin/<branch>`）的取证时间 —— **以它自己的 reflog 为准**。
 *
 * 为什么不用 `FETCH_HEAD` 的 mtime：那是**上一次 fetch 任何 ref** 的时间（含
 * `git fetch --all`、含只是看看别人的分支），与「`origin/master` 这个引用是什么时候
 * 更新的」不是同一件事。`.git/logs/refs/remotes/origin/<branch>` 是**那个引用自己**
 * 被移动时写的，正是我们要问的问题（同 §13.5.12 的教训：一份看着正常的记录，
 * 指的却是另一件事）。
 *
 * 拿不到（`core.logAllRefUpdates=false`、浅克隆、或引用由 `git clone` 一次写死后
 * 从未再动）返回 `null` = **不可知**，调用方按「未校验」处理 —— 不许拿「文件在」
 * 当「引用新鲜」。
 * @returns {number | null} epoch 毫秒；null = 不可知
 */
export function remoteRefTimestamp(root, branch = "master") {
  const log = path.join(
    resolveGitDir(root),
    "logs",
    "refs",
    "remotes",
    "origin",
    branch,
  );
  try {
    return fs.statSync(log).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * 读某个 rev 上的一个文件（`git show <rev>:<path>`）；不存在返回 `null`。
 *
 * `null`（这个 rev 上没这个文件）与空串（文件存在但空）是两件事：前者是
 * 「新增 / 被删」，正是依赖变更的信号之一。合并成一个值会让「远端新增了
 * `pnpm-workspace.yaml`」这种真变更读成「无差异」。
 * @returns {string | null}
 */
export function readAtRev(rev, rel, cwd = ROOT) {
  const r = git(["show", `${rev}:${rel}`], cwd);
  return r.ok ? r.out : null;
}

/**
 * 分叉点：**你自己的分支是从哪一个提交分出来的**。
 *
 * 这是判据 ② 的基准。拿 `origin/master` 直接比工作区看着更简单，但在「你在 PR 分支上
 * 自己加了依赖」这种**正常**工作流里会反向误报（远端没有你新加的包 ⇒ 报成「远端改过
 * 依赖」）。真正要问的是「我分叉之后，远端在依赖面上前进过吗」，所以基准取分叉点。
 *
 * 形态各自有意义，不许合并成一个「null」：
 *   · 有分叉点 ⇒ 拿它比（常态）；
 *   · 本地 HEAD **就是** `origin/master` 或在其之前（`merge-base == HEAD`）⇒ 分叉点
 *     就是 HEAD，比出来的是「远端相对你前进的全部依赖改动」，同样成立；
 *   · **HEAD 是已把远端收进来的合并提交**（下面详述）⇒ 返回 `null`，②这一层不判；
 *   · 无共同祖先 / 拿不到 ⇒ 返回 `null`，调用方按「未校验」处理
 *     （**不是**「无差异」——那会把「查不了」读成「没问题」）。
 *
 * **合并提交为什么要单列一态**：`git merge origin/master` 之后，`merge-base HEAD
 * origin/master` 仍然是**合并前那个分叉点**（合并只是多了一个父提交，不移动分叉点）。
 * 于是「分叉点 vs 远端」必然报「远端改过依赖」，**哪怕远端那些改动已经被这次合并
 * 完整收进了工作区** —— 解冲突的人正是这么拿到红的：他把 master 合了进来、依赖面
 * 与远端逐字一致，判据却说他「在旧的那一套上干活」。出口给的是「把 origin/master
 * 合并进来」，而他刚做完那件事，形成死循环。
 *
 * 判据真正要问的是「**我分叉之后，远端在依赖面上前进过吗**」。合并把远端收进来之后，
 * 那个问题的答案已经变成「没有待同步的东西了」——所以这一态**不是**「没查到」，
 * 是「没什么要查」。调用方据此把 ② 跳过（`remoteDrifts` 为空），而 ①（引用新鲜度）
 * 与 ③（本地自身自洽）照旧各判各的，判据并没有因此变成一句空话。
 *
 * 怎么认这一态：远端 rev 是 HEAD 的**祖先**（`merge-base --is-ancestor`）⇒ 远端
 * 已经在我的历史里了。这在「HEAD == origin/master」时也成立，但那一种由上面第二条
 * 覆盖（分叉点就是 HEAD，比出来同样成立），两条不冲突、谁先命中都给出正确结果。
 * @returns {string | null}
 */
export function forkPoint(root, remoteRev = DEFAULT_REMOTE_REV) {
  // 远端已在 HEAD 的历史里（典型：刚把它 merge 进来）⇒ ② 没有可比的对象。
  const contained = git(["merge-base", "--is-ancestor", remoteRev, "HEAD"], root);
  if (contained.ok) return null;
  // **合并已解完、提交还没落地**（`MERGE_HEAD` 在场）：HEAD 仍是合并前那个提交，
  // 上面那条 `--is-ancestor` 因此看不到「远端已经进来了」，而 `merge-base` 回的仍是
  // 合并前的分叉点 —— 于是解冲突的人会拿到一条**永远解不开**的红（出口让他把远端合并
  // 进来，而他刚做完那件事）。这不是「没查到」，是「没什么要查」：合并的第二个父提交
  // 就是远端，它一旦落地，② 立刻走上面那条路径。
  // 判的是**本次提交**是不是那个待落地的合并（`MERGE_HEAD`），不是「历史上merge过」。
  if (hasInProgressMerge(root)) return null;
  const r = git(["merge-base", "HEAD", remoteRev], root);
  return r.ok && r.out.trim() ? r.out.trim() : null;
}

/**
 * 本次提交是不是一个**待落地的合并提交**（`git merge` 已解完冲突、尚未 commit）。
 *
 * 判据是 `$GIT_DIR/MERGE_HEAD` 在场 —— 那是 git 自己在合并过程中写的状态文件，
 * 也是「`git commit` 将要产生的这次提交有两个父提交、且第二个就是被合并进来的
 * 那个 rev」的唯一权威信号。**不拿别的近似**：`git merge-base` 看不出来（HEAD
 * 还没动）、`--is-ancestor` 也看不出来（同上），而「暂存区里有 `package.json`」
 * 更是无关（自己改依赖也是这个形态）。
 *
 * `$GIT_DIR` 通过 `resolveGitDir()` 解析（`--git-dir` 之外还要认链接工作树里
 * `.git` 是个文件的情形，同 `remoteRefTimestamp` 那条路径的理由）。
 * @returns {boolean}
 */
export function hasInProgressMerge(root) {
  try {
    return fs.existsSync(path.join(resolveGitDir(root), "MERGE_HEAD"));
  } catch {
    /* 解析不出 git 目录 ⇒ 当作「不是合并提交」，② 照常按分叉点判（保守方向：
       宁可多判一次，不可把「查不了」读成「没问题」—— 同 `readAtRev` 的口径）。 */
    return false;
  }
}

/**
 * 判据 ②：**分叉点**的依赖面 vs 远端 rev 的依赖面。
 *
 * 报的是「你分叉之后，远端改过依赖」—— 也就是「你的基线是旧的」。自己的工作区
 * 改动不进这一层（那是你自己的事，不是「忘了同步」）。
 *
 * **为什么按文件逐个比、而不是只比 lockfile**：三个文件回答三个不同的问题
 * ——`package.json` 说「声明要什么」、`pnpm-lock.yaml` 说「实际解析到哪个版本」、
 * `pnpm-workspace.yaml` 说「按什么规则装」（`allowBuilds` / `overrides` 变了，
 * 同一份 lockfile 装出来的东西都可能不同）。只比 lockfile 的话，
 * 「远端只改了 `allowBuilds`」这一档会静默通过。
 *
 * lockfile 那一路**走实质 diff**（`diffLockfiles`）而不是字符串比：lockfile 里的
 * 注释、空行、条目顺序会随 pnpm 版本漂移，字符串比会把「同一份解析结果」报成大改动，
 * 而这条判据的每一次误报都会教人去 skip 它。
 * @param {string} root
 * @param {string} baseRev 分叉点
 * @param {string} remoteRev 远端引用
 * @returns {{ file: string, kind: string, detail: string[] }[]}
 */
export function detectRemoteDrift(
  root,
  baseRev,
  remoteRev = DEFAULT_REMOTE_REV,
) {
  const drifts = [];
  for (const rel of DEPENDENCY_FILES) {
    const baseText = readAtRev(baseRev, rel, root);
    const remoteText = readAtRev(remoteRev, rel, root);
    if (baseText === null && remoteText === null) continue;
    if (baseText !== null && remoteText === null) {
      drifts.push({
        file: rel,
        kind: `远端删除（你的基线上还有）`,
        detail: [],
      });
      continue;
    }
    if (baseText === null) {
      drifts.push({
        file: rel,
        kind: "远端新增（你的基线上没有这份文件）",
        detail: [],
      });
      continue;
    }
    if (remoteText === baseText) continue;
    if (rel !== "pnpm-lock.yaml") {
      drifts.push({ file: rel, kind: "远端改过内容", detail: [] });
      continue;
    }
    let diff = null;
    try {
      diff = diffLockfiles(baseText, remoteText);
    } catch {
      /* 任一侧坏到解析不了：退化成粗判「有差异」，但**不许**当成「一致」
       * ——那正是「命令没跑成被读成干净」那条老事故。 */
      drifts.push({
        file: rel,
        kind: "远端改过内容（且解析失败，只报差异不报明细）",
        detail: [],
      });
      continue;
    }
    if (isEmptyDiff(diff)) continue; // 只差注释 / 空行 / 顺序 —— 不算依赖变化
    drifts.push({
      file: rel,
      kind: "远端改过解析结果",
      detail: renderLockDiff(diff),
    });
  }
  return drifts;
}

/**
 * 判据 ③：仓库 lockfile vs 最近一次安装用的那份（包一层既有实现）。
 *
 * 三种非 `fresh` 各自有话说，不能都归成「不一致」：`no-install` 是「压根没装」、
 * `no-lockfile` 是「检出里没有 lockfile」—— 给错动作比不给更坏。
 * @returns {{ state: string, diff?: object } | null} null = 一致
 */
export function detectInstallDrift(root) {
  const drift = lockfileDrift(root);
  if (drift.state === "fresh") return null;
  return { state: drift.state, diff: drift.diff };
}

/** 把 ③ 的状态渲染成可行动的中文（每种形态给的是**不同的**动作）。 */
function renderInstallDrift(drift) {
  if (drift.state === "no-install") {
    return [
      "node_modules 里没有安装记录（缺 .pnpm/lock.yaml）—— 依赖还没装。",
      "出口：在项目根执行 pnpm install。",
    ];
  }
  if (drift.state === "no-lockfile") {
    return [
      "检出里找不到 pnpm-lock.yaml —— 检出可能不完整。",
      "出口：确认克隆完整（git status 看有没有缺失），必要时重新克隆。",
    ];
  }
  const lines = [
    "node_modules 装的不是你当前检出声明的那套依赖（拉取更新后没重装，或上次 install 被中断）。",
    "出口：在项目根执行 pnpm install。（dev server 正在跑时先关掉 —— 原生模块被进程锁住会让安装 EPERM 失败）",
  ];
  const body = drift.diff ? renderLockDiff(drift.diff) : [];
  if (body.length) {
    lines.push(
      "",
      "差异（仓库 pnpm-lock.yaml vs 最近一次安装时的 lockfile）：",
      ...body,
    );
  }
  return lines;
}

/**
 * 主流程：三层判完，返回结构化结论。
 *
 * 抽成纯函数（IO 只经入参 `root`）是为了让契约测试能直接喂形状：判据的输入是
 * 「一个仓库目录 + 它的 git 状态」，所以测试只需搭一个真 git 仓库，不必 mock 模块
 * （同 `shell-gate.mjs` 的 `runGate`）。
 * @param {string} root
 * @param {{ offline?: boolean, now?: number, rev?: string }} [opts]
 * @returns {{ code: number, remoteChecked: boolean, remoteAgeMs: number | null, remoteDrifts: object[], installDrift: object | null, lines: string[] }}
 */
export function runFreshnessCheck(root, opts = {}) {
  const rev = opts.rev ?? DEFAULT_REMOTE_REV;
  const now = opts.now ?? Date.now();
  const lines = [];

  if (
    !opts.offline &&
    !git(["rev-parse", "--verify", "--quiet", "HEAD"], root).ok
  ) {
    // 不是 git 仓库 / git 不可用：**环境故障，不是业务结论**，判 2。
    return {
      code: 2,
      remoteChecked: false,
      remoteAgeMs: null,
      remoteDrifts: [],
      installDrift: null,
      lines: [
        "拿不到 git 状态 —— 这里不是一个可信的检出，无法判断依赖是否与远端一致。",
      ],
    };
  }

  let remoteChecked = false;
  let remoteAgeMs = null;
  let remoteDrifts = [];
  /* 合并已解完、尚未落地（`MERGE_HEAD` 在场）：这一态**不是**「没查到」，
   * 是「没什么要查」—— 被合并进来的那个 rev 即将成为 HEAD 的第二个父提交，
   * ② 的那条比对在它落地后自然走 `--is-ancestor` 分支。见 `forkPoint` 的说明。 */
  const merging = !opts.offline && hasInProgressMerge(root);
  if (
    !opts.offline &&
    !merging &&
    git(["rev-parse", "--verify", "--quiet", rev], root).ok
  ) {
    const stamp = remoteRefTimestamp(root, rev.replace(/^origin\//, ""));
    remoteAgeMs = stamp === null ? null : Math.max(0, now - stamp);
    remoteChecked = remoteAgeMs !== null;
    const base = forkPoint(root, rev);
    // 分叉点拿不到 ⇒ ② 这一层**不判**（不是「无差异」）。`remoteChecked` 保持
    // 由 reflog 决定：两者的含义不同，一个是「② 可信不」，一个是「② 能不能做」。
    if (base) remoteDrifts = detectRemoteDrift(root, base, rev);
    else remoteChecked = false;
  }

  // ③：本地自身的一致性，与远端无关，任何环境都判。
  const installDrift = detectInstallDrift(root);

  if (opts.offline) {
    lines.push(
      "[未校验] --offline：本次没有核对远端依赖（只看本地自身是否自洽）。",
    );
  } else if (merging) {
    /* 这一行**不能**复用下面那句 `[未校验]` —— 那是「没看」，这是「远端已经在
     * 本次合并里」，两者读起来正好相反。 */
    lines.push(
      `[已合并] 本次是一个待落地的合并提交（MERGE_HEAD 在场）—— ${rev} 即将成为它的第二个父提交，`,
      "         ② （基线依赖 ⇄ 远端）这一层没有待同步的对象：远端那份依赖面就在这次合并里。",
      "         合并落地之后 ② 走 `--is-ancestor` 那条路径（见 scripts/check-deps-freshness.mjs 的 forkPoint）。",
    );
  } else if (!remoteChecked) {
    lines.push(
      "[未校验] 没有可用的远端引用 / 拿不到分叉点 / 它没有取证时间（没 fetch 过 / 浅克隆 / 无远端）。",
      "         本次**没有**核对远端是否改过依赖 —— 这一行不许被读成「远端就是最新」。",
      "         要核对就先执行 git fetch（判据自身不做网络请求）。",
    );
  } else {
    const age = remoteAgeMs ?? 0;
    const hours = Math.round(age / (60 * 60 * 1000));
    const graceDays = REMOTE_REF_GRACE_MS / (24 * 60 * 60 * 1000);
    lines.push(
      age > REMOTE_REF_GRACE_MS
        ? `[未校验] 远端引用已 ${hours} 小时没更新（超过 ${graceDays} 天宽限）——下面的比对可能看不见远端的新提交。先 git fetch 再跑一次更可靠。`
        : `[已核对] 远端引用距今 ${hours} 小时。`,
    );
  }

  if (remoteDrifts.length) {
    lines.push(
      "",
      `你分叉之后，远端（${rev}）改过依赖 —— 你的基线是旧的那一套：`,
    );
    for (const d of remoteDrifts) {
      lines.push(`  · ${d.file}：${d.kind}`);
      for (const l of d.detail) lines.push(`  ${l}`);
    }
    lines.push(
      "",
      "出口：git pull（或把 origin/master 合并进来）→ 在项目根执行 pnpm install → 重跑一次本判据。",
      "完整背景与「什么时候要删 node_modules 重装」见 docs/guides/sync-after-pull.md。",
    );
  }

  if (installDrift) {
    lines.push("", "本地依赖与当前检出的声明不一致：");
    for (const l of renderInstallDrift(installDrift)) lines.push(`  ${l}`);
  }

  const code = remoteDrifts.length || installDrift ? 1 : 0;
  if (code === 0) {
    lines.push(
      remoteChecked
        ? "依赖与远端一致、本地安装也自洽。"
        : merging
          ? "本地安装自洽；远端那份依赖面已在本次合并里（见上）。"
          : "本地安装自洽（远端未校验，见上）。",
    );
  }
  return {
    code,
    remoteChecked,
    remoteAgeMs,
    remoteDrifts,
    installDrift,
    lines,
  };
}

/* ── CLI ─────────────────────────────────────────────────────── */

function main() {
  // `--root <path>`：给排障 / 契约自测用（默认就是本脚本所在的检出）。
  // 收在这里而不是让调用方 `cd`，因为「判据扫的是哪个检出」必须显式可见。
  const rootArg = process.argv.indexOf("--root");
  const root =
    rootArg !== -1 && process.argv[rootArg + 1]
      ? path.resolve(process.argv[rootArg + 1])
      : ROOT;

  // `--staged`：钩子那一档。未命中依赖面就**立刻退 0、零输出** —— 不给
  // 「只是改了别的文件」的提交加任何时间，也不增加一行噪声。
  if (process.argv.includes("--staged")) {
    const files = stagedFiles(root);
    const hit = files === null ? [] : matchedDependencyFiles(files);
    if (hit.length === 0) return 0;
    process.stdout.write(
      `本次提交动了依赖面（${hit.join(" / ")}）—— 判定你的基线是不是旧的：\n`,
    );
  }

  const result = runFreshnessCheck(root, {
    offline: process.argv.includes("--offline"),
  });
  if (process.argv.includes("--json")) {
    process.stdout.write(
      JSON.stringify(
        {
          code: result.code,
          remoteChecked: result.remoteChecked,
          remoteAgeMs: result.remoteAgeMs,
          remoteDrifts: result.remoteDrifts.map((d) => ({
            file: d.file,
            kind: d.kind,
          })),
          installDrift: result.installDrift
            ? { state: result.installDrift.state }
            : null,
        },
        null,
        2,
      ) + "\n",
    );
    return result.code;
  }
  process.stdout.write(
    `${result.code === 0 ? "[deps-freshness] OK" : "[deps-freshness] 有漂移"}\n`,
  );
  for (const l of result.lines) process.stdout.write(`${l}\n`);
  return result.code;
}

// 只在被直接运行时执行 CLI（被 import 时不跑）。
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
