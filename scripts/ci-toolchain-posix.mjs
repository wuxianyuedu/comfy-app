#!/usr/bin/env node
/**
 * ci-toolchain-posix.mjs — Linux 侧构建机的**宿主自证**（ISSUE #1993）。
 *
 * ## 为什么 Windows 侧没有对应的一份
 *
 * Windows 侧的前提由两条既有的步骤答完了：`工具链自证`（git / node / pnpm / Python
 * 四件 + corepack 三个形态）与 `Install dependencies`（`check-pnpm-available.mjs` 判
 * host 自己的解析面）。那两条都是**按 Windows 的形态**写的：`.ps1` 垫片、PATHEXT、
 * `winget` 装 Python。换到 Linux 上它们要么答不出来、要么答错（§2.1.1 那三个形态
 * 在 POSIX 上根本不存在），而「答不出来」在日志里与「没有装」逐字同形。
 *
 * 所以本文件不重写那四件的判据（它们仍是 `ci-toolchain-selfcheck.mjs` 的事），只补
 * **POSIX 独有的那几格**，每一格都对应一个「缺了不会红、只会静默少判」的形态：
 *
 * | 格 | 缺了会怎样 |
 * | --- | --- |
 * | `bash` | stage 的 shell 就是 `sh`，这里缺 `bash` 时它自己的脚本先崩，报错与判据无关 |
 * | coreutils（`mktemp` / `sha256sum` / `timeout`） | 门禁链里有几处子进程要它们（`timeout` 尤其：`e2e-run.mjs` 与 `kill-process-tree` 的 POSIX 分支都靠它兜底），缺了以「用例红」的形态出现 |
 * | `python3` | 与 Windows 侧同一个后果：`check-app-port-vectors.cjs` 那一侧**退出四侧比对**、几条实证用例走 `env` 档跳过（**静默少判**） |
 * | `node_modules/.bin/tsc` | POSIX 上它是符号链接，而**新检出里它不存在**（`pnpm install` 之后才有）。这条 stage 排在装依赖之前，所以它在这里只答「装完之后会不会有」—— 判据是「`package.json` 里有 typescript devDependency」，不是「现在都在」 |
 *
 * ## 判什么红、判什么只是读数
 *
 * 只有一条会红：**`bash` 不在**（stage shell 本身不可用，后面三十步全无意义）。
 * 其余全部只打读数、恒退 0 —— 与 `Python 探针读数` 同一条口径（打印不是判据），
 * 也与 §13.6.4.1「拿不到测量 ≠ 测量结果是红的」一致：`python3` 不在时正确的处置是
 * **让 `Python 可用性` 那一步去装**（它认得 apt / dnf / apk），不是在这里重复报一次红。
 *
 * ## 只用 `node:*`
 *
 * 与 `ci-toolchain-selfcheck.mjs` 逐字相同的硬约束：这一步跑在 `pnpm install` **之前**，
 * 那时 `node_modules` 还没有 —— import 任何仓库内模块都会让这一步以 `Cannot find
 * module` 收场，而它本来要回答的就是「这台机器上有什么」。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * 探一条命令在不在（`--version` 起一次；只看退出码）。
 *
 * @param {string} cmd
 * @param {string[]} [probeArgs]
 * @returns {boolean}
 */
function hasCommand(cmd, probeArgs = ["--version"]) {
  const r = spawnSync(cmd, probeArgs, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  return r.status === 0 && !r.error;
}

/**
 * 逐格自证，返回结构化结论（可注入，判据在单测里直接跑）。
 *
 * @param {{has?: (cmd: string, probeArgs?: string[]) => boolean,
 *          env?: Record<string, string | undefined>,
 *          cwd?: string,
 *          platform?: NodeJS.Platform,
 *          exists?: (p: string) => boolean}} [deps]
 * @returns {{verdict: "ready" | "broken", rows: Array<{格: string, 读数: string, ok: boolean}>, advice?: string}}
 */
export function probePosixHost({
  has = hasCommand,
  cwd = process.cwd(),
  exists = (/** @type {string} */ p) => fs.existsSync(p),
} = /** @type {{
  has?: (cmd: string, probeArgs?: string[]) => boolean,
  cwd?: string,
  exists?: (p: string) => boolean,
}} */ ({})) {
  /** @type {Array<{格: string, 读数: string, ok: boolean}>} */
  const rows = [];

  /* `bash` —— 唯一会红的一格。镜像里 `sh` 总是有，而 stage 脚本用的是 bash 语义
   * （`set -euo pipefail`、`[[ ]]`、数组），`dash` 解释不了那些。 */
  const bashOk = has("bash", ["--version"]);
  rows.push({
    格: "bash",
    读数: bashOk ? "在" : "不在（stage 脚本用 bash 语义，dash 解释不了）",
    ok: bashOk,
  });

  /** @type {Array<[string, string[]]>} */
  const tools = [
    ["mktemp", ["--version"]],
    ["sha256sum", ["--version"]],
    ["timeout", ["--version"]],
    ["git", ["--version"]],
    ["node", ["--version"]],
    ["pnpm", ["--version"]],
  ];
  for (const [cmd, probeArgs] of tools) {
    rows.push({
      格: cmd,
      读数: has(cmd, probeArgs) ? "在" : "不在（门禁链里有子进程要它）",
      ok: true,
    });
  }

  /* python3：**只打读数**（处置归 `Python 可用性`：它认得 apt / dnf / apk，会就地装）。 */
  const pyOk = has("python3", ["--version"]);
  rows.push({
    格: "python3",
    读数: pyOk
      ? "在"
      : "不在 —— 处置归 `Python 可用性` 那一步（它会按 apt / dnf / apk 装）；这一格只是读数",
    ok: true,
  });

  /* `node_modules/.bin/tsc`：**不判「现在在不在」**（这一步跑在装依赖之前，新检出里必然
   * 不在 —— 判它就是每个新节点首跑必红）。判的是「装完之后会不会有」这件事的事实源：
   * `package.json` 声明了 typescript devDependency。 */
  /** @type {{devDependencies?: Record<string, string>} | null} */
  const pkg = (() => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
      );
    } catch {
      return null;
    }
  })();
  const declaresTsc = Boolean(pkg?.devDependencies?.typescript ?? pkg?.devDependencies?.["@typescript/native"]);
  rows.push({
    格: "node_modules/.bin/tsc",
    读数: exists(path.join(cwd, "node_modules", ".bin", "tsc"))
      ? "已解析到（装依赖之前就在：这是**不是**全新检出的一台机器）"
      : declaresTsc
        ? "现在不在（新检出的正常形态）；`package.json` 声明了 typescript，装完依赖会有"
        : "现在不在，而 `package.json` 也没声明 typescript —— 类型检查那一步会静默绕过",
    /* ⚠️ **恒 ok**：这一格是读数，不是判据。它跑在 `pnpm install` **之前**，
     * 新检出里 `node_modules/.bin/tsc` 必然不在 —— 拿它判红等于每个新节点首跑必红，
     * 而那条红与「这台机器缺什么」毫无关系（类型检查那一步会以 `Cannot find` 收场，
     * 那才是该红的位置）。本文件的判据只收一条：`bash`。 */
    ok: true,
  });

  const broken = rows.filter((r) => !r.ok);
  return {
    verdict: broken.length > 0 ? "broken" : "ready",
    rows,
    ...(broken.length > 0
      ? {
          advice:
            "缺 `bash` ⇒ stage shell 本身不可用，后面每一步的失败都与判据无关。" +
            "先在这台节点上装 bash（Debian/Ubuntu：`apt-get install -y bash`；" +
            "Alpine：`apk add bash`），再重跑这条流水线。",
        }
      : {}),
  };
}

/**
 * 入口。
 *
 * @param {{probe?: typeof probePosixHost, out?: (s: string) => void}} [deps]
 * @returns {number} 退出码
 */
export function main(deps = {}) {
  const probe = deps.probe ?? probePosixHost;
  const out = deps.out ?? ((/** @type {string} */ s) => process.stdout.write(s));
  const result = probe();
  const lines = ["== POSIX 宿主自证 =="];
  for (const row of result.rows) {
    lines.push(`${row.ok ? "✓" : "✗"} ${row.格}：${row.读数}`);
  }
  if (result.advice) lines.push("", result.advice);
  out(`${lines.join("\n")}\n`);
  return result.verdict === "ready" ? 0 : 1;
}

/* 判「是不是被直接运行」用 `fileURLToPath`，**不拼 `file://${argv[1]}`**：
 * 那个拼法在 Windows 上恒不相等（两斜杠 + 反斜杠 vs 三斜杠 + 正斜杠），`main()`
 * 一次都不跑、进程退 0 且零输出 —— 那是「这一步没跑」被读成「这一步过了」
 * （`tests/script-main-guard.test.ts` 判的就是这一形态）。本文件虽然只在 POSIX 上跑，
 * 但那个守卫是全仓级的，破一次就是一条需要逐文件解释的例外。 */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
