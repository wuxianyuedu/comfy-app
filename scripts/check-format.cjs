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
 * 白名单里的第二类是**非源码产物**:`src-tauri/target/` 下是 `cargo build` 的输出
 * (Rust 壳),由**嵌套的** `src-tauri/.gitignore` 忽略。prettier 只按 cwd(仓库根)
 * 读 `.gitignore`,嵌套的忽略文件它看不到 —— 于是构建过一次的检出会把 target 下的
 * 生成脚本(out/__global-api-script.js)判成「新增未过格式的文件」,阻断每一次提交
 * (ISSUE #638 修好 pnpm 启动形态后本门禁才第一次真正扫到全库,这条才暴露;CI 的
 * 干净检出没有 target 目录,所以只有开发机踩得到)。产物既不该被格式化 ——
 * 下一次构建会覆盖它,也不该进棘轮计数。
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
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");

/* prettier 的调用**不再经 pnpm 层**（口径同台账 E10：平台 shim 那一层正是
 * 「命令没跑成却被读成没问题」的藏身处）。三级解析：
 *   1. `COMFYAPP_PRETTIER_ENTRY` —— 门禁自己的用例在临时目录里搭沙箱，那里没有
 *      `node_modules`，不给这条接缝就只能撞「Command "prettier" not found」；
 *   2. 本地安装的 `prettier/bin/prettier.cjs`（按扫描根解析，与真实门禁一致）；
 *   3. 两者都没有 → exit 2 并说明「没跑成」。
 * **任何一档都不许回落成「0 个文件未过」** —— 那正是本脚本过去的 fail-open 形态。
 *
 * 取 ESM 判据模块（`launcher-core/shell.mjs`）的那段动态 import 随之删除：
 * 本脚本不再需要 pnpm 形态判定，`main()` 保持 async 只为收尾顺序不变。 */

/** prettier 入口的三级解析（见上）。取不到返回 null，由 `main()` 以 exit 2 收尾。 */
function resolvePrettierEntry() {
  const fromEnv = process.env.COMFYAPP_PRETTIER_ENTRY;
  if (fromEnv) return fs.existsSync(fromEnv) ? fromEnv : null;
  try {
    // 按扫描根解析：门禁在仓库根被调用，本地 `node_modules/prettier` 就是它的依赖。
    return createRequire(path.join(ROOT, "noop.js")).resolve(
      "prettier/bin/prettier.cjs",
    );
  } catch {
    return null;
  }
}

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

/** 白名单(glob,相对仓库根):① 高频 churn 路径;② 非源码产物(构建输出)。见文件头注释。 */
const IGNORE_GLOBS = [
  "scripts/**",
  "tests/**",
  "tools/**",
  "e2e/**",
  "public/**",
  "docs/api/**",
  "docs/generated/**",
  /* ② 非源码产物:Rust 壳的构建输出(被嵌套的 src-tauri/.gitignore 忽略)。 */
  "src-tauri/target/**",
  "*.config.{js,ts,mjs,cjs}",
  "*.js",
];

/**
 * prettier 缓存放在**本次检出**的构建输出目录下，不再是一个 `os.tmpdir()` 里的
 * 机器全局路径（实测语义：prettier 3.9 把 `--cache-location` 当**文件**用，
 * 那个路径下长出来的是一份 JSON 缓存，不是目录）。
 *
 * 换成本地路径有两个理由：① 门禁自己的用例会并发搭临时沙箱，共用机器全局路径时
 * 多个进程往同一份缓存里写，读数不可信；② 缓存跟着用户走 → 换一台机器、
 * 换一个 worktree 都是同一份，出问题时没法按检出隔离（本仓库有并行会话在同一台
 * 机器上跑，这条是实测过的）。仍然不进仓库根：只在 `node_modules/.cache/` 下，
 * 已被 git 忽略，也就不进基线。
 */
const CACHE_FILE = path.join(
  ROOT,
  "node_modules",
  ".cache",
  "prettier-gate.json",
);

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

/**
 * 找出未过 prettier 的文件(仓库根相对 POSIX 路径,已排序,已剔除白名单)。
 *
 * 三条**fail-closed** 规则（本函数过去只有前两条的一半，因而存在一条
 * 「命令没跑成 → 报全库干净」的出路，见台账 E11）：
 *   · 子进程被信号杀掉（`status === null`，含超时被杀）→ exit 2；
 *   · 退出码不属于 {0, 1} → exit 2（配置写错 / 解析失败，prettier 会走这一档）；
 *   · **退出 1 却一行文件都没列出来** → exit 2。
 * 第三条是关键：`--list-different` 返回 1 的含义是「有差异，清单在 stdout」，
 * 而清单为空与「命令根本没跑成」（例如 `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL
 * Command "prettier" not found`，退出码同样是 1 且 stdout 为空）在旧代码里
 * 长得一模一样 —— 于是门禁把「什么都没扫」读成「0 个文件未过（基线 0 个）/ OK」。
 */
function collectUnformatted(entry) {
  const found = new Set();
  for (const glob of GLOBS) {
    const args = [
      "--list-different",
      "--cache",
      "--cache-location",
      CACHE_FILE,
      glob,
    ];
    const res = spawnSync(process.execPath, [entry, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      // 单文件清单在超大仓库里能到几百 KB；默认 1 MB 会把 stdout 截成空串，
      // 那正好落进上面第三条要拦的形态 —— 宁可显式给大。
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600_000,
    });
    if (res.error) {
      console.error(
        `[format] 无法执行 prettier（${res.error.code ?? "UNKNOWN"}）：${res.error.message}\n` +
          `[format]   实际命令：${process.execPath} ${entry} ${args.join(" ")}`,
      );
      process.exit(2);
    }
    if (res.status === null) {
      console.error(
        `[format] prettier 被信号终止（${res.signal ?? "unknown"}），不是「没有差异」。\n` +
          `[format]   入口 ${entry}，缓存 ${CACHE_FILE}。`,
      );
      process.exit(2);
    }
    const lines = (res.stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("["));
    if (res.status !== 0 && res.status !== 1) {
      console.error(
        `[format] prettier 执行失败(exit ${res.status}):\n${res.stderr || res.stdout || ""}`,
      );
      process.exit(2);
    }
    if (res.status === 1 && lines.length === 0) {
      console.error(
        "[format] prettier 退出 1（「有差异」）却没有列出任何文件 —— 按 fail-closed 判定为\n" +
          "[format]   「命令没跑成」，不是「全库干净」。真实仓里出现这一行请贴出入口与\n" +
          "[format]   下面这段 stderr。",
      );
      if (res.stderr)
        console.error(`[format]   stderr: ${String(res.stderr).trim()}`);
      process.exit(2);
    }
    for (const f of lines) {
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
  const res = spawnSync("git", ["ls-files", "--error-unmatch", rel], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0)
    return `[format] 基线未被 git 跟踪:${rel}（棘轮文件必须入库）`;
  return null;
}

async function main() {
  const entry = resolvePrettierEntry();
  if (!entry) {
    /* 「取不到 prettier」与「全库都格式化好了」是两种结论，必须走不同的门。
     * 旧代码在这一档会一路走到 `[format] OK`（空清单 = 0 个未过），
     * 也就是门禁在依赖缺失 / 形态选错的机器上**静默放行**（台账 E11）。 */
    console.error(
      "[format] 找不到 prettier 入口：本地 node_modules 里没有它，" +
        "`COMFYAPP_PRETTIER_ENTRY` 也没给。\n" +
        "[format]   以 exit 2 结束 —— 判据没跑成不许读成「全库干净」。",
    );
    process.exit(2);
  }
  console.log(
    "[format] 运行 prettier --list-different（首次较慢，之后走缓存）…",
  );
  const current = collectUnformatted(entry);
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
    console.error(
      "[format] 基线文件缺失:先执行 node scripts/check-format.cjs --update",
    );
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
