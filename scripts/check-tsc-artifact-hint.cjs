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
 * 另两条候选已按实测判死（ISSUE #1182 已关）：① 「给第二实例换 `distDir`」不消除共写，只是
 * 把共写从生成物搬到两个全检出共享的文件上 —— Next 会把当前 distDir **追加进受版本控制的
 * `tsconfig.json` 的 `include`**（于是那个实例的半截 `validator.ts` 照样进组 A，还额外弄脏
 * 工作区），并改写 `next-env.d.ts` 的 import 指向它（换完目录那两行悬空时 tsc **不报错**，
 * 于是从「当场红 + 一条命令处置」退化成「静默失去路由类型校验」，更坏）；② Windows 侧没有
 * 温和原语可换 —— `windowsKillArgs()` 恒发 `/T /F`，`force` 只在 POSIX 分叉 SIGTERM/SIGKILL。
 * 所以防复发只剩「别在同一目录双开」这一条纪律（并行验证走 `git worktree`，§13.6.2）。
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
 * 是不是构建/工作台的生成物（只有这一类才敢断言「不是你的改动」）。
 *
 * 认的是两个**目录段**，不是任何以它们开头的名字（`.nextify/` 不算）：
 *  · `.next/` —— Next 的生成物（ISSUE #1182 的现场）；
 *  · `.storybook/generated/` —— 组件工作台的生成件，由 `scripts/storybook-assets.mjs`
 *    在 `pnpm storybook` 启动时现算、整目录 gitignore（ISSUE #1409 提到的同族）。
 *    它今天已不再被任何源码静态 import（那条修法见 ISSUE #1409 的 PR），但
 *    「生成物里的报错」这一类形态仍然会以组 A 出现，认得出来就能少一轮怀疑自己。
 */
function isArtifact(filePath) {
  const p = toPosix(filePath);
  return /(^|\/)\.next\//.test(p) || /(^|\/)\.storybook\/generated\//.test(p);
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
  const artifact = files.filter(isArtifact);
  return {
    total,
    files,
    artifactFiles: artifact,
    codeFiles: files.filter((f) => !isArtifact(f)),
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
  /* 两类生成物的成因不同，处置命令也不同：只给「两类都成立」的那条通用话术，
     再按实际命中补各自的具体动作。 */
  const hasNext = unique.some((f) => f.includes(".next/"));
  const hasStorybook = unique.some((f) => f.includes(".storybook/generated/"));
  return [
    "",
    "[组A-提示] 上面这些 tsc 报错**全部落在构建/工作台的生成物里**，不是你本次改的代码：",
    ...unique.map((f) => `  · ${f}`),
    ...(hasNext
      ? [
          "  成因（ISSUE #1182）：同一目录并发起第二个 `next dev` 实例时，两个实例共写同一份",
          "  `.next/dev/types/`；按硬规则 3 整树回收（SIGKILL）若落在写 `validator.ts` 的窗口里，",
          "  就留下一行被截断的生成代码 —— 语法错出在生成物上，而 `tsconfig.json` 的 `include`",
          "  显式列着这个生成目录，于是它以「组 A 红」的形态出现。",
        ]
      : []),
    ...(hasStorybook
      ? [
          "  成因（ISSUE #1409 同族）：`.storybook/generated/` 是组件工作台的生成件，由",
          "  `scripts/storybook-assets.mjs` 在 `pnpm storybook` 启动时现算、整目录 gitignore。",
          "  它**不该**被源码静态 import（那会让没跑过工作台的检出 tsc 必红），所以现在还能",
          "  在这里报错，多半是有人重新 `import` 了它，或者半截生成件被写坏了。",
        ]
      : []),
    "  处置（是生成物，删掉让它重新生成即可，不必动任何源码）：",
    ...unique.map((f) => `    POSIX:    rm -f ${f}`),
    ...(hasNext
      ? [
          "    整目录形态：rm -rf .next/dev/types   (Windows: Remove-Item -Recurse -Force .next\\dev\\types)",
        ]
      : []),
    ...(hasStorybook
      ? [
          "    整目录形态：rm -rf .storybook/generated   (Windows: Remove-Item -Recurse -Force .storybook\\generated)",
        ]
      : []),
    "  删完直接重跑提交即可；起一次 dev / build / `pnpm storybook` 会把那份生成物重写回来。",
    ...(hasNext
      ? [
          "  防复发：**别在同一目录双开 `next dev`**。给第二个实例换一个 `distDir` 会更糟（实测",
          "  Next 16.3.5：它会把那个实例目录**追加进受版本控制的 `tsconfig.json` 的 `include`**，并把",
          "  共享的 `next-env.d.ts` 改写成指向它）—— 共写没消除，只是从生成物搬到两个人人都改的文件上，",
          "  而红照旧（生成目录被 Next 自己写进 include）。要并行验证就走 `git worktree`（§13.6.2），",
          "  或直接复用已经在跑的那个实例。这条与收法都记在 ISSUE #1182（本提示只做定性）。",
        ]
      : []),
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

module.exports = { classifyTscErrors, buildHint, isArtifact };
