#!/usr/bin/env node
/**
 * known-failed-args.mjs — 把「跳过已知基线失败用例」的 vitest 参数打给 **PowerShell 侧**
 *
 * 为什么要有这个进程边界：`tools/start/verify-quality.ps1`（门禁）与
 * `tools/start/run-tests.ps1`（单跑）都要按同一份登记表给 vitest 加参数。此前它们
 * 拿正则去 `scripts/quality-gate-shared.mjs` 的**源码文本**里抠字符串字面量 ——
 * 那等于把另一门语言的源码当数据源：改一次写法（多一层对象、换成 `const`、
 * 换引号）就会静默抠出空数组，排除项悄悄失效（ISSUE #1282 的同族现场）。
 * 现在参数由**那个模块自己**算好、由 Node 打出来，PowerShell 只负责转交。
 *
 * 输出协议（**每行一个参数**，不是空格分隔）：`-t` 一行、模式一行、空表时零行。
 * 模式里必然含空格（用例全名按 `" > "` 连接），按空白切会把它拆碎 ⇒ 排除静默失效；
 * 这正是本文件存在的一半理由。
 *
 * 用法（`-File` 之外的参数按原样交给运行时）：
 *   node scripts/known-failed-args.mjs            # 打印参数，一行一个
 *   node scripts/known-failed-args.mjs --count    # 只打印登记项条数（给话术用）
 *   node scripts/known-failed-args.mjs --describe # 打印给人看的一行一句（登记项）
 */
import process from "node:process";

import {
  KNOWN_FAILED_CASES,
  describeKnownFailedCases,
  vitestExcludeArgs,
} from "./quality-gate-shared.mjs";

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--count")) {
    process.stdout.write(`${KNOWN_FAILED_CASES.length}\n`);
    return 0;
  }
  if (argv.includes("--describe")) {
    process.stdout.write(
      KNOWN_FAILED_CASES.length === 0
        ? ""
        : describeKnownFailedCases(KNOWN_FAILED_CASES).join("\n") + "\n",
    );
    return 0;
  }
  const args = vitestExcludeArgs(KNOWN_FAILED_CASES);
  process.stdout.write(args.length === 0 ? "" : args.join("\n") + "\n");
  return 0;
}

process.exit(main());
