#!/usr/bin/env node
/**
 * `python-probe.mjs` — 把「这台机器上哪个解释器真能跑」**按命令成立与否**分开打印。
 *
 * ## 为什么需要它（它不是 `ci-toolchain-selfcheck.mjs --python-only` 的第二份）
 *
 * `--python-only` 回答的是「**门禁链要的那个**解释器在不在」：它沿着
 * `python3 → python → py`（Windows 上 `python → py → python3`）挑**第一个真起得来**的，
 * 挑到就停。那是对的 —— 它要的决定只有一个：**能不能往下跑**。
 *
 * 但它答不了下一个问题：**另外那几个命令在哪？** 而流水线上缺件的那一格，人要有
 * 下一动作就得知道这条分岔：
 *
 *   · `python` 起不来、`py` 起得来 —— 两者**都是**「有解释器」。
 *     `py` 是官方启动器（`py -3 --version` 才是它的可用判据，裸 `py` 是「列出已装版本」
 *     并退非零）。这种机器上 `python -V` 的报错与「压根没装」**逐字同形**。
 *   · 三个都起不来，但盘上找得到安装根 —— 是「装过、这个执行账号的 PATH 里没有它」。
 *   · 三个都起不来、安装根也零命中 —— 才是「这台机真没装」。
 *
 * 一句话：`--python-only` 判**结论**，本脚本列**论据**。两者的解释器解析**共用同一份**
 * `./ci-toolchain-python.mjs`（`findPython` / `pythonForensics`），所以不会各判一次
 * —— 那是 #1959 第二轮红过的形态（配置里探的面与门禁探的面不是同一份）。
 *
 * ## 它为什么不进任何 steps
 *
 * 它答的是 **HEAD 的事**（「这台机器上有什么」），与源码无关；而 `steps` 内联进
 * 工作区、被 checkout 时 `git checkout -f` 抹掉（`scripts/check-ps1-consistency.mjs`
 * 已把这条钉住：`.cnb.yml` 点名的每个入口都必须在盘上）。所以它由
 * `.cnb.yml` 的 `env`（`COMFYAPP_PYTHON_PROBE`）点名，Python 缺件时由
 * `.githooks/pre-commit` 的 C 组调用。
 *
 * 退出码恒为 0：它是**打印**，不是判据。判据那一份只有 `--python-only` 一个。
 */
import path from "node:path";

import { findPython, pythonForensics } from "./ci-toolchain-python.mjs";

/** 与 `ci-toolchain-python.mjs` 的 `PY_CANDIDATES` 同口径（那里是唯一出处）。 */
const CANDIDATES =
  process.platform === "win32"
    ? ["python", "py", "python3"]
    : ["python3", "python"];
/** 裸 `py` 是「列出已装版本」并退非零，必须带 `-3`。 */
const PROBE_ARGS = /** @type {Record<string, string[]>} */ ({
  py: ["-3", "--version"],
});

/**
 * 逐个候选问一次「这个**命令**起不起得来」，**不提前返回**（与 `findPython` 的唯一区别）。
 *
 * @param {{run?: (cmd: string, args: string[]) => {ok: boolean, out: string}}} [io]
 * @returns {string[]} 要逐行打印的内容
 */
export function probeLines({ run } = {}) {
  const lines = [`running: node ${process.version} on ${process.platform}`];
  const usable = [];
  for (const name of CANDIDATES) {
    const args = PROBE_ARGS[name] ?? ["--version"];
    /* 走 `findPython` 的同一份探测实现（只探这一个候选）——避免本文件自己
     * 再写一遍 spawnSync 的包装，那正是「同一个问题两张候选表」的起点。 */
    const hit = findPython({
      ...(run ? { run } : {}),
      candidates: [name],
      probeArgs: { [name]: args },
    });
    if (hit) {
      lines.push(`ok   ${name} ${args.join(" ")}  →  ${hit.version}`);
      usable.push(name);
    } else {
      lines.push(`--   ${name} 不在 PATH 上，或起不来`);
    }
  }
  lines.push("");
  if (usable.length > 0) {
    lines.push(
      `至少 ${usable.length} 个可用（${usable.join(" / ")}）—— 门禁链要的解释器在这台机器上`,
    );
  } else {
    lines.push("一个可用解释器都没有，下面是取证：");
    lines.push(...pythonForensics());
    lines.push(
      `装好后重跑本命令即可。需要自动安装时：node scripts/ci-toolchain-selfcheck.mjs --python-only`,
    );
  }
  return lines;
}

if (
  process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`
) {
  for (const line of probeLines()) console.log(line);
  process.exit(0);
}
