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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_PATH = ".githooks";

/** 在仓库内跑一条 git 命令，返回 { ok, stdout }；git 缺失/非检出时 ok=false。 */
function git(args) {
  try {
    const r = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: r.status === 0, stdout: String(r.stdout ?? "").trim() };
  } catch {
    return { ok: false, stdout: "" };
  }
}

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

// ── 顺带失效 eslint 增量缓存（ISSUE #1399）───────────────────────────────────
//
// 为什么并在这里而不是往 `postinstall` 再挂一条命令：`postinstall` 的形状受
// `launcher-core/node-runner.mjs::checkPostinstall()` 约束（必须逐字以
// `node scripts/install-git-hooks.mjs` 开头，禁止 `&&` / `||` / `sh`）—— 那条契约
// 拦的正是 #636 的事故形态（拼接命令在 Windows 的 cmd.exe 语义下直接崩）。
// 本入口的定义就是「任何一步失败都只提示、`exit 0`、不阻断安装」，把这一步并进来
// 既满足同一条契约，也不用新增第二个 postinstall 执行者。
//
// 为什么需要它：eslint 的 `--cache` 缓存键**不含依赖树**，而 `no-unsafe-*` 是
// 类型化规则 —— 依赖一变，旧判决会被整片重放（假红拦死提交 / 假绿洗掉违规）。
// 详见 `scripts/eslint-cache-fingerprint.mjs` 的文件头与 ISSUE #1399。
//
// 失败语义与上面一致：检索引擎算不出指纹、缓存删不掉，都只提示，绝不让
// `pnpm install` 挂掉。
try {
  const { runFingerprint } = await import("./eslint-cache-fingerprint.mjs");
  runFingerprint({ root, log: say });
} catch (err) {
  say(`警告：eslint 缓存指纹失效这一步被跳过（${String(err)}）`);
}

// ── 顺带补上 Storybook 的类型输入（台账 E15）─────────────────────────────────
//
// `tsconfig.json` 的 include **显式列着** `.storybook/**/*.tsx`（点目录不在 glob
// 的默认展开范围里，不列就是 tsc 与 eslint 的双重盲区，那边注释写着理由），
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
    path.join(root, ".storybook", "generated", "app-origin.ts"),
  );
  say(`[hooks] Storybook 的开发期输入就绪：${origin}（${source}）`);
} catch (err) {
  say(
    `警告：Storybook 的开发期输入没补上（${String(err)}）—— pnpm storybook 会自己生成`,
  );
}

// 上面几步都是**开发体验**兜底，不是依赖安装的必要条件：任何一步失败都不阻断安装。
process.exit(0);
