#!/usr/bin/env node
/**
 * package-bin-entry.mjs — 「本地 CLI 的 **JS 入口**在哪」的**唯一实现**（ISSUE #2453）。
 *
 * ── 为什么要有这一层 ──────────────────────────────────────────────────────
 *
 * `node_modules/.bin/<工具>` 底下那三个（`.cmd` / `.ps1` / 无扩展名 shim）是 pnpm 摆给
 * **宿主 shell** 用的垫片。Node 直接 `spawn` 它 `EINVAL`，于是「起本地 CLI」这件事在本仓
 * 出现过两种写法：
 *
 *   · 开一层 shell 去起垫片 ⇒ Node 26 的 **DEP0190** 弃用形态（args 数组 + 开 shell），
 *     而且开了 shell Node 就不给参数转义，含空格的路径要自己括引号
 *     （ISSUE #2445 的现场，typedoc 那一处）；
 *   · 绕开垫片、直接 `spawn(process.execPath, [<包真身的 bin 文件>, …])`
 *     ⇒ 弃用与引号两件事一起消失（#2445 修 typedoc 时验过：本地与平台两处日志都干净了）。
 *
 * 第二种写法需要「**包真身的 bin 文件在哪**」这一个事实。它此前被写了**两份**
 * （`run-affected-tests.mjs` 的 `resolveVitestEntry`、#2445 新写的 `resolveTypedocEntry`），
 * 而 storybook 那一处还在开 shell（ISSUE #2453）⇒ 再写就是第三份。抄一份的漂移形态是
 * 「换安装方式之后其中一份指到空气上，另外两份还绿」—— 静默的那一种。
 *
 * ── 它回答什么 ────────────────────────────────────────────────────────────
 *
 *   `resolvePackageBinEntry(pkgName)` → 该包 `bin` 指向的**绝对路径**；解析不到给 `null`
 *   （不抛 —— 「没装」与「装了但入口缺席」对调用方是同一件事：起不起来）。
 *
 * 刻意**不做**的事：
 *   · 不解析 PATH 上的全局命令（本仓只用本地装的那一份，规范 §2.1）；
 *   · 不判「这个包能不能跑」—— 那是 `spawn` 之后的事，本模块只给路径；
 *   · 不接管「起不起得来 / 要不要重试」（各调用方自己的判据）。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *
 *   const entry = resolvePackageBinEntry("typedoc");          // …/typedoc/bin/typedoc
 *   spawn(process.execPath, [entry, ...args], { cwd: root }); // 不经 shell、不括引号
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 一个包 `bin` 字段里那条**相对路径**。
 *
 * `bin` 有两种合法形状，都要接得住：
 *   · 字符串 —— `"bin": "./dist/bin/dispatcher.js"`（storybook 10.x）；
 *   · 对象   —— `"bin": { "typedoc": "bin/typedoc" }`（typedoc 0.28）。
 * 对象形态下取**哪个键**由 `binName` 决定（默认是包名本身 —— 绝大多数包 `bin` 的键与包名同形）。
 *
 * @param {unknown} bin `package.json` 的 `bin` 字段原值
 * @param {string} binName 要的那一条
 * @returns {string | null}
 */
export function binRelativePath(bin, binName) {
  if (typeof bin === "string") return bin;
  if (bin && typeof bin === "object") {
    const v = /** @type {Record<string, unknown>} */ (bin)[binName];
    if (typeof v === "string") return v;
  }
  return null;
}

/**
 * 本地某个包的 **CLI 入口**（绝对路径）；解析不到给 `null`。
 *
 * 为什么走 `require.resolve("<pkg>/package.json")` 而不是拼 `node_modules/<pkg>/…`
 * （这三条理由原本写在 `run-affected-tests.mjs` 的 `resolveVitestEntry` 里，此处是它的
 * 唯一出处，别在各调用方再抄一遍）：
 *   ① pnpm 的布局里真身在 `node_modules/.pnpm/<pkg>@<ver>_…/node_modules/<pkg>/`，
 *      顶层那个是**链接** —— 写死路径在换版本或换安装方式时指到空气上；
 *   ② 入口**文件名由包自己定义**（`bin` 字段），猜文件名等于替包做决定；
 *   ③ `require.resolve` 顺带把「装没装」这件事问出来了 —— 没装会抛，归 `null`。
 *
 * @param {string} pkgName 包名
 * @param {{root?: string, binName?: string}} [opts] `root` 仓库根（默认本仓根）；
 *        `binName` 当 `bin` 是对象形态时要取的那个键（默认等于包名）
 * @returns {string | null}
 */
export function resolvePackageBinEntry(pkgName, opts = {}) {
  const { root = ROOT, binName = pkgName } = opts;
  try {
    const require = createRequire(path.join(root, "noop.js"));
    const pkgPath = require.resolve(`${pkgName}/package.json`);
    const pkgDir = path.dirname(pkgPath);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const rel = binRelativePath(pkg?.bin, binName);
    if (typeof rel !== "string") return null;
    const entry = path.resolve(pkgDir, rel.replace(/^\.\//, ""));
    return fs.existsSync(entry) ? entry : null;
  } catch {
    // 没装（MODULE_NOT_FOUND）/ 装了但 package.json 读不了：与「入口缺席」同归 null，
    // 调用方只认「起不起来」，不区分「为什么起不来」（区分了也只是措辞不同）
    return null;
  }
}

/* 直接执行时念一句（人读的那一份；判据在用例里）：
 * `node scripts/package-bin-entry.mjs typedoc storybook vitest` */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    process.stdout.write("用法：node scripts/package-bin-entry.mjs <包名>…\n");
  }
  for (const n of names) {
    const entry = resolvePackageBinEntry(n);
    process.stdout.write(`${n}: ${entry ?? "(解析不到 —— 没装)"}\n`);
  }
}
