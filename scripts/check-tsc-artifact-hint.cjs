#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：组 A 失败时的定性提示（供 .githooks/pre-commit 调用）
/**
 * `check-tsc-artifact-hint.cjs` —— 组 A（`tsc --noEmit`）失败时，把「报错其实全在构建
 * 生成物里」这一种情形当场点破（ISSUE #1182 的方案 3）。
 *
 * 为什么会有这一种红：`tsconfig.json` 的 `include` 里**显式列着** Next 生成类型的那个
 * 目录（路由校验文件本来就该参与类型检查），`exclude` 又不含 `.next`，于是**半截的生成
 * 文件**会以「组 A 红」的形态出现，而本次改动里没有任何 `.next` 文件 —— 人会先怀疑自己
 * 刚写的代码。
 *
 * 半截文件不是凭空来的：同一目录并发起第二个 `next dev` 实例时，两个实例共写同一份
 * `.next/dev/types/`；而按硬规则 3 整树回收用的是 SIGKILL，落在写 `validator.ts` 的窗口
 * 里就留下一行被截断的生成代码。#1182 现场断在 `__IsExpected` 泛型半路，报 TS1005 与
 * TS1128 两条；本地复演同形截断，真 tsc 给出的是 TS1005 一条（判据对它成立）。
 *
 * 本脚本**不解决**共写，只做一件事：把排障成本从「怀疑自己」降到「一条命令」。
 * 根治的两条（实例级 `distDir` / 收法改温和）仍在 ISSUE #1182 上没做 —— 别把这条
 * 判据当成问题已闭。
 *
 * 用法（由 `.githooks/pre-commit` 的汇总段调用，只读日志、不改退出码）：
 *   node scripts/check-tsc-artifact-hint.cjs --file <组A日志>
 * 也支持 stdin 喂文本。任何情况下退出码都是 0（判决属于组 A 自己）。
 */

const fs = require("node:fs");

/** tsc 的一行报错：路径（可能带引号）+ (行,列) + error TS#### + 消息。 */
const ERROR_LINE =
  /(?:^|[\s(])("([^"]+)"|([^\s(]+))\((\d+),(\d+)\):\s+error\s+TS(\d+)/g;

/** 归一化路径分隔符：tsc 在 Windows 上给反斜杠，日志里也可能出现绝对路径。 */
function toPosix(p) {
  return String(p).replace(/\\/g, "/");
}

/**
 * 是不是 Next 的生成物（只有这一类才敢断言「不是你的改动」）。
 * 认的是 `.next/` 这**一个目录段**，不是任何以 `.next` 开头的名字。
 */
function isNextArtifact(filePath) {
  return /(^|\/)\.next\//.test(toPosix(filePath));
}

/**
 * 从 tsc 输出里分类：返回条数统计与「是否全部落在生成物上」。
 *
 * 没有任何 `error TS` 行时 `artifactOnly` 必须是 false —— 组 A 也会因别的原因红
 * （真类型错、OOM、参数错），那时还给出生成物提示就是把人往错方向带（哭一次狼，
 * 之后这条提示就没人信了）。
 */
function classifyTscErrors(text) {
  const files = [];
  let total = 0;
  for (const m of String(text).matchAll(ERROR_LINE)) {
    total += 1;
    const file = m[3] ?? m[2] ?? "";
    if (file) files.push(file);
  }
  const artifact = files.filter(isNextArtifact);
  return {
    total,
    files,
    artifactFiles: artifact,
    codeFiles: files.filter((f) => !isNextArtifact(f)),
    artifactOnly:
      total > 0 && files.length > 0 && artifact.length === files.length,
  };
}

/**
 * 处置命令先给「只删报错那个文件」这个最小动作，再给整目录删除。
 * 后者也验过：整目录没了不会引出新的红 —— `next-env.d.ts` 确实 import 了同目录的
 * `routes.d.ts`，但 tsc 对缺失的生成目录不报错（实测读数见同名测试）。
 */
function buildHint(v) {
  const unique = [...new Set(v.artifactFiles.map(toPosix))];
  return [
    "",
    "[组A-提示] 上面这些 tsc 报错**全部落在 Next 的构建生成物里**，不是你本次改的代码：",
    ...unique.map((f) => `  · ${f}`),
    "  成因（ISSUE #1182）：同一目录并发起第二个 `next dev` 实例时，两个实例共写同一份",
    "  `.next/dev/types/`；按硬规则 3 整树回收（SIGKILL）若落在写 `validator.ts` 的窗口里，",
    "  就留下一行被截断的生成代码 —— 语法错出在生成物上，而 `tsconfig.json` 的 `include`",
    "  显式列着这个生成目录，于是它以「组 A 红」的形态出现。",
    "  处置（是生成物，删掉让 Next 重新生成即可，不必动任何源码）：",
    ...unique.map((f) => `    POSIX:    rm -f ${f}`),
    "    整目录形态：rm -rf .next/dev/types   (Windows: Remove-Item -Recurse -Force .next\\dev\\types)",
    "  删完直接重跑提交即可；起一次 dev / build 会把这份生成物整份重写回来。",
    "  防复发：起第二实例时给它独立的 `.next`（`distDir` 按端口/实例分叉）或干脆别双开 ——",
    "  这一条**还没做**，根治方案记在 ISSUE #1182（本提示只做定性，不解决共写）。",
    "",
  ].join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const fileIdx = argv.indexOf("--file");
  let text = "";
  try {
    text = fs.readFileSync(
      fileIdx >= 0 && argv[fileIdx + 1] ? argv[fileIdx + 1] : 0,
      "utf8",
    );
  } catch {
    /* 读不到就安静退出：本脚本永远是附属信息，不该制造第二种失败形态。 */
    return 0;
  }
  const verdict = classifyTscErrors(text);
  if (verdict.artifactOnly) process.stdout.write(buildHint(verdict) + "\n");
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { classifyTscErrors, buildHint, isNextArtifact };
