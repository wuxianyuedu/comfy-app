#!/usr/bin/env node
/**
 * prune-virtual-store.mjs — 清掉 `node_modules/.pnpm` 里已不在当前依赖图的条目目录。
 *
 * ## 为什么需要它
 *
 * pnpm 移掉一个依赖时**不回收**虚拟 store 里那个条目的目录：磁盘上留着上一份
 * 依赖图的 `<name>@<version>` 目录，`pnpm install` 只按锁文件补齐、不减。
 * `pnpm store prune` 动的是**全局内容寻址 store**（`~/.local/share/pnpm/store`），
 * `pnpm prune` 动的是 `package.json` 里没声明的依赖 —— 两者都不管项目里的虚拟 store。
 * 于是唯一的清法曾是手工删目录或整棵删掉 `node_modules` 重装（后者要重链全部依赖，
 * 还会把常驻的 dev server 一起带走）。本入口把这件事收成一条有名字的命令（规范 §12.20）。
 *
 * ## 安全栏（「绝不碰图内条目」是硬约束）
 *
 * · **权威源是锁文件的 `packages` 段**，解析复用 `scripts/lockfile/lock-diff.mjs`
 *   的 `parseLockfile()` —— 与依赖构建脚本对账用的是同一份，不另抄一个 YAML 解析器。
 * · **主身份源是条目自己的 `package.json`**：pnpm 12 会把带一长串 peer 依赖的
 *   目录名截断成 `…_<hash>`（本仓实测 209 个），有的连 `@<version>` 都被切掉 ——
 *   靠目录名猜身份会把它们全判成「判不准」，工具等于没用。所以读
 *   `<条目>/node_modules/<包名>/package.json` 里的 `name@version`，一个条目只认
 *   一个身份；读不到 / 不合法 / 有多个身份 ⇒ 判不准，不删（「没量到」不是「可以删」）。
 * · **目录名只做二次校验**：能归一出 `name@version` 时，必须与 `package.json`
 *   逐字相同（别名包 / 半截安装 / 内容损坏都在这里落到「判不准」）；是 pnpm 截断
 *   形态（`_<hash>` 结尾）就跳过这一道，绝不靠猜目录名补身份。
 * · 图内条目一律跳过；`.pnpm/node_modules`（pnpm 的 hoisted 虚拟目录）一律不碰；
 *   只删目录，符号链接与文件不碰；删除目标必须仍在 `.pnpm` 之下。
 * · 带 peer 后缀的形态两边不同形：目录名用 `_<包>@<版本>`，锁文件键可能带
 *   `(<包>@<版本>)`，两侧都按不带后缀的 `name@version` 归一；`inGraph()` 的
 *   前缀匹配宁可多留一个，也绝不把图内条目误判成残留。
 *
 * 用法：`pnpm deps:prune [--dry-run]`
 * 退出码：0 收干净 / 1 有事实是红的（删不掉、图读不到、判不准）/ 2 用法错或前置不成立。
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { parseLockfile } from "./lockfile/lock-diff.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const LOCKFILE = path.join(ROOT, "pnpm-lock.yaml");
const PNPM_DIR = path.join(ROOT, "node_modules", ".pnpm");
/** pnpm 的 hoisted 虚拟目录名：它不是 `<name>@<version>` 条目，绝不碰。 */
const HOISTED_DIR = "node_modules";

const EXIT = { OK: 0, RED: 1, NOT_RUN: 2 };
const TAG = "[prune-virtual-store]";
/** 清单最多逐条念多少行；其余只给总数，几百条残留时不把屏幕刷满。 */
const LIST_LIMIT = 20;

/**
 * unknown 抛值的可读详情（脚本层不引 `src/lib/error-message`，它是 TS 模块）。
 * @param {unknown} error
 */
function detail(error) {
  if (error !== null && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

/** pnpm 12 把超长目录名截成 `…_<hash>`；这一类目录名本身不带可信身份。 */
const HASHED_DIR_RE = /_[0-9a-f]{20,}$/;

/**
 * `.pnpm/<条目>` 目录名 → 包身份 `name@version`（**只在能归一时给结论**）。
 *
 * 作用域分隔符在目录名里是 `+`、在锁文件里是 `/`；peer 依赖后缀在目录名里是
 * `_<包>@<版本>`，要切掉。`_` 也可能长在**包名**里（`@types+babel__core@7.20.5`），
 * 所以只在分隔版本的 `@` 之后切，不动名字那一半。
 *
 * · `id`        —— 能归一，拿它做二次校验；
 * · `truncated` —— pnpm 截断形态，跳过校验，只信条目自己的 `package.json`；
 * · `unknown`   —— 既不是截断形态也归一不出 ⇒ 判不准。
 *
 * @param {string} dirName
 */
function dirNameIdentity(dirName) {
  if (HASHED_DIR_RE.test(dirName)) {
    return { kind: "truncated", id: "" };
  }
  const start = dirName.startsWith("@") ? 1 : 0;
  const at = dirName.indexOf("@", start);
  if (at <= start || at === dirName.length - 1) {
    return { kind: "unknown", id: "" };
  }
  const name = dirName.slice(0, at).replaceAll("+", "/");
  const version = dirName.slice(at + 1).split("_")[0];
  if (!name || !version) {
    return { kind: "unknown", id: "" };
  }
  return { kind: "id", id: `${name}@${version}` };
}

/**
 * 读条目自己的 `package.json` → `name@version`（**主身份源**）。
 *
 * 一个虚拟 store 条目的真实内容只落在 `<条目>/node_modules/<包名>/` 这一层；
 * 同目录下其它名字都是指向别的条目的符号链接（依赖），`.bin` 是 shim 目录 ——
 * 都得跳过，否则会把别人的身份算到自己头上。作用域包还多一层 `@scope/`。
 *
 * 判不准一律给 `id: null` 加一句为什么，调用方收进「不删」那一堆。
 *
 * @param {string} entryPath
 */
function readEntryIdentity(entryPath) {
  const innerPath = path.join(entryPath, "node_modules");
  let inner;
  try {
    inner = readdirSync(innerPath, { withFileTypes: true });
  } catch (error) {
    return { id: null, why: `读不到条目内的 node_modules：${detail(error)}` };
  }
  const ids = new Set();
  for (const item of inner) {
    /* 依赖链接 / shim 目录 / 非目录都不是这个条目自己的包内容。 */
    if (item.isSymbolicLink() || !item.isDirectory() || item.name.startsWith(".")) {
      continue;
    }
    const pkgFiles = [];
    if (item.name.startsWith("@")) {
      const scopePath = path.join(innerPath, item.name);
      let scoped;
      try {
        scoped = readdirSync(scopePath, { withFileTypes: true });
      } catch (error) {
        return { id: null, why: `读不到作用域目录 ${item.name}：${detail(error)}` };
      }
      for (const child of scoped) {
        if (!child.isSymbolicLink() && child.isDirectory() && !child.name.startsWith(".")) {
          pkgFiles.push(path.join(scopePath, child.name, "package.json"));
        }
      }
    } else {
      pkgFiles.push(path.join(innerPath, item.name, "package.json"));
    }
    for (const pkgFile of pkgFiles) {
      let raw;
      try {
        raw = readFileSync(pkgFile, "utf8");
      } catch (error) {
        return { id: null, why: `读不到 package.json：${detail(error)}` };
      }
      let pkg;
      try {
        pkg = JSON.parse(raw);
      } catch (error) {
        return { id: null, why: `package.json 不是合法 JSON：${detail(error)}` };
      }
      if (
        !pkg ||
        typeof pkg !== "object" ||
        Array.isArray(pkg) ||
        typeof pkg.name !== "string" ||
        pkg.name.trim() === "" ||
        typeof pkg.version !== "string" ||
        pkg.version.trim() === ""
      ) {
        return { id: null, why: "package.json 里没有可用的 name / version" };
      }
      ids.add(`${pkg.name.trim()}@${pkg.version.trim()}`);
    }
  }
  if (ids.size === 0) {
    return { id: null, why: "条目里没有可识别的 package.json" };
  }
  if (ids.size > 1) {
    return { id: null, why: `条目里有 ${String(ids.size)} 个不同包身份` };
  }
  return { id: [...ids][0], why: "" };
}

/**
 * 这个身份还在不在当前依赖图里。
 *
 * 锁文件 `packages` 段的一级键通常是裸 `name@version`；带 peer 依赖时也见过
 * `name@ver(peer@ver)` / `name@ver_peer@ver` 的形态，前缀匹配补这一格。
 * 宁可多留一个条目（少删），绝不把图内条目误判成残留。
 *
 * @param {string} id
 * @param {Set<string>} graphIds
 */
function inGraph(id, graphIds) {
  if (graphIds.has(id)) {
    return true;
  }
  for (const key of graphIds) {
    if (key.startsWith(`${id}(`) || key.startsWith(`${id}_`)) {
      return true;
    }
  }
  return false;
}

/** 当前依赖图：`pnpm-lock.yaml` 的 `packages` 段一级键（保留 peer 后缀原样）。 */
function readGraphIds() {
  let raw;
  try {
    raw = readFileSync(LOCKFILE, "utf8");
  } catch (error) {
    return { ids: null, reason: `读不到 ${path.relative(ROOT, LOCKFILE)}：${detail(error)}` };
  }
  let parsed;
  try {
    parsed = parseLockfile(raw);
  } catch (error) {
    return { ids: null, reason: `解析 pnpm-lock.yaml 失败：${detail(error)}` };
  }
  const section = parsed.sections.get("packages");
  if (!section || section.keys.size === 0) {
    return { ids: null, reason: "pnpm-lock.yaml 里没有非空的 packages 段" };
  }
  return { ids: new Set(section.keys.keys()), reason: "" };
}

/**
 * 把虚拟 store 的条目分成「图内 / 残留 / 判不准」三堆。
 * @param {Set<string>} graphIds
 */
function scan(graphIds) {
  const stale = [];
  const unsure = [];
  let kept = 0;
  let total = 0;
  for (const entry of readdirSync(PNPM_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === HOISTED_DIR) {
      continue;
    }
    total += 1;
    const abs = path.join(PNPM_DIR, entry.name);
    const identity = readEntryIdentity(abs);
    if (identity.id === null) {
      unsure.push({ name: entry.name, why: identity.why });
      continue;
    }
    const named = dirNameIdentity(entry.name);
    if (named.kind === "unknown") {
      unsure.push({ name: entry.name, why: "目录名归一不出 name@version，也不是 pnpm 截断形态" });
      continue;
    }
    if (named.kind === "id" && named.id !== identity.id) {
      unsure.push({
        name: entry.name,
        why: `目录名是 ${named.id}，条目自己的 package.json 是 ${identity.id}，两者对不上`,
      });
      continue;
    }
    if (inGraph(identity.id, graphIds)) {
      kept += 1;
      continue;
    }
    stale.push({ name: entry.name, abs, id: identity.id });
  }
  return { stale, unsure, kept, total };
}

/**
 * 目录占盘字节数：只数普通文件，不穿符号链接（链接指向别处的内容不该算进来）。
 * @param {string} absDir
 */
function dirSize(absDir) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(absDir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      total += dirSize(full);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    try {
      total += statSync(full).size;
    } catch {
      /* 扫描期间被并发移走：那一块量不到就少量一块，不影响判决 */
    }
  }
  return total;
}

/**
 * 只给整数读数，不用精度 API（它与 `~/lib/number-format` 是同一条口径）。
 * @param {number} bytes
 */
function humanSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
  }
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}

function printUsage() {
  console.log(
    [
      "用法：pnpm deps:prune [--dry-run]",
      "",
      "  清掉 node_modules/.pnpm 里已不在 pnpm-lock.yaml 的 packages 段的条目目录。",
      "  动的是项目里的虚拟 store，不是 pnpm 的全局内容寻址 store（pnpm store prune 管不到）。",
      "",
      "  --dry-run   只列出会删什么，一个都不删",
      "  --help      打印这份说明",
      "",
      "  退出码：0 收干净 / 1 有事实是红的（删不掉、图读不到、判不准）/ 2 用法错或前置不成立",
    ].join("\n"),
  );
}

/**
 * 命令行入口：解析旗标 → 读图 → 扫描 → 删除 / 只念清单 → 三态退出码。
 * @param {string[]} argv
 */
function main(argv) {
  const dryRun = argv.includes("--dry-run");
  if (argv.includes("--help")) {
    printUsage();
    return EXIT.OK;
  }
  const unknown = argv.filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) {
    console.error(`${TAG} 未知参数：${unknown.join(" ")}`);
    printUsage();
    return EXIT.NOT_RUN;
  }
  if (!existsSync(PNPM_DIR)) {
    console.error(`${TAG} 前置不成立：读不到 ${path.relative(ROOT, PNPM_DIR)}（依赖还没装）。`);
    console.error(`${TAG} 出口：pnpm install --frozen-lockfile。`);
    return EXIT.NOT_RUN;
  }

  const graph = readGraphIds();
  if (graph.ids === null) {
    console.error(`${TAG} 当前依赖图读不出来：${graph.reason}`);
    console.error(`${TAG} 出口：确认 pnpm-lock.yaml 完好后重跑；图没读到，一个条目都不删。`);
    return EXIT.RED;
  }

  let result;
  try {
    result = scan(graph.ids);
  } catch (error) {
    console.error(`${TAG} 枚举虚拟 store 失败：${detail(error)}`);
    return EXIT.NOT_RUN;
  }
  const { stale, unsure, kept, total } = result;
  console.log(`${TAG} 权威源：pnpm-lock.yaml 的 packages 段（${String(graph.ids.size)} 个包身份）`);
  console.log(
    `${TAG} 虚拟 store 条目 ${String(total)} 个 · 图内 ${String(kept)} · ` +
      `残留 ${String(stale.length)} · 判不准 ${String(unsure.length)}`,
  );

  if (stale.length > 0) {
    const bytes = stale.reduce((sum, item) => sum + dirSize(item.abs), 0);
    console.log(`${TAG} 残留占盘约 ${humanSize(bytes)}${dryRun ? "（--dry-run：不删）" : ""}`);
    for (const item of stale.slice(0, LIST_LIMIT)) {
      console.log(`  · ${item.name}`);
    }
    if (stale.length > LIST_LIMIT) {
      console.log(`  ……另有 ${String(stale.length - LIST_LIMIT)} 个`);
    }
  }

  const failures = [];
  if (!dryRun) {
    const storeRoot = `${path.resolve(PNPM_DIR)}${path.sep}`;
    for (const item of stale) {
      /* 删除目标必须仍在这棵虚拟 store 之下：目录名来自 readdir，本不该含 `..`，
       * 但递归删除之前值得再挡一次，避免任何拼路径的形态把范围放大。 */
      if (!`${path.resolve(item.abs)}${path.sep}`.startsWith(storeRoot)) {
        failures.push({ name: item.name, why: "目标不在 node_modules/.pnpm 之下，已跳过" });
        continue;
      }
      try {
        rmSync(item.abs, { recursive: true, force: true });
      } catch (error) {
        failures.push({ name: item.name, why: detail(error) });
      }
    }
  }

  if (unsure.length > 0) {
    console.log(
      `${TAG} 以下 ${String(unsure.length)} 个条目判不准身份 ⇒ 不删（没量到不等于可以删）：`,
    );
    for (const item of unsure.slice(0, LIST_LIMIT)) {
      console.log(`  · ${item.name} — ${item.why}`);
    }
    if (unsure.length > LIST_LIMIT) {
      console.log(`  ……另有 ${String(unsure.length - LIST_LIMIT)} 个`);
    }
    console.log(`${TAG} 出口：确认这些目录确属残留后手工处理；本入口不替你猜，也不整棵重装。`);
  }
  if (failures.length > 0) {
    console.error(
      `${TAG} 以下 ${String(failures.length)} 个条目删不掉（Windows 上常见：文件被 dev server / 编辑器占用）：`,
    );
    for (const item of failures) {
      console.error(`  · ${item.name} — ${item.why}`);
    }
    console.error(
      `${TAG} 出口：关掉占用它的进程后重跑 \`pnpm deps:prune\`；` +
        "不要整棵删 node_modules 重装（会带走常驻的 dev server）。",
    );
  }

  if (failures.length > 0 || unsure.length > 0) {
    return EXIT.RED;
  }
  if (dryRun) {
    console.log(`${TAG} --dry-run 结束：会删 ${String(stale.length)} 个条目（实际一个都没删）。`);
    return EXIT.OK;
  }
  console.log(
    `${TAG} 已收干净：删掉 ${String(stale.length)} 个残留条目，图内 ${String(kept)} 个条目一个没动。`,
  );
  return EXIT.OK;
}

const invoked = process.argv[1];
if (invoked && path.resolve(invoked) === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2));
}
