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
 *   `resolveBinEntryByName(name)`（ISSUE #2572）→ `.bin/<name>` 那份垫片**指向的**绝对路径。
 *   它答的是**另一个问题**：「这个名字归谁」。在本仓两者会分岔 —— 按依赖名正推把
 *   两份编译器混成一份，理由写在它自己的注释里。
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
 *
 *   const tsc = resolveBinEntryByName("tsc");                 // 垫片自己说归谁
 *
 * 两者都有现成的执行者，别在调用点重抄（§12.18）：按包名的那几条见 `run-affected-tests.mjs`
 * / `typedoc-run.mjs`；按垫片名字的那条是 `ci-run-tool.mjs`。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const HERE = import.meta.dirname;
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
  if (typeof bin === "string") {
    return bin;
  }
  if (bin && typeof bin === "object") {
    const v = /** @type {Record<string, unknown>} */ (bin)[binName];
    if (typeof v === "string") {
      return v;
    }
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
    if (typeof rel !== "string") {
      return null;
    }
    const entry = path.resolve(pkgDir, rel.replace(/^\.\//, ""));
    return fs.existsSync(entry) ? entry : null;
  } catch {
    // 没装（MODULE_NOT_FOUND）/ 装了但 package.json 读不了：与「入口缺席」同归 null，
    // 调用方只认「起不起来」，不区分「为什么起不来」（区分了也只是措辞不同）
    return null;
  }
}

/**
 * 「**垫片名字** → 包真身入口」（ISSUE #2572）—— 与上面那个按包名解析的是两个问题。
 *
 * 为什么必须另开一份：在本仓，「`node_modules/.bin/<名字>` 归谁」**不由 `package.json`
 * 的依赖名决定，而由 pnpm 摆垫片时用的 `bin` 键决定**。本仓的 `tsc` 就是活例子（四条
 * 都是当场跑出来的读数，不是推的）：
 *   · 依赖 `typescript` 是别名 `npm:@typescript/typescript6@6.0.2` ——
 *     `require.resolve("typescript/package.json")` 落在这**一份**上，它的 `bin` 只有一个
 *     键 `tsc6` ⇒ `resolvePackageBinEntry("typescript")` = `null`（键名与包名对不上）；
 *   · 而 **`.bin/tsc` 归另一个包**：目录 `@typescript/native`，它自己申报的 `name`
 *     正是 `typescript`、版本 7.0.2、`bin` 是 `{tsc}` ⇒
 *     `resolvePackageBinEntry("@typescript/native")` 也是 `null`（键是 `tsc`，不是包名）。
 * 两份都叫 `typescript`、各管一个名字，「按依赖名正推」这条路给的不是答案而是空。
 * **混成一份的那一格在下一步**：拿着 `null` 去「取 `bin` 的第一个键」凑一个兜底
 * （很自然的写法），`typescript` 就凑出 `tsc6` ⇒ `tsc` 安静地跑成了 6.0.2 那份。
 * 所以只能问垫片自己：它知道这个名字归谁。
 *
 * 问法按**权威度**排两层：
 *   ① pnpm 在 `.bin/<name>`（无扩展名那份 sh shim）末尾写的 `# cmd-shim-target=<绝对路径>`
 *      —— 本仓 `.bin` 里 21 份垫片**全部**带这一行（当场数过）；它由生成垫片的那一步
 *      自己写下，不需要我去解释 `$basedir` / `$basedir_win` / `%~dp0` 三种前缀；
 *   ② 退回去读 `.cmd` / sh 里那行的**目标路径**（声明缺席或那条路径不在时——
 *      比如 `node_modules` 是从别处搬来的，绝对声明会指到空气上，而垫片里那条相对路径还在）。
 * 两层都拿不到 ⇒ `null`，**不退回 `shell: true`**
 * （`spawn-shell-scan.mjs` 那条判据在场，别为绿放宽它）。
 *
 * @param {string} name 垫片名（`tsc` / `tsc6` / `vitest`，不带扩展名）
 * @param {{root?: string}} [opts] `root` 仓库根（默认本仓根）
 * @returns {string | null}
 */
export function resolveBinEntryByName(name, opts = {}) {
  const { root = ROOT } = opts;
  const binDir = path.join(root, "node_modules", ".bin");
  const declared = readDeclaredTarget(path.join(binDir, name));
  if (declared !== null) {
    return declared;
  }
  for (const shimName of [`${name}.cmd`, name]) {
    const target = readShimTarget(path.join(binDir, shimName));
    if (target !== null) {
      return target;
    }
  }
  return null;
}

/**
 * 垫片自己申报的目标（`# cmd-shim-target=<绝对路径>`）。
 *
 * 只认**行首的注释**那一种形状 —— pnpm 就是这么写的；把它当键值对去全文搜，
 * 会被正文里任何写着这句话的注释带跑（垫片里的注释是人写的）。
 * 声明是安装期烤进垫片的**绝对路径**，所以必须验存在：不验的话，一份从别的检出
 * 搬来的 `node_modules` 会让它稳定指到不存在的文件上，而那正是「静默起不来」的形状。
 *
 * @param {string} shimPath 无扩展名那份垫片的绝对路径
 * @returns {string | null}
 */
function readDeclaredTarget(shimPath) {
  if (!fs.existsSync(shimPath)) {
    return null;
  }
  let text;
  try {
    text = fs.readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }
  const m = /^# cmd-shim-target=(\S.*)$/m.exec(text);
  if (m?.[1] === undefined) {
    return null;
  }
  const target = path.resolve(m[1].trim());
  return fs.existsSync(target) ? target : null;
}

/**
 * 从一份垫片里抠出「该交给 Node 的那个文件」—— 上面那个声明拿不到时的第二层。
 *
 * 两种垫片里「可执行位 + 目标」各占一行，两种都要认：
 *   · `.cmd`：`"%~dp0\node.exe"  "%~dp0\..\@typescript\native\bin\tsc" %*`
 *   · sh：    `exec node  "$basedir/../@typescript/native/bin/tsc" "$@"`
 * 取法是**逐个看引号里的路径**：先剔掉 basename 为 `node` / `node.exe` 的（那是可执行位
 * 本身），剩下第一个带 `%~dp0` / `$basedir` 的就是目标。不写"取第二个字段"那种正则，
 * 是因为 pnpm 在不同版本里改过空格数、分支嵌套，还给 POSIX 写过
 * `$basedir` / `$basedir_win` 两套（Windows 上带 `.exe` 那份）—— 而「路径 + 剔掉 node」
 * 这件事在两种形状里都不变。
 *
 * 存在性检查顺手解决了平台差：POSIX 上 `.cmd` 里那些反斜杠路径解析不到 ⇒ 返回 `null`，
 * 调用方接着去试无扩展名那份 shim。
 *
 * @param {string} shimPath 垫片文件的绝对路径
 * @returns {string | null}
 */
function readShimTarget(shimPath) {
  if (!fs.existsSync(shimPath)) {
    return null;
  }
  let text;
  try {
    text = fs.readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }
  const here = path.dirname(shimPath);
  for (const raw of text.match(/"[^"]+"/g) ?? []) {
    const token = raw.slice(1, -1).trim();
    const isCmd = token.includes("%~dp0");
    const isSh = token.includes("$basedir");
    if (!isCmd && !isSh) {
      continue;
    }
    const rel = isCmd ? token.split("%~dp0").pop() : token.replace(/^\$basedir(_win)?/, "");
    if (rel === undefined || rel === "") {
      continue;
    }
    /* 先剥掉前导分隔符再 resolve：`.cmd` 里那串是 `%~dp0\..\…`，`split("%~dp0")` 出来
     * 带着**前导反斜杠**，而 `path.resolve` 会把以 `\` 开头的路径当**盘根相对**
     * （`G:\..\…` ⇒ 直接指到别的卷目录上去，`existsSync` 一律 false，表现就是
     * 「所有垫片都解析不到」）。sh 那份的 `$basedir/…` 同理带前导 `/`。 */
    const target = path.resolve(here, rel.replace(/^[/\\]+/, "").replaceAll("\\", path.sep));
    const base = path.basename(target).toLowerCase();
    if (base === "node" || base === "node.exe") {
      continue;
    }
    if (fs.existsSync(target)) {
      return target;
    }
  }
  return null;
}

/* 直接执行时念一句（人读的那一份；判据在用例里）：
 * `node scripts/package-bin-entry.mjs typedoc storybook vitest` */
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    process.stdout.write(
      "用法：node scripts/package-bin-entry.mjs [--by-name] <名字>…\n" +
        "  默认按**包名**解析（`resolvePackageBinEntry`）；\n" +
        "  `--by-name` 按**垫片名字**解析（`resolveBinEntryByName`，本仓 `tsc` / `tsc6` 那一族必须要它）。\n",
    );
  }
  const byName = names[0] === "--by-name";
  for (const n of byName ? names.slice(1) : names) {
    const entry = byName ? resolveBinEntryByName(n) : resolvePackageBinEntry(n);
    process.stdout.write(`${n}: ${entry ?? "(解析不到 —— 没装，或垫片不在)"}\n`);
  }
}
