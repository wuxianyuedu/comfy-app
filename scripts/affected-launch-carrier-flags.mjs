/**
 * affected-launch-carrier-flags.mjs — 启动器的**旗标面**：认识哪些、`--changed-stdin` 怎么消费。
 *
 * ## 它修的那一格（ISSUE #2869）
 *
 * `run-affected-tests.mjs` 此前对 `--changed-stdin` **既不认识也不拒绝**：旗标进了 argv、
 * 没人读，改动面仍从 `COMFY_AFFECTED_CHANGED` / 暂存区取。于是
 * `node scripts/run-affected-tests.mjs --changed-stdin < 清单` 静默退回固定清单 ——
 * 看着全绿，实际这一份改动对应的用例一条没跑（**假绿**）。
 *
 * 两件事必须一起做（缺任一件仍然是静默）：
 *   ① `--changed-stdin` **真消费**：读 stdin 的清单，归一进下游唯一载体
 *      `COMFY_AFFECTED_CHANGED`（`collectList()` 与归因建议都只读它，不另造第二份入口）；
 *   ② 读不到 / 读出来是空清单 ⇒ **退 2 并喊出来**，绝不降回固定清单 ——
 *      空集那条路会让启动器跑成**全量**，而「全量绿」在本地预检里是被规范否掉的读数
 *      （§13.5.21 同一口径）。不认识的非空 `--*` 旗标同样退 2：拼错一个旗标
 *      与没写一样，都必须在当下看见，不能等到「怎么这次没跑那份用例」才发现。
 */
import fs from "node:fs";
import process from "node:process";

/** 本启动器认识的旗标（与 `main()` 里的 `argv.includes` 逐个对应）。 */
export const KNOWN_LAUNCH_FLAGS = Object.freeze([
  "--dry-run",
  "--update-timing",
  "--isolated",
  "--full",
  "--changed-stdin",
]);

/** @param {string[]} argv 不认识的那些（空数组 = 全部认识）。 */
export function unknownLaunchFlags(argv) {
  return argv.filter((a) => a.startsWith("--") && !KNOWN_LAUNCH_FLAGS.includes(a));
}

/** stdin 的清单（一行一个路径）。TTY / 读不动 ⇒ `null`（调用方退 2）。 */
function stdinPaths() {
  if (process.stdin.isTTY) {
    return null;
  }
  try {
    return fs
      .readFileSync(0, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * 入口处的载体判决与话术：不认识的旗标 / 读不到 / 空清单，一律**退 2**，不降档。
 * 话术由本模块自己写（启动器那一层只落退出码，900 行硬闸在 `run-affected-tests.mjs`）。
 *
 * @param {string[]} argv
 * @returns {2 | null} `null` = 继续；`2` = 已写话术，调用方按此退出。
 */
export function applyLaunchCarrier(argv) {
  const unknown = unknownLaunchFlags(argv);
  if (unknown.length > 0) {
    process.stderr.write(
      `[affected-launch] 不认识的旗标 ${unknown.join(" ")} ⇒ 退 2，不猜。` +
        `认识的只有 ${KNOWN_LAUNCH_FLAGS.join(" ")}\n`,
    );
    return 2;
  }
  if (!argv.includes("--changed-stdin")) {
    return null;
  }
  if (argv.includes("--full")) {
    process.stderr.write(
      "[affected-launch] --full 与 --changed-stdin 互斥（全量档不读改动面）⇒ 退 2\n",
    );
    return 2;
  }
  const paths = stdinPaths();
  if (paths === null) {
    process.stderr.write(
      "[affected-launch] --changed-stdin 要从 stdin 读清单，但当前读不到 ⇒ 退 2" +
        "（不退回固定清单：那会让这一跑变成假绿）\n",
    );
    return 2;
  }
  if (paths.length === 0) {
    process.stderr.write(
      "[affected-launch] --changed-stdin 读到的清单是空的 ⇒ 退 2" +
        "（空集会让启动器跑成全量，绝不当绿）\n",
    );
    return 2;
  }
  /* 下游只认这一份载体（清单那一跳与归因建议同读它），所以把 stdin 归一进环境变量。 */
  process.env.COMFY_AFFECTED_CHANGED = paths.join("\n");
  process.stderr.write(
    `[affected-launch] 改动面自 stdin：${paths.length} 条（已归一进 COMFY_AFFECTED_CHANGED）\n`,
  );
  return null;
}
