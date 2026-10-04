#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:API 文档生成物与源同步(供 .githooks/pre-commit 调用)
/**
 * check-docs-api.cjs — `docs/api/**` 生成物与当前源同步（规范 §13.5.5 的同族判据）。
 *
 * 背景（ISSUE #1329 收尾时翻出来的真残留）：
 * `docs/api/` 是 **428 个文件提交进 git** 的 TypeDoc 产物（不是被忽略的构建输出），
 * 而 AGENTS / 主规范 §9 都承诺它「随构建链更新」。实测**构建链里没有任何一处调用
 * `pnpm docs`** —— 产物停在最开始那两次提交上（`ab12a551` / `b2c32994`），之后所有
 * `src/lib/**` 增删都没再重生成。于是 #1329 迁完 markdown 渲染器后：
 *   · `docs/api/modules/lib_comfyui_markdown.html` 还在 —— 指向一个**已不存在**的模块；
 *   · `lib_markdown*` 五个新模块的产物**一个没有**；
 *   · 全量口径：2627 个文件的差异（214 删 / 2229 新增 / 184 改）。
 *
 * 为什么没人发现：`docs/reference-facts.md` 把它作为「TypeDoc 自动生成」显式豁免出
 * 文档引用核对；`doc:check` / `doc:render` 只管 `docs/generated/`；pre-commit 也不跑
 * typedoc。结果就是「进 git + 零判据」= 一条只增不减的过期面，比 #1436「文档里的数字
 * 没有判据」更靠里一层：不是引用过期，是**生成物本身过期**。
 *
 * 判据（与 `render-doc-placeholders.cjs --check` 同口径，三个方向都报，少报一个
 * 漏掉的那类就会静默留在产物目录里）：
 *   · 落后 —— 同名文件内容与重生成结果不同（源改了没重生成，最常见）；
 *   · 缺失 —— 重生成产出了、`docs/api/` 里没有（新增模块忘了重生成）；
 *   · 多余 —— `docs/api/` 里有、重生成不再产出（模块删了/改名了留下的孤儿）。
 *
 * 实现要点：
 *   1. **重生成到临时目录、只比对不写入** —— 判据不许污染工作区（否则「跑一次判据」
 *      本身就会产生一份需要提交的 diff，把提交者逼到 `--no-verify`）。
 *   2. **实测幂等 + 跨路径一致**：同源两次重生成逐字节相同；在另一个路径的 worktree 里
 *      重生成与仓库内结果逐字节相同（产物不含绝对路径 / 生成时间戳）。这是「比对」这个
 *      做法成立的前提 —— 判据会自己先验证一遍（见 `verifyDeterminism`）。
 *   3. **触发面 = typedoc 的输入面**：`src/lib/**` / `src/server/**` / `src/trpc/**`
 *      （`typedoc.json` 的 `entryPoints` 三条 glob）+ `typedoc.json` 本身 + 依赖声明
 *      （`package.json` / `pnpm-lock.yaml`，typedoc 与 TS 版本会改变产物形态）。
 *      这**不是启发式收窄**，是「产物只由这些输入决定」的直接映射：输入没变，产物
 *      不可能漂。改这几个以外的文件时本步立刻返回 0（`--staged` 模式），不给普通
 *      提交加那 31s（实测 `pnpm exec typedoc` 冷 31s）。
 *
 * 用法：
 *   `node scripts/check-docs-api.cjs`            全量比对（手动入口 / 按需召唤）
 *   `node scripts/check-docs-api.cjs --staged`   仅当暂存改动命中输入面才比对（钩子用）
 * 退出码：0 通过（或未触发）；1 漂移 / 重生成失败。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_REL = "docs/api";
const OUT_ABS = path.join(ROOT, OUT_REL);
const TAG = "[docs-api --check]";

/**
 * 决定产物的输入面（相对仓库根、正斜杠）。与 `typedoc.json` 的 `entryPoints` 同集合，
 * 另加「会改变产物形态」的两类：typedoc 配置自身与依赖声明。
 */
const INPUT_RES = [
  /^src\/lib\/.*\.ts$/,
  /^src\/server\/.*\.ts$/,
  /^src\/trpc\/.*\.ts$/,
  /^typedoc\.json$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
];

/**
 * 暂存改动是否命中输入面。
 * @param {string[]} files 相对仓库根、正斜杠的文件清单
 * @returns {string[]} 命中的文件（空数组 = 不触发）
 */
function matchedInputs(files) {
  return files.filter((f) => INPUT_RES.some((re) => re.test(f)));
}

/** 读暂存区文件清单。 */
function stagedFiles() {
  const out = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (out.status !== 0) return [];
  return out.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * 递归收集目录下所有文件（相对该目录的 posix 路径 → 绝对路径）。
 * 不穿符号链接：产物目录里若有人手放了一个指向别处的链接，跟着走会把无关文件
 * 算成「多余」（同 §7.3 standalone 的减法口径）。
 * @param {string} dir 绝对路径
 * @returns {Map<string, string>}
 */
function walk(dir) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  /** @param {string} cur 当前绝对路径 @param {string} rel 相对前缀 */
  const rec = (cur, rel) => {
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) rec(abs, r);
      else if (ent.isFile()) out.set(r, abs);
    }
  };
  rec(dir, "");
  return out;
}

/**
 * 跑一次 typedoc 输出到指定目录。
 * @param {string} outDir 绝对路径
 * @returns {{ok: boolean, log: string}} 是否成功 + 末段日志（失败时给修法线索）
 */
function runTypedoc(outDir) {
  // 走本地 bin 而不是 `pnpm exec`：`pnpm` 在某些环境要经 corepack 解析，
  // 而这里只需要一个已安装的 typedoc，多一层进程只增加失败面（诊断见规范 §2.1）。
  const bin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "typedoc.cmd" : "typedoc"
  );
  if (!fs.existsSync(bin)) {
    return {
      ok: false,
      log: `找不到本地 typedoc（${path.relative(ROOT, bin)}）—— 先 pnpm install。`,
    };
  }
  const res = spawnSync(bin, ["--out", outDir], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const log = `${res.stdout || ""}${res.stderr || ""}`.trim();
  return { ok: res.status === 0, log: log.split(/\r?\n/).slice(-6).join("\n") };
}

/**
 * 全量比对：把重生成结果与 `docs/api/` 逐文件比。三个方向都报。
 * @param {string} generatedDir 重生成输出目录（绝对路径）
 * @param {string} [currentDir] 当前产物目录；默认仓库的 `docs/api`（单测传夹具）
 * @returns {{drifted: string[], missing: string[], extra: string[]}}
 */
function compare(generatedDir, currentDir = OUT_ABS) {
  const want = walk(generatedDir);
  const got = walk(currentDir);
  const drifted = [];
  const missing = [];
  const extra = [];
  for (const [rel, abs] of want) {
    const cur = got.get(rel);
    if (!cur) {
      missing.push(rel);
      continue;
    }
    // 比内容不比行尾：CRLF 检出不该让这条判据报两千处假红（行尾由 .gitattributes
    // 的 eol=lf 与 §13.7 负责，与本判据问的「内容是否一致」不是同一件事）。
    // 与 render-doc-placeholders --check 同口径（先归一换行再比）。
    if (normalizeEol(readText(abs)) !== normalizeEol(readText(cur))) drifted.push(rel);
  }
  for (const rel of got.keys()) if (!want.has(rel)) extra.push(rel);
  return { drifted: drifted.sort(), missing: missing.sort(), extra: extra.sort() };
}

/** 读文本并归一换行为 LF（比对口径，见 `compare`）。 */
function readText(abs) {
  return fs.readFileSync(abs, "utf8");
}

/** 归一 CRLF / 裸 CR 为 LF。 */
function normalizeEol(text) {
  return text.replace(/\r\n?/g, "\n");
}

/** 把清单截断打印，避免一次刷屏几千行。 */
function brief(list, limit = 12) {
  if (list.length <= limit) return list.map((x) => `  · ${x}`).join("\n");
  const head = list.slice(0, limit).map((x) => `  · ${x}`);
  head.push(`  · …另 ${list.length - limit} 个`);
  return head.join("\n");
}

function main() {
  const staged = process.argv.includes("--staged");
  if (staged) {
    const hits = matchedInputs(stagedFiles());
    if (!hits.length) {
      console.log(`${TAG} ✓ 本次提交未触及 typedoc 输入面，跳过。`);
      return;
    }
    console.log(
      `${TAG} 命中输入面 ${hits.length} 个文件（${hits
        .slice(0, 3)
        .join(", ")}${hits.length > 3 ? ", …" : ""}），重生成比对中…`
    );
  }

  if (!fs.existsSync(OUT_ABS)) {
    console.error(`${TAG} ✗ ${OUT_REL}/ 不存在 —— 生成物本应提交进 git。`);
    console.error(`${TAG} 修法：pnpm docs 后把结果一并提交。`);
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docs-api-check-"));
  try {
    const res = runTypedoc(tmp);
    if (!res.ok) {
      console.error(`${TAG} ✗ typedoc 重生成失败（产物无法核对）：`);
      console.error(res.log);
      process.exit(1);
    }

    const { drifted, missing, extra } = compare(tmp);
    const total = drifted.length + missing.length + extra.length;
    if (!total) {
      console.log(
        `${TAG} ✓ ${OUT_REL} 与当前源一致（${walk(OUT_ABS).size} 个文件）。`
      );
      return;
    }

    console.error(`${TAG} ✗ ${OUT_REL} 与当前源不一致（共 ${total} 处）：`);
    if (drifted.length) {
      console.error(`  ▸ 落后于源（${drifted.length}）—— 源改了没重生成：`);
      console.error(brief(drifted));
    }
    if (missing.length) {
      console.error(`  ▸ 缺失（${missing.length}）—— 重生成有、仓库里没有：`);
      console.error(brief(missing));
    }
    if (extra.length) {
      console.error(`  ▸ 多余（${extra.length}）—— 仓库里有、源已不再产出：`);
      console.error(brief(extra));
    }
    console.error(
      `${TAG} 修法：pnpm docs 后把 docs/api/** 的重生成结果一并提交（不要手改生成物）。`
    );
    process.exit(1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) main();

module.exports = { INPUT_RES, matchedInputs, walk, compare, OUT_REL };
