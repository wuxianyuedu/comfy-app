#!/usr/bin/env node
// pnpm 可用性自检（跨平台，`pnpm check:toolchain`）。
//
// 为什么单独有一个入口：工具链门禁跑在**启动链路里**，命中失败就直接中断启动；
// 而「pnpm 到底怎么了」这个问题，用户最需要的时刻恰恰是「启动被拦下之后」——
// 那时他希望**只跑一次自查**、看到结论与修复动作，而不是反复双击入口撞同一堵墙。
//
// 本脚本是一个**薄壳**：所有判据都在 `scripts/launcher-core/` 里（`whichCommand`
// 的可执行形态选择、`probePnpm` 的探测、`orchestratePnpm` 的自动重建与复核、
// `buildTip` 的修复文案）。这里只负责打印与退出码 —— 判据一旦在这里重写一遍，
// 就有了第二份「pnpm 为什么不работает」的答案（Issue #576 的教训）。
//
// **版本不一致时做什么，必须与启动器同一条口径**（Issue #576 第三轮）：
// 启动链路里版本不一致是**自动对齐**的（`reconcilePnpmVersion()` → `preparePnpm()`
// + 同一条探测复核），而自检此前只 WARN 一句、什么也不做 —— 于是「白跑一趟：
// 真启动时它自己会好，用户却得手动跑 corepack」，`prepare-local-run.ps1` 的第 3 步
// 也早已自动对齐。现在自检**先试同一条对齐动作**，复核通过就报 OK（并说明做了什么），
// 只有复核仍不一致才 WARN + 给动作；启动器真正会拒绝的「node_modules 未装」
// 也一并检查，避免用户按自检的 OK 去启动、却被门禁拦在下一关。
//
// 「依赖未装」的措辞是判据的一部分（ISSUE #1568）：它必须同时说清
// 「能装」与「装完能跑什么」，否则读起来像「本机跑不了门禁」——实测有人据此
// 跳过 tsc / eslint / vitest 并把结论写进提交信息（见规范 §13.6.3）。
// 该分支的 node_modules 判据直接 import 启动器的 `checkNodeModules()`，
// 不再在本文件里维护一份弱化副本（此前只查 `.modules.yaml` 一项，与启动器的
// 「.modules.yaml + .bin/next + 关键依赖目录」两份口径会各自漂移）。
//
// 退出码：0 = pnpm 可用（版本不一致只是 WARN，与启动器一致：不阻断启动）；
//        1 = 不可用（提示已打印，可直接照做）。
import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { orchestratePnpm, preparePnpm, probePnpm } from "./launcher-core/corepack.mjs";
import { commandInvocation } from "./launcher-core/shell.mjs";
import { checkNodeModules } from "./launcher-core/worktree.mjs";
import {
  collectDependencyFloors,
  describeNodeAgainstFloor,
} from "./node-engines.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `--deps-root <path>`：**只给契约测试**用 —— 让用例能指一个「没有 node_modules」的
 * 目录，真跑依赖判据那一分支的退出码与话术（ISSUE #1568 的整条判据就落在措辞上）。
 * **只换依赖检查的根、不换工具链探测的根**：后者要读本检出的 `package.json`
 * 拿 `packageManager`，跟着换会让自检报告一个与本检出无关的 pnpm 版本。
 */
const depsRootArgIndex = process.argv.indexOf("--deps-root");
const depsRoot =
  depsRootArgIndex >= 0 && process.argv[depsRootArgIndex + 1]
    ? path.resolve(process.argv[depsRootArgIndex + 1])
    : root;

/** 打印一行结论（纯 ASCII 前缀 + 原文，便于日志检索）。 */
function say(prefix, message) {
  process.stdout.write(`${prefix} ${message}\n`);
}

/** 只比数字主体：`v12.4.1` 与 `12.4.1` 是同一个版本（判据与启动器一致）。 */
function sameVersion(a, b) {
  if (!a || !b) return false;
  return a.replace(/^v/, "") === b.replace(/^v/, "");
}

const result = orchestratePnpm({ root });

if (!result.probe.ok) {
  say("[ERROR]", "pnpm 不可用 —— 启动链路会在工具链门禁处停下。");
  process.stdout.write("\n");
  process.stdout.write(result.tip ?? "（没有可用的修复提示，请检查 launcher-core/corepack.mjs 的 buildTip）\n");
  process.stdout.write("\n");
  process.stdout.write(
    [
      "自查入口：pnpm check:toolchain",
      "本脚本不修改任何全局状态（例外：spawn-error 一类会自动 corepack prepare 重建，并复核结果）。",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

say("[OK]  ", `pnpm 可用：${result.probe.version}（${result.probe.command}）`);
// 「探到的是哪个 pnpm」要能一眼看清：PATH 上并存多个形态（corepack 的无扩展名
// shim / .cmd / .ps1 / 独立安装）时，选中的文件与**真正被 spawn 的命令**常常不是
// 同一个 —— `.ps1` 形态经 PowerShell 宿主执行，命令名打印出来就是 pwsh.EXE，于是
// 「本机版本为什么是 10.34.5」成了无解的问题（ISSUE #576 第四轮）。两件事分开列：
// 选中的文件 = PATH 上命中的那个；实际命令 = 探测时它究竟怎么被起起来。
if (result.probe.command) {
  const invocation = commandInvocation(result.probe.command, ["-v"]);
  const viaHost = invocation.command !== result.probe.command;
  say("[INFO]", `选中的 pnpm：${result.probe.command}`);
  if (viaHost) {
    say("[INFO]", `经宿主执行：${invocation.command} ${invocation.prefixArgs.join(" ")} → ${result.probe.command}`);
  }
}
if (result.repaired || result.tip) say("[INFO]", result.tip);

// 版本一致性：先按启动器的口径**试一次自动对齐**，复核通过才算「一致」。
if (result.expected && !sameVersion(result.probe.version, result.expected)) {
  const before = result.probe.version;
  say("[WARN]", `版本与 package.json 要求不一致（本机 ${before}，要求 ${result.expected}）—— 尝试 corepack 自动对齐…`);
  const prepare = preparePnpm({ root, expected: result.expected });
  const after = probePnpm({ root });
  if (after.ok && sameVersion(after.version, result.expected)) {
    say("[OK]  ", `已对齐：pnpm ${before} → ${after.version}（${prepare.description}）。`);
  } else {
    say("[WARN]", `自动对齐未生效（${prepare.description}，当前 ${after.ok ? after.version : "不可用"}）。`);
    say("[INFO]", "版本漂移先查上面「选中的 pnpm」：PATH 上并存了另一个 pnpm" +
      "（独立安装 / 另一个 corepack 副本）时，用到的就是它，与本目录的 package.json 无关。");
    say("[INFO]", "启动器对此只 WARN、不阻断启动；要手动对齐：");
    process.stdout.write(`         corepack enable && corepack prepare pnpm@${result.expected} --activate\n`);
  }
} else if (result.expected) {
  say("[OK]  ", `版本与 package.json 的 packageManager 一致（pnpm@${result.expected}）。`);
}

/* Node 下限：与依赖自己声明的 `engines.node` 现算比对（判据在 `node-engines.mjs`，
 * 这里只打印 —— 与上面 pnpm 那条同一口径，不在薄壳里重写第二份答案）。
 *
 * 为什么值得单列一行：`next` 的下限比测试链低得多（`>=20.9.0`），所以在低版本 Node 上
 * 「开发链路全绿、只有用例档炸」是默认结局，而报错形状是 `Cannot find module` 一类、
 * 指不出「该换 Node」。这一行把那句话正面说出来。
 * 退出码不因此改成非零：本入口的定位是「回答能不能跑、给动作」，
 * 拦截属启动器与钩子的事（与 pnpm 版本不一致只 WARN 同一立场）。 */
const nodeVersion = process.env.COMFYAPP_NODE_VERSION ?? process.version;
const declaredFloor =
  JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))?.engines?.node ?? null;
const floorVerdict = describeNodeAgainstFloor({
  version: nodeVersion,
  range: declaredFloor,
  floors: collectDependencyFloors(root).floors ?? [],
});
if (!declaredFloor) {
  say("[WARN]", "package.json 没有 engines.node —— Node 下限无人声明（见规范 §2.1.8）。");
} else if (floorVerdict.kind === "unparsable") {
  say("[WARN]", `Node 下限这条判据没跑起来：本机 ${nodeVersion} 或 engines.node 读不懂。`);
} else if (floorVerdict.ok) {
  say("[OK]  ", `Node ${floorVerdict.version} 在声明范围内（engines.node = ${declaredFloor}）。`);
} else {
  say("[WARN]", `Node ${floorVerdict.version} 不在声明范围内（engines.node = ${declaredFloor}）。`);
  const next = floorVerdict.recommend ? ` 建议升到 ${floorVerdict.recommend}` : "";
  say("[INFO]", `越界会踩到的档：${floorVerdict.violated.join(" / ") || "（依赖侧未点名）"}。${next}`);
  process.stdout.write(
    [
      "         [判据] 低版本 Node 上 `next dev` / `next build` 照常，",
      "                坏的是测试档（vitest / jsdom / msw 的下限都高于 next 自己的）。",
      "         [动作] 按 engines.node 换版本（nvm use 读 .nvmrc；桌面 sidecar 同版本线）。",
      "",
    ].join("\n"),
  );
}

// node_modules：启动器的**另一道**门禁，自检不把它藏起来。
//
// 「未装依赖」必须与「跑不到门禁」分成两件事说清楚（ISSUE #1568）：本仓库依赖全部
// 来自公开 registry（`pnpm-workspace.yaml` 里没有任何私有源配置），所以**任何**检出
// 都能把依赖装上 —— 无 `node_modules` 只是「还没装」，不是「装不了」。此前这里只
// 打印一句 WARN + `pnpm install`，读起来像「环境不支持」；实测在无依赖容器里据此
// 得出「走不到 tsc / eslint / vitest」的结论、并把它写进提交信息，于是类型错位绕过
// 所有门禁落进 `master`（复算：装完依赖后 `tsc --noEmit` / `eslint` / `vitest` 全部
// 可跑）。所以这一段要正面回答那个被误判的问题：能装、装多久、装完能跑什么。
const modules = checkNodeModules(depsRoot);
if (modules.healthy) {
  say("[OK]  ", "node_modules 已装（.modules.yaml + 关键依赖齐全）—— tsc / eslint / vitest 都能跑。");
} else {
  say("[WARN]", `node_modules 未装或不完整（${modules.reasons.join("；")}）—— 启动器会在「完整依赖预检」拦下。`);
  process.stdout.write(
    [
      "         [判据] 依赖**可装**：本仓库依赖全部来自公开 registry，无私有源；",
      "                无 node_modules 只表示「还没装」，不表示「本机跑不了门禁」。",
      "         [动作] pnpm install --frozen-lockfile（首次上手先 pnpm env:init 生成 .env）",
      "                —— 冷装实测约 8 分钟，装完 tsc --noEmit / eslint / vitest 都能跑。",
      "         [禁止] 以「本容器无 node_modules」为由跳过 tsc / eslint / vitest ——",
      "                那会把类型 / lint / 用例的红直接放进 master（见规范 §13.6.3）。",
      "",
    ].join("\n"),
  );
}

process.stdout.write(
  [
    "",
    "自查入口：pnpm check:toolchain",
    "本脚本不修改任何全局状态（例外：spawn-error 一类会自动 corepack prepare 重建，并复核结果）。",
    "",
  ].join("\n"),
);
process.exit(0);
