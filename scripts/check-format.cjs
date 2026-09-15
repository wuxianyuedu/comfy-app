#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:prettier 格式棘轮(供 .githooks/pre-commit 与 CI 调用)
/**
 * prettier 格式棘轮 —— 规范见 docs/standards/13-提交与-code-review.md §13.5。
 *
 * 背景(ISSUE #575 第 9 项):
 * `format:check` 长期是**唯一没有纳入门禁**的既有质量命令。原因很实在 ——
 * 全库 576 个文件未过 prettier,一次性 `--write` 会产生与本次改动无关的全文件
 * diff,直接违反 §13.7「禁止无关全文件变更」(评审无法从 diff 里看出改了什么)。
 * 但它长期不进门的代价是:每个新文件都可以带着任意格式进来,存量只会更多,
 * 「等基线整改完再接入」因此**永远不会发生**。
 *
 * 判据:**基线 + 只许下降**,与其它棘轮(重复块/函数长度/文件行数/环依赖)同口径 ——
 * 不是「全库必须过」(那在今天不成立),而是:
 *   ① 新增未过格式的文件 → 阻断;
 *   ② 存量文件从干净变脏 → 阻断(它在基线外,即 ①);
 *   ③ 治理有进展(未过文件减少)→ 提示 `--update` 收紧;`--strict` 下未收紧即失败。
 * 于是基线上只减不增,新增代码默认是格式干净的。
 *
 * 为什么按**文件**记账而不是记全局「未过文件数」:计数只约束总量 —— 修好 3 个、
 * 弄坏 4 个,总数变大才失败,弄坏的那 3 个无人知晓。文件级记账下,「把干净的
 * 文件弄脏」当场失败,而「这个文件此前是干净的」本身就是一个可断言的事实。
 *
 * 为什么白名单是**形态**(glob)而不是文件列表:`scripts/` `tests/` `e2e/` 与根级
 * 配置是**高频 churn 路径**(每次踩坑都要改一遍),把它们纳入棘轮会让每一次排障
 * 提交都顺带产生格式 diff。用 glob 表达「这类文件暂不纳入」不会漂移,且新增这类
 * 文件时自动落在白名单里(不误报)。豁免不进棘轮计数。
 *
 * 为什么逐个 glob 调 prettier 而不是一次性:需要把 glob 交给 shell 展开或引号
 * 透传,而 Windows 上 cmd/pwsh 的展开语义与 POSIX 不同;逐个 glob 调用对平台
 * 无感,且 prettier 的 `--cache` 让重复调用几乎零成本。
 *
 * 用法:
 *   node scripts/check-format.cjs             # 检查(棘轮)
 *   node scripts/check-format.cjs --strict    # 基线未收紧也失败(CI 用)
 *   node scripts/check-format.cjs --update    # 重写基线(须伴随下降)
 *   node scripts/check-format.cjs --report    # 只出清单不判失败(盘点用)
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/* 扫描根取 cwd:门禁在仓库根被调用,而 prettier / git 都按 cwd 解析仓库
 * (与 check-circular-deps.cjs 同口径)。基线取 __dirname 旁,与脚本同目录。 */
const ROOT = process.cwd();
const BASELINE = path.join(__dirname, ".format-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const REPORT_ONLY = ARGS.has("--report");

/** 扫描范围与 package.json 的 format:check 逐字一致。 */
const GLOBS = ["**/*.{ts,tsx,js,jsx,mdx}"];

/** 白名单(glob,相对仓库根):高频 churn 路径,见文件头注释。 */
const IGNORE_GLOBS = [
  "scripts/**",
  "tests/**",
  "tools/**",
  "e2e/**",
  "public/**",
  "docs/api/**",
  "docs/generated/**",
  "*.config.{js,ts,mjs,cjs}",
  "*.js",
];

/** prettier 缓存放临时目录:缓存不进仓库,也就不进基线。 */
const CACHE_DIR = path.join(os.tmpdir(), "comfyapp-prettier-cache");

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 把 glob 转成正则(支持 `**` / `*` / `?` / `{a,b}`):不引依赖,口径可控。 */
function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob.slice(i, i + 3) === "**/") {
        out += "(?:.*/)?";
        i += 2;
      } else if (glob.slice(i, i + 2) === "**") {
        out += ".*";
        i += 1;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "{") {
      const close = glob.indexOf("}", i);
      if (close < 0) {
        out += "\\{";
        continue;
      }
      out +=
        "(?:" +
        glob
          .slice(i + 1, close)
          .split(",")
          .map(escapeRe)
          .join("|") +
        ")";
      i = close;
    } else if (c === "/") {
      out += "/";
    } else {
      out += escapeRe(c);
    }
  }
  return new RegExp(out + "$");
}

const IGNORE_RES = IGNORE_GLOBS.map(globToRegExp);

function isIgnored(rel) {
  return IGNORE_RES.some((re) => re.test(rel));
}

/** 找出未过 prettier 的文件(仓库根相对 POSIX 路径,已排序、已剔除白名单)。 */
function collectUnformatted() {
  const found = new Set();
  for (const glob of GLOBS) {
    const res = spawnSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["exec", "prettier", "--list-different", "--cache", "--cache-location", CACHE_DIR, glob],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (res.error) {
      console.error(`[format] 无法执行 prettier:${res.error.message}`);
      process.exit(2);
    }
    // `--list-different` 在「存在差异」时返回 1、无差异返回 0;其余非零码才是
    // 真失败(配置写错 / 解析失败),必须区分 —— 否则「prettier 起不来」会被
    // 读成「全库文件都未格式化」。
    const code = res.status ?? 1;
    if (code !== 0 && code !== 1) {
      console.error(`[format] prettier 执行失败(exit ${code}):\n${res.stderr || res.stdout || ""}`);
      process.exit(2);
    }
    for (const line of (res.stdout || "").split("\n")) {
      const f = line.trim();
      if (!f || f.startsWith("[")) continue;
      const rel = toPosix(path.relative(ROOT, path.resolve(ROOT, f)));
      if (isIgnored(rel)) continue;
      found.add(rel);
    }
  }
  return [...found].sort();
}

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 基线必须被 git 跟踪:未被跟踪的棘轮文件在干净检出(CI)里不存在,
 * 门禁会以「基线缺失」失败,或者更糟 —— 本地的收紧悄悄不生效。
 */
function baselineUntracked() {
  const rel = path.relative(ROOT, BASELINE);
  const res = spawnSync("git", ["ls-files", "--error-unmatch", rel], { cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) return `[format] 基线未被 git 跟踪:${rel}（棘轮文件必须入库）`;
  return null;
}

function main() {
  console.log("[format] 运行 prettier --list-different（首次较慢，之后走缓存）…");
  const current = collectUnformatted();
  const prev = readBaseline();
  const prevFiles = prev && prev.files ? prev.files : null;

  if (REPORT_ONLY) {
    console.log(`[format] 未过 prettier:${current.length} 个文件`);
    for (const f of current) console.log(`  · ${f}`);
    process.exit(0);
  }

  if (UPDATE) {
    if (prevFiles) {
      const addedInUpdate = current.filter((f) => !(f in prevFiles));
      if (addedInUpdate.length) {
        console.error(
          `[format] --update 被拒绝:有 ${addedInUpdate.length} 个文件不在基线内（棘轮只许收紧）:\n` +
            addedInUpdate
              .slice(0, 20)
              .map((f) => `  · ${f}`)
              .join("\n") +
            "\n  先对它们执行 pnpm exec prettier --write <file>，再重跑 --update。",
        );
        process.exit(1);
      }
    }
    fs.writeFileSync(
      BASELINE,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString().slice(0, 10),
          note:
            "未过 prettier 的文件（棘轮只许下降）。新增文件必须格式干净；" +
            "存量格式化后重跑 --update 收紧。白名单见 scripts/check-format.cjs 的 IGNORE_GLOBS。",
          files: Object.fromEntries(current.map((f) => [f, true])),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `[format] 基线已更新:${prevFiles ? Object.keys(prevFiles).length : "?"} → ${current.length} 个文件` +
        "（scripts/.format-baseline.json）",
    );
    process.exit(0);
  }

  if (!prevFiles) {
    console.error("[format] 基线文件缺失:先执行 node scripts/check-format.cjs --update");
    process.exit(1);
  }

  const untracked = baselineUntracked();
  if (untracked) {
    console.error(untracked);
    process.exit(1);
  }

  const added = current.filter((f) => !(f in prevFiles));
  const fixed = Object.keys(prevFiles).filter((f) => !current.includes(f));

  console.log(
    `[format] 扫描完成:未过 prettier ${current.length} 个文件（基线 ${Object.keys(prevFiles).length} 个）`,
  );

  if (added.length) {
    console.error(
      "[format] 新增未过 prettier 的文件（规范 §13.5 格式门禁）:\n" +
        added.map((f) => `  · ${f}`).join("\n") +
        "\n  判据:新文件必须格式干净（存量在基线上只许减少）。" +
        "\n  修复:pnpm exec prettier --write <上面列出的文件>（只格式化你改过的,别全库跑）。" +
        "\n  若它是从基线内文件改出来的,说明这次改动把它弄脏了 —— 同样按上面格式化它。",
    );
    process.exit(1);
  }

  if (fixed.length) {
    const msg =
      `[format] ${fixed.length} 个文件已格式化（治理有进展）:\n` +
      fixed
        .slice(0, 20)
        .map((f) => `  · ${f}`)
        .join("\n") +
      (fixed.length > 20 ? `\n  … 其余 ${fixed.length - 20} 个省略` : "") +
      "\n  建议执行 node scripts/check-format.cjs --update 收紧基线。";
    if (STRICT) {
      console.error(msg + "\n  --strict 模式:未收紧基线即失败。");
      process.exit(1);
    }
    console.log(msg);
  }

  console.log("[format] OK");
}

if (require.main === module) main();

/** 供测试直接引用:不跑 prettier 的纯判定。 */
module.exports = { globToRegExp, isIgnored, IGNORE_GLOBS, GLOBS };
