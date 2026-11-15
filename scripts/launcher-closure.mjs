/**
 * launcher-closure.mjs — 编排器（`dev-launcher.mjs`）相对 import 闭包的唯一实现。
 *
 * 消费方两处：
 *   · `tests/dist-artifact-hygiene.test.ts`：产物 `scripts/` 白名单的完备性判据 ——
 *     `RUNTIME_SCRIPTS` / `ALLOWED_SCRIPTS` 必须覆盖闭包内每个模块，漏登记的表现是
 *     桌包重编排即 `ERR_MODULE_NOT_FOUND`（用户只看得到「双击没反应」）；
 *   · `scripts/affected-tests.mjs`：受影响用例面 —— 改动落在闭包内时把上面的判据
 *     用例带进增量面。那份判据对闭包成员的消费是**运行时读文本解析**，静态 import
 *     图追不到（它只静态 import `standalone-private-inputs.mjs`），不改这一格的话
 *     「新增内部分件漏登记」会以同一形态反复漏出去（ISSUE #3812）。
 *
 * 为什么是源码解析而非 `import()`：真加载会执行编排器顶层（预检、写会话锚点）；
 * 这里只问「重编排会不会缺件」，静态说明符出现即成立（ESM 加载期解析整张图）。
 * 行注释须先剥掉：JSDoc 的 `import("../lockfile/lock-diff.d.mts")` 是类型引用，
 * 不参与运行期加载。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";

/** 编排器入口（相对仓库根）：`src-tauri` 的项目根判据（`looks_like_project_root`）也认它。 */
export const LAUNCHER_ENTRY = "scripts/dev-launcher.mjs";

/**
 * 收集编排器的相对 import 闭包（只跟 `scripts/` 下的 `.mjs`，含入口自身）。
 *
 * @param {{ entry?: string, readText?: (abs: string) => string | null, exists?: (abs: string) => boolean }} [io]
 *   `entry` 相对仓库根（也接受绝对路径）；`readText` / `exists` 可注入（单测夹具），
 *   缺省走真实文件系统。读不到的文件按「没有相对 import」处理（与「文件不存在」同形）。
 * @returns {Set<string>} 闭包成员，**相对仓库根**的 POSIX 路径，如 `scripts/db-backup-core.mjs`。
 */
export function collectLauncherScriptClosure(io = {}) {
  const root = process.cwd();
  const scriptsRoot = join(root, "scripts");
  const entryArg = io.entry ?? LAUNCHER_ENTRY;
  const entryAbs = isAbsolute(entryArg) ? entryArg : join(root, entryArg);
  const readText =
    io.readText ??
    ((file) => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null;
      }
    });
  const exists = io.exists ?? existsSync;
  /** @type {Set<string>} */
  const seen = new Set();
  /**
   * @param {string} file 绝对路径
   */
  const walk = (file) => {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    const text = readText(file);
    if (text === null || text === undefined) {
      return;
    }
    const code = text
      .split("\n")
      // 只剥「整行是注释」的形态：这几份脚本的 import 都在行首，足够用且不会
      // 误伤字符串里的 `//`（例如 URL）
      .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const m of code.matchAll(
      /from\s+"(?<fromSpec>\.[^"]+)"|import\(\s*"(?<importSpec>\.[^"]+)"\s*\)/g,
    )) {
      const spec = m.groups?.fromSpec ?? m.groups?.importSpec;
      if (spec === undefined || spec === "") {
        continue;
      }
      const target = resolve(dirname(file), spec);
      // `../src/**` 由 Next 的编译产物提供（不在 scripts/ 的白名单管辖内），
      // `.d.mts` 之类的类型声明也不参与运行期加载
      if (!target.startsWith(scriptsRoot) || !target.endsWith(".mjs")) {
        continue;
      }
      if (!exists(target)) {
        continue;
      }
      walk(target);
    }
  };
  walk(entryAbs);
  return new Set([...seen].map((abs) => relative(root, abs).split("\\").join("/")));
}
