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
 * | ① 远端引用新鲜度  | 那条远端引用**自己的 reflog** 时间（引用名现算，见下）      | ② 可信不可信（**不是**「你落后了」）|
 * | ② 基线依赖 ⇄ 远端 | 分叉点（`merge-base`）的三份依赖文件 vs 那条引用的         | 你分叉之后远端改过依赖，基线是旧的 |
 * | ③ 依赖安装 ⇄ 本地 | 仓库 lockfile vs `node_modules/.pnpm/lock.yaml`           | 装了，但装的不是当前检出声明的那套 |
 *
 * ③ 由两块拼成，因为它们**对不上时是两种病**（ISSUE #1721）：文本层（上面那格）判
 * 「你的安装记录与声明对得上吗」，解析层（`unresolvableDeclaredDeps`）判「声明里的包
 * 在这棵树上解析得到吗」。只有文本层会漏掉立案现场 —— 本地依赖树停在装某个新直接依赖
 * **之前**时，两份 lockfile 可以逐字对得上，而 `tsc` / `eslint` 报 `Cannot find module`。
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
 * 退出码（三态，与 `.githooks` / `base-check.mjs` 逐字同口径）：
 *   0 = 依赖与远端一致（或未触发 / 远端不可知但本地自身自洽）；
 *   1 = 有漂移（②/③ 任一命中，各自的出口逐条打印）；
 *   2 = **没跑起来**（git 调不通这类环境故障）——「没跑起来」排在红前面：
 *       环境不可信时红与绿都不构成结论，把它读成任一种都是拿一次故障冒充判决。
 *       ⚠️ 这一档**不顺带 return**：③（本地安装 ⇄ 本检出声明）与 git 无关，
 *       它照旧判、照旧打印 —— 早退会把「node_modules 没装」这类本地事实
 *       简化成一句「这里查不了」，而读者问的正是「我的依赖装对了吗」。
 *
 * 判的是**当前工作目录那个检出**（`--root` 显式覆盖）：不退回脚本所在仓库根，
 * 否则在任何别的目录里跑，读数都一样、且不会说出「你问的那个目录没被看过」。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { diffLockfiles, isEmptyDiff } from "./lockfile/lock-diff.mjs";
import { renderLockDiff } from "./lockfile/render-lock-diff.mjs";
import {
  lockfileDrift,
  unresolvableDeclaredDeps,
} from "./launcher-core/worktree.mjs";
import { DEPENDENCY_FILES } from "./dependency-face.mjs";
import { resolveGitDir } from "./git-dir.mjs";

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
 * 依赖面的三个输入文件收在 `dependency-face.mjs` 一处（本文件从它 import）。
 * 为什么抽出去：`check-allow-builds.cjs` 判「动了依赖面才扫全树」要的是**同一份清单**，
 * 从本文件 import 会把 `lockfile/lock-diff.mjs`、`launcher-core/worktree.mjs` 这条下游链
 * 一起拖进它的门禁自测沙箱；就地抄第二份的话，将来清单加第四项时那一侧静默漏判。
 */

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
  /* `-c core.quotePath=false`：路径要原样（ISSUE #2272，机制见 `scripts/changed-scope.mjs`
   * 的文件头「口径 ④」—— git 默认把非 ASCII 路径转义加引号，而机器之间还不一样）。 */
  const r = git(
    ["-c", "core.quotePath=false", "diff", "--cached", "--name-only"],
    root,
  );
  if (!r.ok) return null;
  return r.out.split(/\r?\n/).filter(Boolean);
}

/** 默认比对的远端引用（**只是兜底**：真实取法见 `resolveRemoteMasterRev()`）。 */
export const DEFAULT_REMOTE_REV = "origin/master";

/**
 * 要比对的那条远端引用 —— **不假定远端叫 `origin`**（审查台账 R12-01）。
 *
 * 本仓的远端实测叫 `cnb`，而此前这一格写死 `origin/master`：在本检出上恒「没有可用的远端
 * 引用」⇒ AGENTS 硬规则 25 的执行者在这份检出里**恒不判**（它降级得很诚实，报 `[未校验]`
 * 也不阻断，但承诺的能力为空）。同一族的正确答案在 `scripts/base-check.mjs` 里早就有
 * （「remote 名随克隆方式变」），但那一份回答的是「要并进哪条 master」；这里问的是
 * 「上次 fetch 看到的是哪条」，所以按引用本身现算而不是拿它的函数：
 *
 *   · 列 `refs/remotes/**`，取以 `/<branch>` 结尾的那些；
 *   · `origin/master` 在场时仍优先它（既有语义与夹具都按它写）；否则按名字取第一条；
 *   · 一个都没有 ⇒ `null`，调用方照旧走「未校验」。
 *
 * 用 `for-each-ref` 而不是 `git remote`：夹具与浅检出里可能**只有引用没有 remote 配置**
 * （现有用例就是这么造的：`update-ref refs/remotes/origin/master`），按 remote 列会把它判成没远端。
 *
 * @param {string} root
 * @param {string} [branch]
 * @returns {string | null} 形如 `cnb/master`；`null` = 没有任何可用的远端跟踪引用
 */
export function resolveRemoteMasterRev(root, branch = "master") {
  const res = git(
    ["for-each-ref", "--format=%(refname:lstrip=2)", "refs/remotes/"],
    root,
  );
  if (!res.ok) return null;
  const names = res.out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith(`/${branch}`));
  if (names.length === 0) return null;
  const preferred = names.find((s) => s === `origin/${branch}`);
  return preferred ?? [...names].sort()[0];
}

/**
 * 跑一次 git，返回 `{ ok, out }`（`ok=false` = 命令不可用或非零退出）。
 *
 * ⚠️ **不传 `cwd` 时不许退回本模块所在的检出**：那是「判据查哪个检出」的一处
 * 静默替换 —— 拿一个空目录来问「我的依赖装对了吗」，答案变成了「仓库根那份」，
 * 于是 `/tmp/xyz` 上的读数与 `/workspace` 上的读数长得一模一样，
 * 而"没跑起来"这件事一个字都不出现。**取不到 cwd 就是取不到**：
 * 回 `ok=false`，调用方据此把这一层判成「没跑起来」。
 */
function git(args, cwd) {
  if (typeof cwd !== "string" || cwd === "") return { ok: false, out: "" };
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (res.error || res.status !== 0) return { ok: false, out: "" };
  return { ok: true, out: res.stdout ?? "" };
}

/**
 * 本地检出的 gitdir 解析统一收口到 `scripts/git-dir.mjs`（ISSUE #2072）：那里认
 * worktree 里 `.git` 是个文件、并直接给 `git rev-parse --absolute-git-dir` 的真身。
 * 本文件不再持第二份实现（旧实现还退回 `<root>/.git` 字面量，在 worktree 上指向
 * 那个文件，远端引用永远查不到）。
 */

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
export function remoteRefTimestamp(root, rev = DEFAULT_REMOTE_REV) {
  /* 引用名里 remote 与 branch 的分界在**最后一个** `/`：`cnb/master` → remote=`cnb`、
   * branch=`master`；`origin/release/1.2` → remote=`origin`、branch=`release/1.2`
   * （reflog 的落点就是 `logs/refs/remotes/<remote>/<branch>`，分支名带斜杠时是目录嵌套）。
   * 旧实现按「去掉 `origin/` 前缀」算 branch，于是 `cnb/master` 会被拼成
   * `logs/refs/remotes/origin/cnb/master` —— 永远取不到，正是 R12-01 那一格。 */
  const at = rev.lastIndexOf("/");
  const remote = at > 0 ? rev.slice(0, at) : "origin";
  const branch = at > 0 ? rev.slice(at + 1) : rev;
  const gitDir = resolveGitDir(root);
  if (!gitDir) return null; // 不在 git 检出里 ⇒ 远端引用不可知
  const log = path.join(gitDir, "logs", "refs", "remotes", remote, branch);
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
 * @param {string} rev 读哪个提交
 * @param {string} rel 仓库相对路径
 * @param {string} cwd 哪个检出（**必传**：不退回脚本所在的仓库根，理由见 `git()`）
 * @returns {string | null}
 */
export function readAtRev(rev, rel, cwd) {
  const r = git(["show", `${rev}:${rel}`], cwd);
  return r.ok ? r.out : null;
}

/**
 * 远端那条引用是否**已经在本地历史里**（`merge-base --is-ancestor <rev> HEAD`）。
 *
 * 一个结论只写一份（硬规则 24）：`forkPoint()` 用它决定「② 没有可比的对象」，
 * `runFreshnessCheck()` 用同一句决定「这是**判过了、没有待同步对象**，不是没看」。
 * 台账 R12-01 的验收点名的正是后一种形态 —— 此前 `forkPoint()` 里已经有这条判断，
 * 只是它把结论压进了 `null`，调用方分不出来，于是第二次写同一条 git 命令。
 *
 * @param {string} root
 * @param {string} rev
 * @returns {boolean} `true` = rev 是 HEAD 的祖先（或与 HEAD 同一个提交）
 */
export function isRemoteAncestorOfHead(root, rev) {
  return git(["merge-base", "--is-ancestor", rev, "HEAD"], root).ok;
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
  if (isRemoteAncestorOfHead(root, remoteRev)) return null;
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
    const gitDir = resolveGitDir(root);
    return gitDir ? fs.existsSync(path.join(gitDir, "MERGE_HEAD")) : false;
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
    let diff;
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
 * 判据 ③：仓库 lockfile vs 最近一次安装用的那份（包一层既有实现），再叠一层
 * **声明依赖可解析吗**（ISSUE #1721）。
 *
 * 两件事都得说，因为它们是**两种病、两种动作**：
 *   · lockfile 漂移 —— 两份文本对不上（拉取更新后没重装，或上次 install 被中断）；
 *   · 解析失败 —— 文本可能**逐字对得上**，而某个被声明的包在这棵树上解析不到。
 *
 * 只有前者会漏掉立案现场那一种：本地依赖树停在**装某个新直接依赖之前**，那个包只以
 * 传递依赖的旧版本落在**包自己的私有层**里 —— 两份 lockfile 实质一致（③ 判绿）、
 * 启动器的关键依赖（typescript / next）也都在（`brokenKeyDeps` 判绿），
 * 而 `tsc` / `eslint` 报 `Cannot find module`。
 *
 * 三种非 `fresh` 各自有话说，不能都归成「不一致」：`no-install` 是「压根没装」、
 * `no-lockfile` 是「检出里没有 lockfile」—— 给错动作比不给更坏。
 * @returns {{ state: string, diff?: object, unresolved?: string[] } | null} null = 一致
 */
export function detectInstallDrift(root) {
  const unresolved = unresolvableDeclaredDeps(root);
  const drift = lockfileDrift(root);
  if (drift.state === "fresh") {
    return unresolved.length ? { state: "unresolved", unresolved } : null;
  }
  return { state: drift.state, diff: drift.diff, unresolved };
}

/**
 * 把 ③ 的状态渲染成可行动的中文（每种形态给的是**不同的**动作）。
 *
 * `unresolved` 与 `drift` 是两种病，所以**分开说**：lockfile 对得上而解析不到时，
 * 只报「你的安装记录和声明对不上」是**错的**（它俩恰好对得上），会把人送去核对一份
 * 本来就对的文件。这一档要说的是「这个包在树里解析不到」，出口仍然是重装。
 */
function renderInstallDrift(drift) {
  if (drift.state === "no-install") {
    return [
      "node_modules 里没有安装记录（缺 .pnpm/lock.yaml）—— 依赖还没装。",
      /* 这一档刻意**不**提 `pnpm deps:guard`：「没有安装记录」与「本检出的应用服务在跑」
       * 不会同时成立（跑着的服务必然踩在一份装好的树上），在这里加一步是噪声。 */
      "出口：在项目根执行 pnpm install。",
    ];
  }
  if (drift.state === "unresolved") {
    return [
      `这些被声明的依赖在当前 node_modules 里**解析不到**：${drift.unresolved.join(" / ")}`,
      "它们可能只以**别的版本**存在（被某个包当传递依赖拖进来、落在包自己的私有层），",
      "而顶层既没有提升出来的那一份、也没有任何可解析路径 —— 表现是 tsc / eslint 报",
      "`Cannot find module`（TS2307），而两份 lockfile 其实是对得上的。",
      "出口：在项目根执行 pnpm install（动手前先 `pnpm deps:guard` —— 本检出的应用服务在跑时它会拦下：原生模块被进程锁住会让安装 EPERM 连锁失败，AGENTS 硬规则 9）。",
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
  ];
  if (drift.unresolved?.length) {
    lines.push(
      `同时这些依赖解析不到：${drift.unresolved.join(" / ")} —— 重装会一并解决。`,
    );
  }
  lines.push(
    "出口：在项目根执行 pnpm install（动手前先 `pnpm deps:guard` —— 本检出的应用服务在跑时它会拦下：原生模块被进程锁住会让安装 EPERM 连锁失败，AGENTS 硬规则 9）。",
  );
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
 * @returns {{ code: number, remoteChecked: boolean, remoteAgeMs: number | null, remoteDrifts: object[], installDrift: object | null, lines: string[], remoteRev?: string, remoteAlreadyContained?: boolean, envBroken?: boolean }}
 */
export function runFreshnessCheck(root, opts = {}) {
  /* 不写死 `origin/master`（R12-01）：远端名是每台克隆机的属性，按引用现算。
   * 显式传 `rev` 的调用方（钩子 / 用例）优先。 */
  const resolvedRev = resolveRemoteMasterRev(root);
  const rev = opts.rev ?? resolvedRev ?? DEFAULT_REMOTE_REV;
  const now = opts.now ?? Date.now();
  const lines = [];

  /* 不是 git 仓库 / git 不可用：**环境故障，不是业务结论**，这一趟判 2。
   * 但它**不许**把 ③ 一起吞掉 —— 判据没跑起来，与「本地那一层是对的」是两件事，
   * 混成一句话的读数是「这里查不了」，而读者问的是「我的依赖装对了吗」。 */
  const envBroken =
    !opts.offline &&
    !git(["rev-parse", "--verify", "--quiet", "HEAD"], root).ok;

  let remoteChecked = false;
  let remoteAgeMs = null;
  let remoteDrifts = [];
  /** 远端那条引用**已经在本地历史里**（不领先）⇒ ② 判过且无待同步对象，与「没看」分开的两态之一。 */
  let remoteAlreadyContained = false;
  /* 合并已解完、尚未落地（`MERGE_HEAD` 在场）：这一态**不是**「没查到」，
   * 是「没什么要查」—— 被合并进来的那个 rev 即将成为 HEAD 的第二个父提交，
   * ② 的那条比对在它落地后自然走 `--is-ancestor` 分支。见 `forkPoint` 的说明。 */
  const merging = !envBroken && !opts.offline && hasInProgressMerge(root);
  if (
    !envBroken &&
    !opts.offline &&
    !merging &&
    git(["rev-parse", "--verify", "--quiet", rev], root).ok
  ) {
    const stamp = remoteRefTimestamp(root, rev);
    remoteAgeMs = stamp === null ? null : Math.max(0, now - stamp);
    remoteChecked = remoteAgeMs !== null;
    const base = forkPoint(root, rev);
    /* `forkPoint()` 回 `null` 混着两种状态：真的算不出分叉点，与「这条远端引用已经在
     * 本地历史里」。后者是**判过了、没有待同步对象**，不是没看 —— 台账 R12-01 的验收
     * 点名的就是这个形态（远端不领先时不许回落成「未校验」，否则「没看」与「看了且没有」
     * 在输出上同形，而那正是本判据存在的理由）。 */
    const contained = !merging && isRemoteAncestorOfHead(root, rev);
    // 分叉点拿不到 ⇒ ② 这一层**不判**（不是「无差异」）。`remoteChecked` 保持
    // 由 reflog 决定：两者的含义不同，一个是「② 可信不」，一个是「② 能不能做」。
    if (base) remoteDrifts = detectRemoteDrift(root, base, rev);
    else if (contained) remoteAlreadyContained = true;
    else remoteChecked = false;
  }

  // ③：本地自身的一致性，与远端无关，任何环境都判。
  const installDrift = detectInstallDrift(root);

  if (envBroken) {
    /* 这一档**不许**顺手 return：③（本地安装 ⇄ 本检出声明）与 git 无关，任何环境都判
     * —— 早退会让「node_modules 没装」这类本地事实只剩一句「这里查不了」，
     * 而它恰恰是 ③ 唯一能回答的那件事。判据没跑起来这件事由退出码与这一行说清。 */
    lines.push(
      "[未校验] 拿不到 git 状态 —— 这里不是一个可信的检出，本次没有核对远端依赖（② 与 ① 都不判）。",
      "         这一行**不是**「依赖没问题」：本地安装那一层照旧判（见下）。",
    );
  } else if (opts.offline) {
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
    /* 「找的是哪条引用」要说实话：一个都没找到时 `rev` 只是兜底常量，
     * 报它的名字会让人以为判据比过一条并不存在的 `origin/master`。 */
    const revLabel =
      opts.rev || resolvedRev
        ? `本次找的是 \`${rev}\`（由 \`refs/remotes/**\` 里以 \`/master\` 结尾的引用现算）。`
        : "本次在 `refs/remotes/**` 里没找到任何以 `/master` 结尾的引用。";
    lines.push(
      "[未校验] 没有可用的远端引用 / 拿不到分叉点 / 它没有取证时间（没 fetch 过 / 浅克隆 / 无远端）。",
      `         ${revLabel} 远端名不假定叫 origin。`,
      "         本次**没有**核对远端是否改过依赖 —— 这一行不许被读成「远端就是最新」。",
      "         要核对就先执行 git fetch（判据自身不做网络请求）。",
    );
  } else {
    const age = remoteAgeMs ?? 0;
    const hours = Math.round(age / (60 * 60 * 1000));
    const graceDays = REMOTE_REF_GRACE_MS / (24 * 60 * 60 * 1000);
    lines.push(
      age > REMOTE_REF_GRACE_MS
        ? `[未校验] \`${rev}\` 这条引用已 ${hours} 小时没更新（超过 ${graceDays} 天宽限）——下面的比对可能看不见远端的新提交。先 git fetch 再跑一次更可靠。`
        : `[已核对] 比对的是 \`${rev}\`，它的 reflog 距今 ${hours} 小时。`,
    );
    if (remoteAlreadyContained) {
      lines.push(
        `         \`${rev}\` 已在本地历史里（不领先于 HEAD）⇒ ② 判过：没有待同步的远端依赖改动。`,
      );
    }
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
      `出口：git pull（或把 ${rev} 合并进来）→ \`pnpm deps:guard\` && pnpm install → 重跑一次本判据。`,
      "完整背景与「什么时候要删 node_modules 重装」见 docs/guides/sync-after-pull.md。",
    );
  }

  if (installDrift) {
    lines.push("", "本地依赖与当前检出的声明不一致：");
    for (const l of renderInstallDrift(installDrift)) lines.push(`  ${l}`);
  }

  /* 三态口径（与 `.githooks` 的三态一致）：0 绿 / 1 红 / 2 **没跑起来**。
   * 「没跑起来」排在红**前面** —— 环境不可信时，红与绿都不构成结论，把它读成
   * 任一种都是拿一次故障冒充判决。但它也不许把 ③ 的读数一起吞掉（那一层照旧打出来）。 */
  const code = envBroken ? 2 : remoteDrifts.length || installDrift ? 1 : 0;
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
    remoteRev: rev,
    remoteAlreadyContained,
    /** 环境不可信（拿不到 git 状态）—— ① ② 都没判，结论不成立。 */
    envBroken,
  };
}

/* ── CLI ─────────────────────────────────────────────────────── */

function main() {
  // `--root <path>`：给排障 / 契约自测用（默认就是本脚本所在的检出）。
  // 收在这里而不是让调用方 `cd`，因为「判据扫的是哪个检出」必须显式可见。
  const rootArg = process.argv.indexOf("--root");
  /* 判的是**当前工作目录那个检出**，不是本脚本所在的检出。
   * 此前这里退回 `ROOT`（= 脚本所在仓库根）⇒ 在任何别的目录里跑，读数与仓库根
   * 一模一样、且**一个字都不说**：拿一个空目录问「我的依赖装对了吗」，答案变成了
   * 「仓库根那份」，而「你问的那个目录根本没被看过」这件事从不出现。
   * 钩子与 `pnpm check:deps-freshness` 都在仓库根执行，那条路不受影响。 */
  const root =
    rootArg !== -1 && process.argv[rootArg + 1]
      ? path.resolve(process.argv[rootArg + 1])
      : process.cwd();

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
            ? {
                state: result.installDrift.state,
                unresolved: result.installDrift.unresolved ?? [],
              }
            : null,
          /* 环境不可信时 ①② 都没判 —— 结构化读数里也必须有这一格，
           * 否则 `remoteDrifts: []` 会被读成「远端没改过依赖」。 */
          envBroken: result.envBroken === true,
        },
        null,
        2,
      ) + "\n",
    );
    return result.code;
  }
  /* 三态各自的标题**不许同形**：判据没跑起来时写「有漂移」，读的人会去查一遍
   * 根本没人查过的东西（`base-check.mjs` 那一族同一句话：没跑起来 ≠ 判出失败）。
   * 「没装」与「有漂移」也不许同形（ISSUE #2382）：两者都落 1（都要动作），但
   * 前者是「还没装」（出口 `pnpm install`；硬规则 26：node_modules 缺失只表示
   * 『还没装』），后者是「判据判出一条事实」。数据层（`installDrift.state`）早已
   * 分开，摘要层只按 `code` 取词会把「没装」印成「有漂移」。远端真漂移在场时
   * 仍念「有漂移」—— 那半边是判据判出的，不是「没测」。 */
  const noInstallOnly =
    result.code === 1 &&
    result.remoteDrifts.length === 0 &&
    result.installDrift?.state === "no-install";
  process.stdout.write(
    `${result.code === 0 ? "[deps-freshness] OK" : result.code === 2 ? "[deps-freshness] 没跑起来" : noInstallOnly ? "[deps-freshness] 依赖还没装（出口：pnpm install）" : "[deps-freshness] 有漂移"}\n`,
  );
  for (const l of result.lines) process.stdout.write(`${l}\n`);
  return result.code;
}

// 只在被直接运行时执行 CLI（被 import 时不跑）。
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  process.exit(main());
}
