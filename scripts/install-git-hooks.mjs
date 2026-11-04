#!/usr/bin/env node
// 把仓库自带的提交门槛接上：`core.hooksPath` 指向版本控制里的 `.githooks/`。
//
// **为什么是 .mjs 而不是 .sh**：git 不会自动采用仓库内的钩子，新克隆的检出默认
// 没有任何提交门槛（`.git/hooks/` 只有 `.sample`），所以它挂在 `package.json` 的
// `postinstall` 上。而 `postinstall` 在 Windows 上由 cmd.exe 语义执行 ——
// `sh scripts/install-git-hooks.sh` 会变成「'sh' 不是内部或外部命令」，
// postinstall 非零退出 → pnpm 报 `ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED`，
// **整个 `pnpm install` 失败**：一键初始化入口（`tools/start/run-local.ps1`）
// 当场卡死，而 CI 在 Linux 上永远看不到这条（那里有 sh）。
//
// 同一个入口两端复用（规范 §9.5）：Node 是本仓库所有宿主的共同前提（启动编排、
// db-push、门禁链全在 Node 上），用它接钩子不需要任何平台分支。

import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const HOOKS_PATH = ".githooks";

/** 在仓库内跑一条 git 命令，返回 { ok, stdout }；git 缺失/非检出时 ok=false。
 *
 * @param {string[]} args
 * @returns {{ ok: boolean, stdout: string }}
 */
function git(args) {
  try {
    const r = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- git 子进程起不来时 stdout 实测为 undefined（@types/node 声明偏窄）
    return { ok: r.status === 0, stdout: String(r.stdout ?? "").trim() };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/** 统一的 `[hooks]` 前缀那一行。
 *
 * @param {string} message
 */
function say(message) {
  process.stdout.write(`[hooks] ${message}\n`);
}

// 三态：不在检出里（tarball 解包）/ 已指向 .githooks / 这次接上。
// **不在这里 exit**：下面还有缓存指纹那一步要走，提前退出会让它在这三种最常见的
// 形态上全部静默跳过（那正是「靠人记得删 = 没有执行者」的翻版）。
if (!git(["rev-parse", "--is-inside-work-tree"]).ok) {
  say("不在 git 检出里，跳过提交门槛接线");
} else if (
  git(["config", "--local", "--get", "core.hooksPath"]).stdout === HOOKS_PATH
) {
  say(`core.hooksPath 已指向 ${HOOKS_PATH}（提交门槛已生效）`);
} else if (git(["config", "--local", "core.hooksPath", HOOKS_PATH]).ok) {
  say(
    `已启用提交门槛：core.hooksPath=${HOOKS_PATH}（见 docs/standards/13-提交与-code-review.md §13.5）`,
  );
} else {
  say(
    `警告：设置 core.hooksPath 失败，提交门槛未生效` +
      `（可手动执行 git config core.hooksPath ${HOOKS_PATH}）`,
  );
}

// ── 顺带补上 Storybook 的类型输入（台账 E15）─────────────────────────────────
//
// `tsconfig.json` 的 include **显式列着** `.storybook/**/*.tsx`（点目录不在 glob
// 的默认展开范围里，不列就是 tsc 与 lint 的双重盲区，那边注释写着理由），
// 而注入层读的两样东西都是**现生成且不入库**的：`./generated/app-origin`（端口按
// 检出路径推导，写死的值在别人的 checkout 上必然错）与 `.storybook/assets/` 那三张
// 真图（media 值源要指向磁盘上的文件名）。两件事叠在一起的结果：**没跑过
// `pnpm storybook` 的检出，`pnpm typecheck` 与 `pnpm test` 双双必红** —— 前者报
// `Cannot find module './generated/app-origin'`，后者报「sample-landscape.svg 不在
// .storybook/assets/」，两条都指向谁都没碰过的文件，而它们拦住的是从这份基线分出去的
// **每一个提交**（A 组跑 `tsc --noEmit`、C 组跑用例）。落库时全绿，因为只有作者
// 的机器上那些文件在。
//
// 为什么不改设计（改成 env 注入）：Storybook 的 webpack 把 `process.env` 换成一份
// **白名单对象**（实测 bundle 里只有 NODE_ENV / NODE_PATH / STORYBOOK / PUBLIC_URL），
// 业务变量进不去、兜底永远生效 —— 那是 `data-sources.tsx` 文件头记下的实测结论。
// 输入该存在的时候就得存在，这一步只做「按当前检出算一次」，值随 `pnpm storybook`
// 每次启动照旧刷新（两个 ensure 都按内容比对写，幂等）。
//
// 挂在同一个 postinstall 入口而不是给 `postinstall` 再拼一条命令：那条契约
// （`launcher-core/node-runner.mjs::checkPostinstall()`）要求逐字以
// `node scripts/install-git-hooks.mjs` 开头、禁止 `&&`/`||`/`sh`，拦的正是 #636
// 的形态。失败语义也与上面两步一致：**只提示，绝不让 `pnpm install` 挂掉** ——
// 这一步缺了只是 tsc 少一份输入，依赖没装坏。
try {
  const { ensureStorybookAssets, writeStorybookAppOrigin } =
    await import("./storybook-assets.mjs");
  ensureStorybookAssets(path.join(root, ".storybook", "assets"));
  const { origin, source } = writeStorybookAppOrigin(
    root,
    path.join(root, ".storybook", "generated", "app-origin.json"),
  );
  say(`[hooks] Storybook 的开发期输入就绪：${origin}（${source}）`);
} catch (error) {
  say(
    `警告：Storybook 的开发期输入没补上（${String(error)}）—— pnpm storybook 会自己生成`,
  );
}

// ── 顺带注册 git-lfs 过滤器（字体这类大二进制）───────────────────────────────
//
// 为什么必须在这里：`filter.lfs.clean/smudge/diff` 一般由 `git lfs install` 写进
// **全局**配置，而新克隆、新机器的全局配置没人保证。少了它的后果不是报错，是**两种
// 静默降级**：提交侧找不到过滤器 ⇒ 字体按**原字节**进历史（8.6 MB 再也摘不干净，
// 只能重写共享远端的历史）；检出侧 ⇒ 拿回来的是一段 `version https://git-lfs…` 文本。
// 两种都比红难查，所以这一步与上面几步同构：**失败只提示，绝不阻断 `pnpm install`**。
//
// `--manual` 是刻意的：它让 git-lfs **不要**往钩子目录写自己那套 pre-push /
// post-checkout。本仓库的钩子目录是版本控制里的 `.githooks/`（`core.hooksPath`
// 指过去，见上面那段），上传由随仓库分发的 `.githooks/pre-push` 承担 —— 比让每个人
// 各自生成一份本机钩子可靠，也正是本文件一直在做的「接线不靠人记得住」。
if (git(["rev-parse", "--is-inside-work-tree"]).ok) {
  const lfs = git(["lfs", "install", "--local", "--manual"]);
  say(
    lfs.ok
      ? "git-lfs 过滤器已按本检出注册（字体等大文件走 LFS）"
      : "警告：`git lfs install --local --manual` 没跑成（本机没装 git-lfs？）—— " +
          "此时字体（*.woff2 / *.ttf）会按原字节进 git 历史，推送前请先装 git-lfs",
  );
}

// 上面几步都是**开发体验**兜底，不是依赖安装的必要条件：任何一步失败都不阻断安装。
process.exit(0);
