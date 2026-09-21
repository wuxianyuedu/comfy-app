#!/usr/bin/env node
// 命令行回收一个 PID 的整棵进程树（跨平台）。
//
// 为什么要有这个入口：编排器之外还有**几个宿主进程**需要在极端路径上补一刀
// （Python 启动器的监控线程 / 兜底回收、构建脚本的残留壳清理）。它们各自去拼
// `taskkill` / kill 命令，就又是一处会静默分叉的平台判据 —— 而「各写一遍」
// 正是历史「单杀留孤儿」反复出现的原因。
//
// 用法：node scripts/reap-process.mjs <pid> [--force] [--detach]
// 退出码：0 回收命令成功结束；1 参数不合法，或回收命令报了失败（via 里带退出码）。
// 结果以一行文本打印（via），便于宿主解析或写进日志。
//
// `--detach` 是给**正在退出、等不起**的宿主用的（壳的 Exit 事件、python 启动器
// 的收尾）：这些调用点在 `process.exit()` 前只留得下几十毫秒，而 `wait: true`
// 要等 taskkill 跑完。加上它改为「派发完就返回」——回收命令已经落地，宿主随后
// 退出不会把它带走。默认仍是等待（结果可核对，见 kill-process-tree 的 wait 注释）。

const arg = process.argv[2] ?? "";
const pid = Number.parseInt(arg, 10);
if (!Number.isInteger(pid) || pid <= 0) {
  process.stderr.write(`[reap-process] 无效 PID：${arg || "(缺参数)"}\n`);
  process.exit(1);
}
const force = process.argv.includes("--force");
// 见文件头：等不起的宿主（自杀路径）用 --detach 派发即返回。
const detach = process.argv.includes("--detach");

// 说明符经常量中转只是写法（tsc 对「字面量 import 带 .ts 扩展」只认 TS5097，见
// scripts/dev-launcher.mjs 同一处的说明），**路径本身是原样的字面量**：不拼字符串、
// 不裁扩展名。拼出来的形态换目录时只在执行到这一行才炸（ERR_MODULE_NOT_FOUND），
// 而调用它的全是「回收残留进程」这类异常路径，最先坏掉的正是兜底本身。
// 同一份说明符在 scripts/dev-launcher.mjs 里也有一处，两处一起改；
// tests/cross-platform-launcher.test.ts 会核对它们指向的文件真实存在。
try {
  const specifier = "../src/lib/process/kill-process-tree.ts";
  const mod = await import(specifier);
  const result = await mod.killProcessTree({
    pid,
    detached: process.platform !== "win32",
    force,
    // 派发完就 exit 是本入口的形态：Windows 上 taskkill 是独立进程，不等它结束就
    // 会被父进程的退出一起带走 —— 现象是「打印了命令、退出码 0、目标进程还在」。
    // 等到它结束，stdout 里的 via 也带上退出码，宿主日志能看出这一刀落没落。
    wait: !detach,
  });
  process.stdout.write(`${result.via}\n`);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  // 动态加载失败时给出可行动的报错（不静默成功）：调用方据此走自己的兜底提示。
  // 模块路径就在 error.message 里（Cannot find module '…'），不另拼一份免得多一处会漂。
  process.stderr.write(
    `[reap-process] 无法加载进程树回收模块：${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
