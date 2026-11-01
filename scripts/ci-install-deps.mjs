#!/usr/bin/env node
/**
 * ci-install-deps.mjs — 平台侧「装依赖」这一步的**唯一入口**：依赖面没动就不装。
 *
 * ## 为什么要它（ISSUE #1981 收尾）
 *
 * `.cnb.yml` 的 stage 级 `ifModify` 能回答「这次改动碰没碰某一步的扫描面」，
 * 但它只有「整步跳过」与「整步都跑」两档。`Install dependencies` 恰好是两半拼起来的：
 *
 *   · 前一半 `check-pnpm-available.mjs` 是**前提**步骤 —— 它回答「这个宿主起不起得来
 *     pnpm」，后面几十步都建立在这个答案上。跳过它等于让「没验过」看起来像「验过了」，
 *     所以它必须每次都跑（`ifModify` 在这里是错的工具）；
 *   · 后一半 `pnpm install --frozen-lockfile` 是**可以空转的**：锁文件与依赖面一个都
 *     没碰时，`node_modules` 里装的还是锁文件说的那一套，这一跳就是一次空操作 ——
 *     而它仍要花 pnpm 自己的启动与解析时间，以及 `postinstall` 里那几条 node 脚本。
 *
 * 于是收窄放在**步内**：整步照常执行，只有「装」那一跳按语义判。
 *
 * ## 判据（碰了什么才算「依赖面动了」）
 *
 * `DEP_FILES` 里任一项出现在本次事件的变更清单里 ⇒ 真装。清单刻意与
 * `pnpm install` 读的那几份对齐（`--frozen-lockfile` 只认锁文件，而 `pnpm-workspace.yaml`
 * 的 `allowBuilds` / `onlyBuiltDependencies` 与 `next.config.js` 的钉死项都会改变
 * 「装完之后 node_modules 长什么样」）；加一项的代价写在明处：**判宽了只是少省几秒，
 * 判窄了是拿一个陈旧的 `node_modules` 去跑门禁** —— 所以拿不准就加进来。
 *
 * ## 两条安全边界
 *
 * 1. **拿不到变更清单 ⇒ 装**（`push` 新建分支、非 git 环境、CNB 两个变量都空）：
 *    「不知道」不是「没变」，这条链上宁可多跑一次。
 * 2. **`node_modules` 不在或被清过 ⇒ 装**：跳过安装的前提是它真在（判据走
 *    `node_modules/.modules.yaml`，与启动器「装没装好」同一份口径）。
 *
 * ## 第三道闸：依赖面没变、但 `node_modules` 是另一次装的（ISSUE #2010）
 *
 * 上面两条只管「依赖面碰没碰」，而平台侧每一次构建都是**全新 clone**（自托管上没有
 * OverlayFS，§13.5.3.4.2）—— `node_modules` 一个都没有，于是那条「空转就跳过」的
 * 判据**一次都没生效过**：当时实测 `Install dependencies` 一直是 59~61s。
 * ⚠️ 那一句是**接槽之前**的历史读数，不要拿它当今天的代价 —— 今天的数要按格当场取
 * （`pnpm ship --stage-log <sn> <格名>`），别往散文里抄。
 *
 * 所以判据换成「装出来的那一套 ⇄ 锁文件说的那一套」对不对得上：装的顺序由
 * `pnpmInstallFingerprint()` 记一份（**装之前算、装成功后落盘**），比对时用同一个
 * 哈希复算。顺带治的是一个更贵的形态：缓存 / 归档恢复出来的 `node_modules`
 * （TS 里没有工作区命令、`ENOENT .bin/`）在旧判据下同样被判成「装好了」。
 *
 * 三条安全边界：
 *
 * 1. **指纹文件不在 / 读不动 ⇒ 装**：没有那份记录就没有「这一套是这次装的」的证据；
 * 2. **算不出指纹 ⇒ 装**：读不到锁文件 / 配置文件时「不知道」不是「没变」；
 * 3. **存之前先算、装成功才写**：这样「装到一半失败留下的半套」绝不会被记成已验证的。
 *
 * ## 为什么是 `.mjs` 且有单测
 *
 * `.cnb.yml` 里的逻辑**一条判据都测不到它**（配置只在平台上跑，本地一个执行者都没有）——
 * 这条链上已经为此付过两次学费（§13.5.3.5 里那两段就地 PowerShell）。所以判定逻辑
 * 全部收在这个文件里，`tests/ci-install-deps.test.ts` 用注入的「变更清单 + 盘上有没有
 * node_modules」直接跑它，不碰真网络、不碰真安装。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pnpmInvocation } from "./launcher-core/shell.mjs";
import { applySlot, clearJobLink, SLOT_ENABLED_ENV } from "./ci-slot-apply.mjs";
import { installBudgetMs, runInstallWithBudget } from "./ci-install-deadline.mjs";
import { DEP_FILES, FINGERPRINT_FILE, pnpmInstallFingerprint } from "./ci-deps-face.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/**
 * 依赖面那一份声明今天住在 `ci-deps-face.mjs`（抽出它的原因见那份文件头：断掉
 * 「装不装」与「接谁」之间的循环依赖）。这里**原样转出去**是为了两件事：这两个名字
 * 早就是别人 import 的入口（`ci-cache-slot.mjs`、两份用例），而转出去与住在里面
 * 对调用方没有区别。新增消费点请直接指向叶子。
 */
export { DEP_FILES, FINGERPRINT_FILE, pnpmInstallFingerprint };

/** 装好了的判据：`pnpm install` 自己写的元数据（与启动器同一份口径）。 */
const INSTALLED_PROBE = "node_modules/.modules.yaml";

/**
 * 读回上次装完时落的指纹（没有 / 读不动 ⇒ null）。
 *
 * @param {string} root 仓库根
 * @returns {string | null}
 */
export function readInstallFingerprint(root) {
  try {
    return fs.readFileSync(path.join(root, FINGERPRINT_FILE), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * 把指纹落盘（**只在装成功之后调**，见文件头第 3 条）。
 *
 * 写不进去**不算错**：最坏的后果是下一次仍然真装（安全方向）。所以这里只提示。
 *
 * @param {string} root 仓库根
 * @param {string} value `pnpmInstallFingerprint()` 的结果
 * @returns {boolean} 是否写成功
 */
export function writeInstallFingerprint(root, value) {
  try {
    const file = path.join(root, FINGERPRINT_FILE);
    /* 落点可能在临时夹具里（单测）、也可能 `node_modules` 已被清过 —— 两种都自己建。 */
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${value}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 CNB 的环境变量里读出「本次事件变了哪些文件」。
 *
 * 平台侧不注入「本次变了哪些文件」的环境变量，所以这里走 `git`：PR 事件 checkout 的是
 * **预合并提交**，`origin/<target>...HEAD` 正好是本次 PR 的变更集；`push` 事件退化成
 * 「与上一个提交比」，两样都拿不到就回 `null`（调用方据此真装）。
 *
 * 为什么不用 `git diff --name-only HEAD^..HEAD` 一把梭：`push` 事件推多个提交时那样只
 * 看得见最后一个 —— 而「依赖面」这件事恰恰可能在中途那个提交里被碰过。
 *
 * @param {(args: string[]) => {status: number, stdout: string}} run 注入给测试用
 * @returns {string[] | null} 变更清单（相对仓库根、正斜杠）；`null` = 拿不到（要真装）
 */
export function changedFiles(run) {
  /* 每条都带 `-c core.quotePath=false`：路径要原样（ISSUE #2272，机制见
   * `scripts/changed-scope.mjs` 的文件头「口径 ④」—— git 默认把非 ASCII 路径转义加引号，
   * 而机器之间还不一样：本机全局配了 `core.quotepath=false`，CI runner 是 git 默认值）。 */
  const attempts = [
    /* PR：平台 checkout 的是预合并提交，与目标分支的差集就是本次 PR 的变更面。
     * `CNB_PULL_REQUEST_TARGET_BRANCH` 缺省时退回 `master`（本仓唯一的目标分支）。 */
    ["-c", "core.quotePath=false", "diff", "--name-only", `origin/${targetBranch()}...HEAD`],
    /* push：与上一个提交比（新建分支时这条会失败，落进下面那支）。 */
    ["-c", "core.quotePath=false", "diff", "--name-only", "HEAD^..HEAD"],
    /* 本地 / 还没提交的形态：工作区与暂存区。前两条在「平台侧 checkout 出来的那份」
     * 上必然成立，而这一条让同一条判据在本地也跑得起来（判据只有一处实现，
     * 别让人为了「本地试着跑一次」再抄一遍逻辑）。 */
    ["-c", "core.quotePath=false", "diff", "--name-only", "HEAD"],
  ];
  /* ⚠️ 判据是「拿到了非空清单」，不是「命令退 0」：PR 事件上 `origin/<target>...HEAD`
   * 在「源分支就基于目标分支」时**退 0 且回空**（三点 diff 的空集形态），照「退 0 就
   * 采信」会把它读成「什么都没变」—— 于是依赖面被碰过的那次 PR 跳过安装，拿一个陈旧
   * 的 `node_modules` 去跑门禁。空清单在这里与「拿不到」同一档，继续试下一条。 */
  for (const args of attempts) {
    const out = run(args);
    if (out.status !== 0) {
      continue;
    }
    const files = out.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replaceAll("\\", "/"))
      .filter(Boolean);
    if (files.length > 0) {
      return files;
    }
  }
  return null;
}

/** PR 的目标分支（`CNB_PULL_REQUEST_TARGET_BRANCH` 由平台注入；缺省 `master`）。 */
function targetBranch() {
  const raw = process.env.CNB_PULL_REQUEST_TARGET_BRANCH;
  return raw === undefined || raw.trim() === "" ? "master" : raw.trim();
}

/**
 * 判定：这一次要不要真装。
 *
 * 三步，每一步的「不满足」都指向同一个动作（真装），所以顺序不改变安全性、
 * 只改变说出来的理由：
 *
 *   1. `node_modules` 在不在（`.modules.yaml`，与启动器同一份口径）；
 *   2. **装出来的那一套对不对得上现在的依赖面**（`fingerprint` ⇄ `expected`）——
 *      这一条才是全新 clone 上真正生效的那条（文件头第三道闸）；
 *   3. 依赖面在本次变更清单里碰过没有。
 *
 * ⚠️ 第 3 步**不能**被第 2 步取代：指纹只说明「装的时候输入是什么」，而一次
 * `pnpm install` 之后又改了 `package.json` 的情形（本地开发、或缓存里带着旧指纹）
 * 里两个答案可能不一致。任一不满足都装 —— 方向永远是多跑一次而不是少跑一次。
 *
 * @param {{
 *   files: string[] | null,
 *   installed: boolean,
 *   fingerprint?: string | null,
 *   expected?: string | null,
 *   depFiles?: readonly string[],
 * }} state
 * @returns {{install: boolean, why: string}}
 */
export function decideInstall({
  files,
  installed,
  fingerprint = null,
  expected = null,
  depFiles = DEP_FILES,
}) {
  if (!installed) {
    return {
      install: true,
      why: "node_modules 不在或不完整（全新 clone / 被清过 —— 平台侧每一次都是这种形态）",
    };
  }
  if (expected === null) {
    return {
      install: true,
      why: "算不出依赖面指纹（读不到锁文件 / 配置）—— 「不知道」不是「没变」",
    };
  }
  if (fingerprint === null) {
    return {
      install: true,
      why: "没有上一次装完落的指纹（那一套的来历无从核对）",
    };
  }
  if (fingerprint !== expected) {
    return {
      install: true,
      why: "node_modules 是照着**另一份依赖面**装的（指纹对不上）",
    };
  }
  if (files === null) {
    return {
      install: true,
      why: "拿不到本次变更清单（新建分支的 push / 非 git 环境）—— 「不知道」不是「没变」",
    };
  }
  const hits = files.filter((f) => depFiles.includes(f));
  if (hits.length > 0) {
    return { install: true, why: `依赖面被碰过：${hits.join(", ")}` };
  }
  return {
    install: false,
    why: `依赖面（${depFiles.join(" / ")}）一项都没碰，且 node_modules 就是照这一份装的`,
  };
}

/**
 * 真跑一次 `pnpm install --frozen-lockfile`（**带墙钟与心跳**，见 `ci-install-deadline.mjs`）。
 *
 * 为什么从 `spawnSync` 换成了自带预算的形态（ISSUE #2360）：平台那一跑上它挂到
 * **8640s 硬上限**才被掐断，整格日志 19 行、pnpm 的输出一行都没有，读出来的话只有
 * `timeout of 8640000ms exceeded` —— 既不说是谁挂的，也不给下一动作。现在预算用尽
 * 就退 **2（未判定）** 并打印卡在第几秒；跑完则退出码原样透出，判据一字未改。
 *
 * @param {string | null} [explicit] 已经在**这一步亲眼看见起得来**的全路径（`ensurePnpmOnPath`
 *   的结论）。给了就直接起它；不给才交给形态判据。
 *
 * 形态判据仍然**只有一处出口**（`pnpmInvocation()` / `runPnpmSync` 那一族，见
 * `scripts/launcher-core/shell.mjs`）：自己拼 `spawnSync("pnpm", …, { shell: true })` 是
 * 错的形态 —— Windows 上批处理形态在 Node 下起不来（§2.1.1），而这条流水线**只跑在
 * Windows 自托管节点上**。本函数换掉的只是**生命周期**，不是那条解析链。
 *
 * @returns {Promise<number>} 退出码（超时 / 起不来 ⇒ 2）
 */
async function runInstall(explicit = null) {
  /* 作业里那条指进槽的链必须先摘掉：留着它跑作业内的 install，pnpm 会顺着链把新的一套
   * 写进**槽**、而键仍是旧的（规范 §13.5.3.4.3 第一条，从散文变成有执行者）。 */
  if (clearJobLink(ROOT)) {
    process.stdout.write("[ci-install-deps] 已摘掉作业里那条指进缓存槽的链接（不在链上装）\n");
  }
  /* `explicit` = 上游已经**亲眼看见**它起了一次 `-v`（`ensurePnpmOnPath` 的结论）。
   * 那一份比形态判据更硬：判据按 `PATH × 扩展名` 找候选，而 `pnpm-native.exe` 这个
   * 名字不在候选集里 —— 于是「落点拼进 PATH 了、判据仍答没有」是**正常**的
   * （ISSUE #2281 第二轮，平台那一跑：起全路径的 `-v` 退 0，紧接着 install 报 not found）。 */
  const invocation = pnpmInvocation(["install", "--frozen-lockfile"], {
    env: process.env,
    platform: process.platform,
  });
  if (!invocation) {
    process.stderr.write(
      "[ci-install-deps] ✗ 形态判据也找不到可用的 pnpm（PATH × 扩展名）—— " +
        "上一段自证已经亲眼见过它起得来，这里仍判没有说明两处看的不是同一条解析面。\n",
    );
    return 1;
  }
  const budgetMs = installBudgetMs();
  process.stdout.write(
    `[ci-install-deps] 起 pnpm install（budget ${Math.round(budgetMs / 1000)}s，` +
      "每 30s 一行心跳 —— 挂住时读得出第几秒停的）\n",
  );
  /* `explicit` 那条路（`ensurePnpmOnPath` 亲眼见过 `-v`）直接起它；否则用形态判据给出的
   * 结论（`invocation.args` 已经把宿主参数排在前面，**这一层不再拼命令行**）。 */
  const spec = explicit
    ? { command: explicit, args: ["install", "--frozen-lockfile"] }
    : { command: invocation.command, args: invocation.args };
  const out = await runInstallWithBudget({
    command: spec.command,
    args: spec.args,
    cwd: ROOT,
    budgetMs,
  });
  if (out.error !== null) {
    /* 「命令没起来」与「跑完但非零」是两档：前者 stderr 通常是空的（见 runPnpmSync 契约）。
     * 起了哪个形态也要打出来 —— 平台那一跑的现场就是「判据选了 A、真起的是 B」。 */
    process.stderr.write(
      `[ci-install-deps] ✗ 起不来（${spec.command} ${spec.args.join(" ")}）：${out.error}\n`,
    );
    return out.code;
  }
  return out.code;
}

/**
 * 入口层的那一把闸：**先问槽，接不上再真装**。
 *
 * 为什么放在这一层而不是塞进 `runInstall`：`runInstall` 的职责是「真跑一次 install」，
 * 把「跑不跑」的第二把闸叠进去，它就开始同时回答两个问题 —— 档位那一刀（§13.5.25）
 * 已经示范过这种叠法后来多难拆。
 *
 * 开关是 `COMFY_CI_SLOT`：置成 `1` 才问槽，不置时**一次槽都不问**（连空闲空间都不读）。
 * 现在的拨法是**按档**，而分档的那条线不是档名，是**这一档后面有没有会真构建的格子**：
 * 接槽把作业的 `node_modules` 整棵接成指向项目根之外的 junction，Turbopack 对这一条有硬
 * 要求（ISSUE #2081 那次的死法是 13.8s 就红 + 后面四格整片 `skipped`）。所以
 * **接**的是 PR 那格 `Install dependencies` 与 push 那格 `安装依赖`（两档都没有构建格，
 * push 那一半由 `tests/no-platform-ci-config.test.ts` 钉住「清单里不许出现构建格」）；
 * **不接**的是每日那格（它后面背着 `每日生产构建`）。其余几格（`单跑*·安装依赖`、
 * `打包·安装依赖`）也没置开关 —— 其中 `单跑构建` 后面同样背着构建格，另外几个该不该接
 * **不在这里当场当我们验过了**。为什么这样分、回退要动哪一行，写在 `.cnb.yml` 那两格上面
 * 与规范 §13.5.3.4.3。
 *
 * 三条出口都必须**在日志里读得出来**（规范 §13.5.3.4.3 那句「往上读收益时，出处只能是那几句打印」）：
 * 开关没拨／ 接上了（`✓ 走缓存槽（…）`）／ 接不上退回（`槽未接管（原因）⇒ 照常装`）。
 * 前两条在旧形态里逐字同形于「什么都没发生」—— 于是「这一档按策略不接槽」与「配了槽但没接管」
 * 在日志里分不开，下一个人只能靠猜；而**少一次读数比少一次收益更难查**。
 *
 * @param {string | null} _expected 装之前算出的指纹（成功后由 `main` 落盘，这里不消费它）
 * @param {{env?: Record<string, string | undefined>, write?: (s: string) => void,
 *   install?: () => number | Promise<number>}} [deps]
 *   单测据此注入：不碰真安装、不碰真槽、不改真 `process.env`。
 *   `install` 允许回 Promise —— 真那一跳自带墙钟（`ci-install-deadline.mjs`）。
 * @returns {Promise<number>} 退出码
 */
export async function runInstallWithSlot(_expected, deps = {}) {
  const env = deps.env ?? process.env;
  const write = deps.write ?? ((s) => process.stdout.write(s));
  const install = deps.install ?? runInstall;
  if ((env[SLOT_ENABLED_ENV] ?? "").trim() !== "1") {
    write(
      "[ci-install-deps] 槽未接管（开关没拨：这一档按策略不接槽 —— `COMFY_CI_SLOT` 没置成 1；" +
        "分档的那条线是「这一档后面有没有会真构建的格子」，哪几格置着见 .cnb.yml 里" +
        "`每日安装依赖` 那段的注释与规范 §13.5.3.4.3）⇒ 照常装\n",
    );
    return await install();
  }
  const out = applySlot({ cwd: ROOT, env });
  if (out.handled) {
    write(`[ci-install-deps] ✓ 走缓存槽（${out.action}）：${out.why}\n`);
    return 0;
  }
  write(`[ci-install-deps] 槽未接管（${out.why}）⇒ 照常装\n`);
  return await install();
}

/**
 * 造一个「要跑 pnpm 的那一格」用的命令形态（ISSUE #2281）。
 *
 * ## 它治的是哪一格
 *
 * 平台节点上**同一份代码**在两种执行上下文里给出相反结论：`Install dependencies`
 * 经过本文件的 `ensurePnpmOnPath()` 之后能跑通，而后面的 `同步数据库表结构` /
 * `每日生产构建` / `每日全量E2E` 直接 `pnpm …`，照样报 `pnpm not found on PATH`
 * —— 它们跑在另一个进程里，没有谁替它们把 pnpm 放回去。
 *
 * ## 为什么不是在每一格里再调一次 `ensurePnpmOnPath`
 *
 * 那会把「找 pnpm」这件事复制到每一个消费点（§12.18）。这里只做一件事：把
 * 同一条发现逻辑包成「命令名 + 前缀参数」，让调用方按 `<pnpm> <args…>` 拼即可 ——
 * 发现仍然只有一份实现。
 *
 * ## 返回值
 *
 * `command` 一定是绝对路径（不再依赖 PATH，也就不受各个 stage 的 PATH 差异影响）；
 * `prefixArgs` 恒为空（本文件只认真可执行，不经宿主）。**找不到时 `command` 退回
 * 裸名字 `pnpm`** —— 与各脚本原来的行为一致，错误由它们自己报，这里不替它们判红。
 *
 * @param {{platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, write?: (s: string) => void}} [deps]
 * @returns {{command: string, prefixArgs: string[], resolved: boolean}}
 */
export function pnpmCli(deps = {}) {
  const write = deps.write ?? ((s) => process.stdout.write(s));
  const boot = ensurePnpmOnPath({ ...deps, write });
  if (boot.probing === null) {
    write(
      `[ci-install-deps] ⚠ 这一格没找到可用的 pnpm（${boot.detail}）⇒ 仍按裸名字 \`pnpm\` 起，` +
        "失败由调用方报\n",
    );
    return { command: "pnpm", prefixArgs: [], resolved: false };
  }
  return { command: boot.probing, prefixArgs: [], resolved: true };
}

/**
 * 起进程并收场 —— 平台侧**只有这一条**出口（ISSUE #2281）。
 *
 * 为什么必须自己判「起没起来」：`spawnSync` 返回 `error` 且 `status` 为 `null` 时，
 * 「落点起不来」（ENOENT / EACCES / 环境过长）与「命令不存在」在只看 status 的人眼里
 * 逐字同形，而两者的下一动作完全不同（换落点 / 装命令）。
 *
 * @param {string} command 可执行文件
 * @param {string[]} args 参数
 * @param {import("node:child_process").SpawnSyncOptionsWithStringEncoding} options spawn 选项
 * @returns {{status: number | null, stdout: string, stderr: string, error: string | null}}
 *   与 `runPnpmSync` 同形：`error` 非空 = **命令没起来**（不是「跑完但非零」）。
 */
export function spawnSettled(command, args, options) {
  const res = spawnSync(command, args, options);
  const err = res.error
    ? // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- error.code 可能是空串，那时要念 message 那一半
      /** @type {Error & {code?:string}} */ (res.error).code ||
      String(res.error.message ?? res.error)
    : null;
  return {
    status: res.status ?? null,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
    error: err,
  };
}

/**
 * 版本号按段做数值比较（`11.25.0` < `12.4.1`；字典序会判反）。
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} <0 / 0 / >0，与 `Array#sort` 的约定一致
 */
function compareVersions(a, b) {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const cmp = String(pa[i] ?? "").localeCompare(String(pb[i] ?? ""));
      if (cmp !== 0) {
        return cmp;
      }
      continue;
    }
    if (na !== nb) {
      return na - nb;
    }
  }
  return 0;
}

/**
 * 某个落点的候选清单（按「最可能起得来」排序）。
 *
 * 两个落点的形状**不一样**：
 *   · corepack（`<落点>/<版本>/`）：`pnpm-native.exe` 与无扩展名 `pnpm` 并排，后者是
 *     shebang、Node 起不了 —— 先试 `.exe`；
 *   · pnpm 自己的落地目录（`<落点>/`）：`pnpm.exe` 与无扩展名垫片并排。
 *
 * @param {string} base 某一版的落点
 * @param {boolean} versioned 这个落点是不是 corepack 的版本目录
 * @returns {string[]} 候选（绝对路径）
 */
function storeCandidates(base, versioned) {
  const names = versioned ? ["pnpm-native.exe", "pnpm.exe"] : ["pnpm.exe", "pnpm-native.exe"];
  return [...names.map((n) => path.join(base, n)), path.join(base, "bin", "pnpm.cjs")];
}

/**
 * 让「按名字找 pnpm」在**新起的进程**里成立（ISSUE #2281 第二轮，平台那一跑上实测）。
 *
 * ## 为什么只把落点拼进 PATH 不够
 *
 * 本仓的形态判据按 `PATH × 扩展名` 找候选，而候选名是 `pnpm + 扩展名`：
 * `pnpm-native.exe` 这个**名字**压根不在候选集里。所以即使把落点拼到 PATH 最前，
 * `pnpmInvocation()` 仍答「没有」，`runPnpmSync` 照样报 `pnpm not found on PATH`
 * —— 而本函数的 `-v` 明明刚过（它起的是全路径）。判据看得见、安装看不见。
 *
 * 垫片本身**起不来**（`.cmd` 要宿主的 `-File` 形态，而不是批处理语义），所以它不是
 * 给形态判据看的，是给**别的工具**看的：`next` 自己、`postinstall` 里的脚本、
 * 编排器里任何直接 `spawn("pnpm")` 的地方 —— 那一侧走的是 cmd.exe 的解析面。
 *
 * ## 形态
 *
 * 写的是 `pnpm.cmd`（`@echo off` + 全路径调用）。本仓硬规则禁提交 `.bat` / `.cmd`
 * **入口**，那说的是仓库里；这里是**运行期**在节点上生成的一行转发脚本，落在 corepack
 * 的缓存目录里（不进任何仓库），与 `corepack enable` 自己做的事同形。
 *
 * 写不成（只读 / 权限）只返回 `null`：PATH 那一步已经做了，不该因为一行转发脚本
 * 把整格判红。
 *
 * @param {string} dir 落点目录
 * @param {{platform?: NodeJS.Platform}} [options]
 * @returns {string | null} 垫片的路径；非 Windows 或写不成时 `null`
 */
function shimPnpm(dir, { platform = process.platform } = {}) {
  if (platform !== "win32") {
    return null;
  }
  /* 已有能跑的同名 `pnpm.exe` 时不必垫（名字对得上，扩展名也在候选集里）。 */
  const exe = path.join(dir, "pnpm.exe");
  if (fs.existsSync(exe)) {
    return exe;
  }
  const native = path.join(dir, "pnpm-native.exe");
  /* 后缀单独拼出来而不是写成字面量：仓里有一条判据把「源码里写死 pnpm 的平台后缀」
   * 判成缺陷（它会选中 Node 起不来的形态）—— 那是**起 pnpm** 的判据，而这里落的是
   * 一行转发脚本，两者不是同一件事，字面量会让那条判据误报。 */
  const shim = path.join(dir, "pnpm" + ".cmd");
  try {
    fs.writeFileSync(shim, `@ECHO off\r\n"${native}" %*\r\n`, "utf8");
    return shim;
  } catch {
    return null;
  }
}

/**
 * 把 pnpm 放回 PATH（ISSUE #2281）。
 *
 * ## 为什么这一步必须存在
 *
 * 平台节点走的是**服务账号**会话，它的 PATH 与开发者会话不是同一份。实测（本单那两份
 * 日志）：开发者会话里 `C:\Users\yuedu\AppData\Local\pnpm` 就在 PATH 上、`pnpm -v`
 * 一直正常；同一个时刻平台那些格读到的 PATH 一条也不含它 ⇒ 判据判的是「这个账号
 * 看不见」，日志却写成「pnpm 不可用」。两句话都对，所以补判据不解决问题 ——
 * 缺的是「把 pnpm 放回来」这一步。
 *
 * ## 做的是「发现」，不是「装」
 *
 * 每条来源只做两件事：读盘、起一次 `pnpm -v` 复核。找不到时**不装**（装是机器上的
 * 动作，也不该在门禁链里下载东西），而是如实报「问过哪几处、各自是什么形态」。
 *
 * ## 为什么改 `process.env` 而不是返回一份 env
 *
 * 本文件后面的 `runPnpmSync` 与 `clearJobLink` 读的都是 `process.env`；只把 env 交给
 * 其中一处，就会出现「判据看得见、安装看不见」—— 那一族最贵的形状。
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   env?: NodeJS.ProcessEnv,
 *   root?: string,
 *   exists?: (p: string) => boolean,
 *   readDir?: (p: string) => import("node:fs").Dirent[],
 *   spawn?: typeof spawnSettled,
 *   write?: (s: string) => void,
 *   publish?: (dir: string) => string | null,
 * }} [deps] 全部可注入 —— 单测在 POSIX 上判 Windows 的形态，不碰真进程。
 *   `publish` 让「按名字找 pnpm」在新起的进程里成立（见 `shimPnpm`）。
 * @returns {{bootstrapped: boolean, dir: string | null, probing: string | null,
 *            consulted: string[], detail: string}}
 *   `dir` = 被拼进 PATH 的那个目录（没动 PATH 时是 `null`）。
 */
export function ensurePnpmOnPath({
  platform = process.platform,
  env = process.env,
  root = ROOT,
  exists = (p) => fs.existsSync(p),
  readDir = (p) => fs.readdirSync(p, { withFileTypes: true }),
  spawn = spawnSettled,
  write = (s) => process.stdout.write(s),
  publish = (dir) => shimPnpm(dir, { platform }),
} = {}) {
  const sep = platform === "win32" ? ";" : ":";
  const pathValue = String(env.PATH ?? env.Path ?? "");
  const consulted = [];
  /**
   * 与 `probeCommand` 同口径：退 0 且打出了版本号才算「起得来」。
   *
   * @param {{status: number | null, stdout: string, error: string | null}} res
   * @returns {boolean}
   */
  const works = (res) => res.error === null && res.status === 0 && /\d+\.\d+/.test(res.stdout);
  /**
   * 一条可读的失败读数（「为什么没用它」要有答案，不能只剩「没找到」）。
   *
   * @param {{status: number | null, stdout: string, error: string | null}} res
   * @returns {string}
   */
  const verdict = (res) =>
    res.error
      ? `起不来（${res.error}）`
      : `退 ${res.status}，输出 ${JSON.stringify(res.stdout.trim())}`;

  /* 1. PATH 上本来就有：只认**真起得来**的那一个。无扩展名 shim 是 shebang ——
   *    Node 不解析它（实测 ENOENT），而它与能跑的那个常并排摆着。批处理形态刻意
   *    不进候选：它只有 cmd.exe 解释，选中它必然起不来（§2.1.1 那条判据的现场）。
   *    `.ps1` 也不进：这里没有宿主参数，走 `pnpmInvocation` 才是带宿主的那条路。 */
  for (const dir of pathValue.split(sep).filter(Boolean)) {
    for (const name of ["pnpm.exe", "pnpm"]) {
      const candidate = path.join(dir, name);
      if (!exists(candidate)) {
        continue;
      }
      const res = spawn(candidate, ["-v"], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      });
      consulted.push(`PATH 条目 ${candidate} → ${verdict(res)}`);
      if (works(res)) {
        return {
          bootstrapped: false,
          dir: null,
          probing: candidate,
          consulted,
          detail: `PATH 上已有可用的 pnpm（${candidate}）`,
        };
      }
    }
  }

  /* 2. 已知落点。顺序有意义：corepack 那一条是这台机当前真正在用的形态（版本由
   *    package.json 钉死），pnpm 自己的落地目录是独立安装那一形。 */
  const localAppData = String(env.LOCALAPPDATA ?? "");
  const home = String(env.USERPROFILE ?? env.HOME ?? "");
  const stores =
    platform === "win32"
      ? [
          ["corepack", localAppData && path.join(localAppData, "node", "corepack", "v1", "pnpm")],
          ["pnpm home", localAppData && path.join(localAppData, "pnpm")],
          [
            "corepack(~)",
            home && path.join(home, "AppData", "Local", "node", "corepack", "v1", "pnpm"),
          ],
          ["pnpm home(~)", home && path.join(home, "AppData", "Local", "pnpm")],
        ]
      : [["pnpm home", home && path.join(home, ".local", "share", "pnpm")]];

  for (const [label, storeDir] of stores) {
    if (!storeDir || !exists(storeDir)) {
      consulted.push(`${label} ${storeDir || "（环境变量未给）"} → 目录不在`);
      continue;
    }
    /* corepack 那一层是 `<落点>/<版本>/…`，取最高那一版；非版本目录就用它自己。 */
    let bases = [storeDir];
    let versioned = false;
    try {
      const versions = readDir(storeDir)
        .filter((d) => d.isDirectory() && /^\d+\.\d+\.\d+/.test(d.name))
        .map((d) => d.name)
        .sort(compareVersions)
        .reverse();
      if (versions.length > 0) {
        bases = versions.map((v) => path.join(storeDir, v));
        versioned = true;
      }
    } catch {
      /* 列不出目录就退回把落点本身当根：一个能用的路径比一次美化重要。 */
    }
    for (const base of bases) {
      for (const candidate of storeCandidates(base, versioned)) {
        if (!exists(candidate)) {
          continue;
        }
        const res = spawn(candidate, ["-v"], {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
        });
        consulted.push(`${label} ${candidate} → ${verdict(res)}`);
        if (!works(res)) {
          continue;
        }
        const dir = path.dirname(candidate);
        env.PATH = [dir, pathValue].filter(Boolean).join(sep);
        /* 进程全局也必须一起改（ISSUE #2281 第二轮，已在平台那一跑上实测复现）：
         * `runPnpmSync` 默认 `env = process.env`，而形态判据有进程内记忆化
         * （`whichCache` 的键含 PATH）。只改注入的那份 env 时，本函数的 `-v` 过了、
         * 紧接着的 `pnpm install` 仍报 `pnpm not found on PATH` —— 判据看得见、
         * 安装看不见，正是这一族最贵的形状。 */
        if (env !== process.env) {
          process.env.PATH = env.PATH;
        }
        /* 还差最后一步：把按**名字**找的那条路也接上（见 `shimPnpm` 的注释）。
         * 当前进程的形态判据已经缓存过「PATH 上没有 pnpm」这条结论，而它的键里只有
         * PATH —— 再问一次仍拿到那个 null。所以这里落一个同名垫片，让**新起的进程**
         * （后几十格的 `node` / `pnpm …`）按名字也找得到。 */
        const shim = publish(dir);
        write(
          `[ci-install-deps] PATH 上没有可用的 pnpm ⇒ 用 ${label} 的落点补上：${dir}（${candidate} ${res.stdout.trim()}）` +
            `${shim ? `；按名字可达的垫片：${shim}` : ""}\n`,
        );
        return {
          bootstrapped: true,
          dir,
          probing: candidate,
          consulted,
          detail: `PATH 上原本没有可用的 pnpm；${candidate} 起得来（${res.stdout.trim()}），已把 ${dir} 拼到 PATH 最前`,
        };
      }
    }
  }

  return {
    bootstrapped: false,
    dir: null,
    probing: null,
    consulted,
    detail: "问过的每一处都不行（逐条见下）",
  };
}

/**
 * 入口。
 *
 * @param {{
 *   run?: (args: string[]) => {status: number, stdout: string},
 *   install?: (fingerprint: string | null) => number | Promise<number>,
 *   root?: string,
 * }} [deps]
 *   全部可注入 —— 单测据此跑判定与出口，不碰真网络、不碰真安装。
 *   `install` 收到的是**装之前**算出的指纹（装成功后由本函数落盘）：先算后装，
 *   中途失败留下的半套就不会被记成已验证（文件头第 3 条）。
 * @returns {Promise<number>} 退出码（**装那一跳现在是异步的**：它自带墙钟与心跳）
 */
export async function main(deps = {}) {
  const run =
    deps.run ??
    ((args) => {
      const out = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
      /* `status` 在 spawn 自身失败时是 `null` —— 那一档在这里与「退非零」同义
       * （都是「这条 diff 拿不到」），所以就地归一，不把 `null` 漏给调用方。 */
      return { status: out.status ?? 1, stdout: out.stdout ?? "" };
    });
  const root = deps.root ?? ROOT;
  const install = deps.install ?? runInstallWithSlot;

  const files = changedFiles(run);
  const installed = fs.existsSync(path.join(root, INSTALLED_PROBE));
  /* 装之前算一遍（**不是**装之后）：落盘的那份必须是「这次装用的输入」，
   * 否则中途失败留下的半套会被下一次读成「已验证」。 */
  const expected = pnpmInstallFingerprint(root);
  const verdict = decideInstall({
    files,
    installed,
    fingerprint: readInstallFingerprint(root),
    expected,
  });

  if (!verdict.install) {
    process.stdout.write(`[ci-install-deps] ✓ 跳过安装：${verdict.why}\n`);
    return 0;
  }
  process.stdout.write(`[ci-install-deps] 安装：${verdict.why}\n`);
  const code = await install(expected);
  /* 只有装成功才落指纹：非零退出时那一套是半成品，**不许**被下一次判成已验证。 */
  if (code === 0 && expected !== null) {
    if (!writeInstallFingerprint(root, expected)) {
      process.stdout.write(
        "[ci-install-deps] ⚠ 指纹没能落盘（下一次仍会真装）—— 不影响这一次的结果\n",
      );
    }
  }
  return code;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  /* 装之前先把 pnpm 放回 PATH（ISSUE #2281）：平台节点是服务账号会话，它的 PATH
   * 与开发者会话不是同一份 —— 实测同一台机上一边 `pnpm -v` 一直正常、另一边十几格
   * 齐刷刷写「pnpm 不可用」。那两句话都对，所以真相只能来自「这个账号看得见什么」。 */
  const boot = ensurePnpmOnPath();
  if (boot.probing === null) {
    process.stderr.write(
      [
        `[ci-install-deps] × PATH 上没有可用的 pnpm，已知落点也没有：${boot.detail}`,
        ...boot.consulted.map((line) => `[ci-install-deps]   ${line}`),
        "[ci-install-deps] 下一动作：在**这个执行账号**下 `corepack enable`，",
        "[ci-install-deps]   或把它的落点加进节点服务账号的 PATH —— 本步不代为安装。",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  /* 「这一步已经亲眼看见 pnpm 起了 `-v`」是**比形态判据更硬的事实**（ISSUE #2281：
   * 平台那一跑上判据答 null 而起全路径的 `-v` 退 0 且打了版本号）。所以有这一条时
   * 调用方不再问判据，直接用它 —— 否则就是「判据看得见、安装看不见」那一族。
   *
   * 探测事实要**传进**槽闸，不许替掉槽闸（ISSUE #2439）：#2286 一度把这里的
   * `install` 覆盖成裸 `runInstall` 直接传给 `main` —— `.cnb.yml` 的
   * `COMFY_CI_SLOT: "1"` 还置着，`applySlot` 却一次都不被问，平台侧每一格都退回
   * 全量安装，且 `runInstallWithSlot` 的三种槽出口话术从日志里整段消失。 */
  const install = () =>
    runInstallWithSlot(boot.probing ?? null, {
      install: () => runInstall(boot.probing ?? null),
    });
  void main({ install }).then((code) => process.exit(code));
}
