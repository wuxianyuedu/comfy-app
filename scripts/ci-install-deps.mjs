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
 * 判据**一次都没生效过**：实测 `Install dependencies` 一直是 59~61s。
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
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runPnpmSync } from "./launcher-core/shell.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 依赖面：碰了任一项就必须真装（见头注「判据」那一段）。 */
export const DEP_FILES = [
  "pnpm-lock.yaml",
  "package.json",
  "pnpm-workspace.yaml",
  "next.config.js",
];

/** 装好了的判据：`pnpm install` 自己写的元数据（与启动器同一份口径）。 */
const INSTALLED_PROBE = "node_modules/.modules.yaml";

/**
 * 「这一套依赖是照这一次装出来的」—— 装之前算出的指纹落盘处（见文件头第三道闸）。
 *
 * 归 `node_modules/`：它描述的就是那份产物，`node_modules` 被清掉时它一起消失
 * （于是「没有证据」与「产物不在」是同一件事），也不必往 .gitignore 里加一行。
 */
export const FINGERPRINT_FILE = "node_modules/.ci-deps-fingerprint";

/**
 * 依赖面的**内容**指纹：锁文件 + 三份配置 + 补丁目录。
 *
 * 为什么不直接复用 `DEP_FILES` 的 mtime / 存在性：全新 clone 上它们全都「存在且
 * 是刚写的」，那种判据在那里恒真。这里要的是「装的那一次」与「现在」同一份输入。
 *
 * 补丁目录单独成一项（而不是遍历进文件清单）：`patches/` 里换一个文件，
 * `pnpm install` 的产物就不同，而它不在 `DEP_FILES` 里（那是**变更清单**的判据，
 * 两份清单职责不同）。
 *
 * @param {string} root 仓库根
 * @returns {string | null} 算不出来（读不到锁文件 / 配置）时 null —— 调用方据此真装
 */
export function pnpmInstallFingerprint(root) {
  const hash = crypto.createHash("sha256");
  for (const file of DEP_FILES) {
    try {
      hash.update(file);
      hash.update(fs.readFileSync(path.join(root, file)));
    } catch {
      return null;
    }
  }
  hash.update(readPatchesDigest(root));
  return hash.digest("hex");
}

/**
 * `patches/` 的摘要（文件名 + 内容）。目录不在时回一句固定的话（**不是**空串：
 * 「没有补丁」也是一种状态，它要与「读不到目录」区分开）。
 *
 * @param {string} root 仓库根
 * @returns {string}
 */
function readPatchesDigest(root) {
  const dir = path.join(root, "patches");
  let names;
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return "patches:absent";
  }
  const hash = crypto.createHash("sha256");
  for (const name of names) {
    hash.update(name);
    try {
      hash.update(fs.readFileSync(path.join(dir, name)));
    } catch {
      return "patches:unreadable";
    }
  }
  return `patches:${hash.digest("hex")}`;
}

/**
 * 读回上次装完时落的指纹（没有 / 读不动 ⇒ null）。
 *
 * @param {string} root 仓库根
 * @returns {string | null}
 */
export function readInstallFingerprint(root) {
  try {
    return (
      fs.readFileSync(path.join(root, FINGERPRINT_FILE), "utf8").trim() || null
    );
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
  const attempts = [
    /* PR：平台 checkout 的是预合并提交，与目标分支的差集就是本次 PR 的变更面。
     * `CNB_PULL_REQUEST_TARGET_BRANCH` 缺省时退回 `master`（本仓唯一的目标分支）。 */
    ["diff", "--name-only", `origin/${targetBranch()}...HEAD`],
    /* push：与上一个提交比（新建分支时这条会失败，落进下面那支）。 */
    ["diff", "--name-only", "HEAD^..HEAD"],
    /* 本地 / 还没提交的形态：工作区与暂存区。前两条在「平台侧 checkout 出来的那份」
     * 上必然成立，而这一条让同一条判据在本地也跑得起来（判据只有一处实现，
     * 别让人为了「本地试着跑一次」再抄一遍逻辑）。 */
    ["diff", "--name-only", "HEAD"],
  ];
  /* ⚠️ 判据是「拿到了非空清单」，不是「命令退 0」：PR 事件上 `origin/<target>...HEAD`
   * 在「源分支就基于目标分支」时**退 0 且回空**（三点 diff 的空集形态），照「退 0 就
   * 采信」会把它读成「什么都没变」—— 于是依赖面被碰过的那次 PR 跳过安装，拿一个陈旧
   * 的 `node_modules` 去跑门禁。空清单在这里与「拿不到」同一档，继续试下一条。 */
  for (const args of attempts) {
    const out = run(args);
    if (out.status !== 0) continue;
    const files = out.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\\/g, "/"))
      .filter(Boolean);
    if (files.length > 0) return files;
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
 * 真跑一次 `pnpm install --frozen-lockfile`，退出码原样转出去。
 *
 * 形态**不在这里判定**：走 `runPnpmSync`（`scripts/launcher-core/shell.mjs`）那唯一一条出口。
 * 自己拼 `spawnSync("pnpm", …, { shell: true })` 是错的形态 —— 它绕开了
 * `pnpmInvocation()`（Windows 上批处理形态在 Node 下起不来，见 §2.1.1），
 * 而这条流水线**只跑在 Windows 自托管节点上**，正是那一档。
 */
function runInstall() {
  const res = runPnpmSync(["install", "--frozen-lockfile"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (res.error) {
    /* 「命令没起来」与「跑完但非零」是两档：前者 stderr 通常是空的（见 runPnpmSync 契约）。 */
    process.stderr.write(
      `[ci-install-deps] ✗ 起不来（${res.command} ${res.args.join(" ")}）：${res.error.message}\n`,
    );
    return 1;
  }
  return res.status ?? 1;
}

/**
 * 入口。
 *
 * @param {{
 *   run?: (args: string[]) => {status: number, stdout: string},
 *   install?: (fingerprint: string | null) => number,
 *   root?: string,
 * }} [deps]
 *   全部可注入 —— 单测据此跑判定与出口，不碰真网络、不碰真安装。
 *   `install` 收到的是**装之前**算出的指纹（装成功后由本函数落盘）：先算后装，
 *   中途失败留下的半套就不会被记成已验证（文件头第 3 条）。
 * @returns {number} 退出码
 */
export function main(deps = {}) {
  const run =
    deps.run ??
    ((args) => {
      const out = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
      /* `status` 在 spawn 自身失败时是 `null` —— 那一档在这里与「退非零」同义
       * （都是「这条 diff 拿不到」），所以就地归一，不把 `null` 漏给调用方。 */
      return { status: out.status ?? 1, stdout: out.stdout ?? "" };
    });
  const root = deps.root ?? ROOT;
  const install = deps.install ?? runInstall;

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
  const code = install(expected);
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

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
