#!/usr/bin/env node
/**
 * ci-run-tool.mjs — 用**垫片名字**起一个本地 CLI，但不经任何宿主 shell（ISSUE #2572）。
 *
 * 用法：`node scripts/ci-run-tool.mjs [--root <目录>] <垫片名> [参数…]`
 *      （例：`… tsc --noEmit`）
 *
 * `--root` 指「去哪个检出找 `node_modules/.bin`」，默认当前仓库根。它是给**用例**留的
 * 位置（夹具树里造一份垫片，判「参数逐字转发 / 退出码转发」这两件而不碰真依赖）——
 * 与 `spawn-shell-scan.mjs --root` 同一个先例。
 *
 * 为什么要这一层：`.cnb.yml` 里有两格原先写的是
 * `node scripts/ci-cp936-exit.mjs -- node_modules/.bin/tsc --noEmit`。
 * `node_modules/.bin/<名字>` 是 pnpm 摆给**宿主 shell** 的垫片（盘上是三个文件：
 * 无扩展名那份给 sh、`.cmd` 只有 cmd.exe 会解释、`.ps1` 只有 PowerShell 会跑），
 * Node 一个都直接起不了 ⇒ `executable-resolve.ts` 的 `commandInvocation` 只能回退去找
 * 同目录那份 `.ps1`，再交 `powershellHost()` 起（带 `-NoProfile -ExecutionPolicy Bypass -File`）。
 * **结果是：起一个项目本地依赖的编译器，链上多了一层 PowerShell 宿主。**
 * 本脚本把那一层去掉：解析出包真身的 JS 入口，然后 `spawn(process.execPath, [入口, …])`
 * —— 与 typedoc / storybook / vitest 那几处同一形态（#2445 / #2453 走通的那条路）。
 *
 * 为什么按**垫片名字**解析而不是按依赖名（这正是 `tsc` 这一格不能照
 * `resolvePackageBinEntry("typescript")` 直接办的原因）：pnpm 摆垫片用的键是 **`bin` 的键**，
 * 本仓 `typescript` 是别名 `npm:@typescript/typescript6@^6.0.2`，它的 `bin` 键叫 `tsc6`；
 * 而 `tsc` 这个名字归另一个包（`@typescript/native`，申报名就叫 `typescript`、7.0.2）。
 * 从依赖名正推会把两份编译器混成一份。口径与实测都写在
 * `package-bin-entry.mjs` 的 `resolveBinEntryByName` 上方。
 *
 * 退码三态（与全仓口径一致）：
 *   · 子进程的退出码原样转发；子进程被信号终止 ⇒ `128 + signum`
 *     （复用 `ci-cp936-exit.mjs` 的 `exitCodeFromTermination`，不在这里再写一份）；
 *   · **解析不到入口 / 连子进程都没起来 ⇒ 退 2**：那是「这一格没跑起来」，
 *     不是「跑了且红」。两者混成一个数，下一次就会有人拿「没跑」当「判过了」。
 * 刻意**不退回 `shell: true`**：`spawn-shell-scan.mjs` 那条判据就在守这件事。
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { exitCodeFromTermination } from "./ci-cp936-exit.mjs";
import { resolveBinEntryByName } from "./package-bin-entry.mjs";

const NOT_RUN_EXIT = 2;
const USAGE =
  "用法：node scripts/ci-run-tool.mjs [--root <目录>] <垫片名> [参数…] —— 例：`node scripts/ci-run-tool.mjs tsc --noEmit`\n";

/**
 * 从解析出的入口路径反推包名与版本（读数尽力而为）。
 *
 * `resolveBinEntryByName()` 给出的入口形如 `<root>/node_modules/<pkg>/bin/<名>`
 * （scoped 包的 `<pkg>` 是 `@a/b`，目录层级同样只有一层）⇒ 包根在入口**上两级**。
 * pnpm 顶层那份是符号链接 / junction，从这里读 `package.json` 照样落在真身上；
 * 读不到（夹具树 / 非标准布局）就回 `null`，版本一格省略 —— 读数缺一格
 * 不值得为它把解析写成第二个搜索器。
 *
 * @param {string} entry `resolveBinEntryByName()` 的返回值
 * @returns {string | null} `name@version`，两样都读得到才有
 */
function packageLabelOf(entry) {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(entry, "..", "..", "package.json"), "utf8"),
    );
    const name = typeof manifest.name === "string" ? manifest.name : "";
    const version = typeof manifest.version === "string" ? manifest.version : "";
    return name !== "" && version !== "" ? `${name}@${version}` : null;
  } catch {
    return null;
  }
}

/**
 * 从 `tsc` 的参数里解析出「按哪份 tsconfig 判」（ISSUE #3041 的判决面那一问）。
 *
 * `tsc` 接受 `-p <路径>` / `--project <路径>` / `--project=<路径>`，值可以是**目录**
 * （在里面找 `tsconfig.json`）或**文件**；都不给时用的是 **cwd 的 `tsconfig.json`** ——
 * 这个默认只存在于 tsc 的行为里，日志上看不见，所以「没点名」也要单独说。
 *
 * @param {string[]} args 传给编译器的参数
 * @param {string} cwd 本次调用的工作目录（判决面的解析基准）
 * @returns {{face: string, explicit: boolean}} `face` 是 tsconfig **文件**的绝对路径
 */
function projectFaceOf(args, cwd) {
  let given = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== "string") continue;
    if (a === "-p" || a === "--project") {
      /* 索引访问每次都是独立表达式，`typeof` 判完还要存进局部量才算窄化
       * （`noUncheckedIndexedAccess` 下 `args[i + 1]` 是 `string | undefined`）。 */
      const next = args[i + 1];
      given = typeof next === "string" ? next : "";
      break;
    }
    if (a.startsWith("--project=")) {
      given = a.slice("--project=".length);
      break;
    }
    if (a.startsWith("-p=")) {
      given = a.slice("-p=".length);
      break;
    }
  }
  if (given === null || given === "") {
    return { face: path.join(cwd, "tsconfig.json"), explicit: false };
  }
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- given 由 argv 解析，字符串面兜底保留（前有 null / 空串提前返回）
  const abs = path.resolve(cwd, given ?? "");
  return path.extname(abs) === ".json"
    ? { face: abs, explicit: true }
    : { face: path.join(abs, "tsconfig.json"), explicit: true };
}

/**
 * 剥掉 JSONC 的注释（tsconfig 允许块 / 行注释，本仓主配置全用了）。
 *
 * 必须跳过**字符串字面量**再认注释：`"~/*"` 这种 glob 模式里的 `/*` 是内容不是
 * 注释开头（正则一把梭会把字符串与它的闭合引号一起吃掉，实测主配置当场碎）。
 * 小状态机三态：字符串内 / 块注释 / 行注释 —— 只服务下面的 `include` 读数，
 * 不是一份完整 JSONC 解析器。
 *
 * @param {string} raw tsconfig 文件原文
 * @returns {string} 只剩 JSON 的文本（尾逗号留给调用者处理）
 */
function stripJsoncComments(raw) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < raw.length) {
    const c = raw[i];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += raw[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && raw[i + 1] === "*") {
      const end = raw.indexOf("*/", i + 2);
      i = end === -1 ? raw.length : end + 2;
      continue;
    }
    if (c === "/" && raw[i + 1] === "/") {
      const end = raw.indexOf("\n", i + 2);
      i = end === -1 ? raw.length : end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * 读判决面文件的 `include` 摘要（读数尽力而为）。
 *
 * tsconfig 是 **JSONC** ⇒ 先剥注释再 parse（`stripJsoncComments()`）；parse 不过
 * 或读不到就回 `null`，日志上只落「内容读不到」—— 这是读数那一格，不是判据，
 * 不许为了读数把 JSONC 写成第二份完整实现。
 *
 * @param {string} faceFile `projectFaceOf()` 给出的 tsconfig 文件路径
 * @returns {string | null} `include` 数组的逗号拼接；没给 include ⇒ 空串
 *   （＝按 tsc 默认全收）；文件读不到 / parse 失败 ⇒ null
 */
function includeSummaryOf(faceFile) {
  try {
    const raw = fs.readFileSync(faceFile, "utf8");
    const noComments = stripJsoncComments(raw);
    const noTrail = noComments.replaceAll(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(noTrail);
    if (!Array.isArray(parsed.include) || parsed.include.length === 0) return "";
    return parsed.include.map((/** @type {unknown} */ item) => String(item)).join(", ");
  } catch {
    return null;
  }
}

const rest = process.argv.slice(2);
let root = path.resolve(import.meta.dirname, "..");
if (rest[0] === "--root") {
  const given = rest[1];
  if (typeof given !== "string" || given === "") {
    process.stderr.write(`${USAGE}⚠️ --root 后面要带一个目录。\n`);
    process.exit(NOT_RUN_EXIT);
  }
  root = path.resolve(given);
  rest.splice(0, 2);
}

const [name, ...args] = rest;

if (!name) {
  process.stderr.write(USAGE);
  process.exit(NOT_RUN_EXIT);
}

const entry = resolveBinEntryByName(name, { root });
if (entry === null) {
  /* 话术分两档（ISSUE #2720）：本入口的搜索面是**仓内** `node_modules/.bin`
   * （#2572 的设计面）。解析不到有两种成因，下一动作完全不同——
   *   · 名字在仓内依赖清单里 ⇒ 那才是「没装」，出口 `pnpm install`；
   *   · 名字压根不在仓内（全局 CLI，如 `cnb` 住在 pnpm 全局 bin）⇒ 说「没装」
   *     会把人引去白跑一次 install 并长出「本机跑不了平台」的误判——正确通道是
   *     `ship-exec.mjs` 的 `pnpmInvocation(args, { name })`（经 PowerShell 宿主）。
   * 用 package.json 的依赖声明区分这两档，而不是猜。 */
  let inManifest;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const deps = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };
    inManifest = Object.hasOwn(deps, name);
  } catch {
    inManifest = false;
  }
  process.stderr.write(
    inManifest
      ? `[ci-run-tool] 解析不到垫片「${name}」指向的包真身入口 —— ` +
          `仓内声明了这个依赖但 \`.bin\` 里没有垫片：要么没装（先 \`pnpm install\`，` +
          `别当成「本机跑不了」），要么 pnpm 换了垫片的写法。` +
          `自查：\`node scripts/package-bin-entry.mjs --by-name ${name}\`\n`
      : `[ci-run-tool] 「${name}」不在仓内 \`node_modules/.bin\` 的面里 —— ` +
          "本入口只管仓内垫片；全局 CLI（cnb 那一族）走 `scripts/ship-exec.mjs` 的 " +
          "`pnpmInvocation(args, { name })`（实测经 PowerShell 宿主起得来），" +
          "不要跑 `pnpm install`——那治不了面外。\n",
  );
  process.exit(NOT_RUN_EXIT);
}

const result = spawnSync(process.execPath, [entry, ...args], {
  stdio: "inherit",
  cwd: process.cwd(),
  windowsHide: true,
});

if (result.error) {
  /* `spawnSync` 的 `error` 声明上是 `Error`，真身是 `ErrnoException`（带 `code`）——
   * 这里要的正是那个 `code`（`ENOENT` / `EPERM` 说得清「起不来」是哪一种），所以注解一次。 */
  const err = /** @type {NodeJS.ErrnoException} */ (result.error);
  process.stderr.write(
    `[ci-run-tool] 起不来（${err.code ?? err.name}）：` +
      `${process.execPath} ${entry} ${args.join(" ")} —— ${err.message}\n`,
  );
  process.exit(NOT_RUN_EXIT);
}

/* 读数（读数不改判定，与 `pnpm ship` 阶段 0 那几行同口径）。这一格过去在平台日志里
 * 只留工具名，看不出解析到了哪一份 —— 而本单要防的正是「两份编译器混成一份」。
 * 放在子进程跑完之后，避免抢它前面的输出位置。 */
const pkgLabel = packageLabelOf(entry);
process.stdout.write(`[ci-run-tool] 实际执行：node ${entry}${pkgLabel ? `（${pkgLabel}）` : ""}\n`);
/* 判决面读数（ISSUE #3041）：编译器那一格过去只念得出二进制，念不出「按哪份 tsconfig
 * 判」—— 平台与本机对同一批报错给出相反读数时（#2990 的六条只在平台显形），第一问
 * 就是「两边判的是不是同一份面」。`tsc` 不带 `-p` 时用的是 **cwd 的 tsconfig.json**，
 * 这件事只存在于 tsc 的默认行为里，日志上看不见 ⇒ 念出来。 */
if (name === "tsc" || name === "tsgo") {
  const face = projectFaceOf(args, process.cwd());
  const summary = includeSummaryOf(face.face);
  const via = face.explicit ? "点名" : "tsc 默认（cwd 的 tsconfig.json）";
  const tail = summary === null ? "；内容读不到" : summary === "" ? "" : `；include: ${summary}`;
  process.stdout.write(`[ci-run-tool] 判决面：${face.face}（${via}${tail}）\n`);
}
process.exit(exitCodeFromTermination(result.status, result.signal));
