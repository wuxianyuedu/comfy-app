#!/usr/bin/env node
/**
 * generate-api-docs.mjs — 生成一份 API 文档到 `docs/api/`（= `pnpm run docs`，跨平台）。
 *
 * 它只做三件事：定位 typedoc 的输出目录 → 调 `scripts/typedoc-run.mjs` 跑并验 →
 * 把结论翻译成退出码。**跑与验的逻辑不在这里**（`typedoc-run.mjs` 是唯一实现，
 * `scripts/check-docs-api.cjs` 用的是同一份 —— 那边是「生成 + 自检」，这边是「只生成」）。
 *
 * 为什么 `pnpm run docs` 不再直接写 `typedoc`：那个形态下「跑没跑成功」由
 * typedoc 的退出码说了算，而它写失败时照样退 0、日志照样收在
 * `[info] html generated at …` 上 —— 现场是「退出码 0 + 说生成了 + 产物一个没更新」，
 * 下一次有人发现已经是「翻 `docs/api` 看到它过期」。现在换成一个会验产物、会重试、
 * 全失败就退 1 的入口（背景与判据见 `typedoc-run.mjs` 的文件头）。
 *
 * ⚠️ **产物不再进 git**（ISSUE #2231）：`docs/api/` 进了 `.gitignore` ⇒ 本命令生成的
 * 那份只是**本机的一份副本**，没有「必须一并提交」的义务，也没有人会因为它过期而红
 * ——「提交进 git 的那份产物与源同不同步」这个问题连同它的判据一起没了
 * （见 `scripts/check-docs-api.cjs` 的文件头）。平台侧那一格
 * （`.cnb.yml` 的「API 文档生成与自检」）跑的是同一份生成 + 一道自检。
 *
 * ⚠️ 别写 `pnpm docs`：那是 pnpm 的**内建命令**（`pnpm docs <PACKAGE>` 打开某包的
 * 文档），会抢在脚本前面、typedoc 根本不跑。带脚本名的动词要用 `pnpm run <脚本>`。
 *
 * ⚠️ **别把本文件 `await import` 进任何 `.cjs` / `.ts` / `.js`**（跨平台动作用
 * `.mjs` 是 §9.5 的口径，但「被 import」这件事有个副作用）：仓库的 `tsconfig.json`
 * 把全仓的 `.cjs` / `.ts` / `.js` 都编进了 program，而 typedoc 用的正是那份
 * program ⇒ 一个被 import 的 `.mjs` 会**跟着进 typedoc 的类型检查面**，它身上的类型
 * 错误会让 typedoc 直接退 3（实测：`scripts/` 下一批 `.mjs` 有几十处存量类型错误）。
 * 现在 `scripts/check-docs-api.cjs` 只 import `scripts/typedoc-run.mjs` 与
 * `scripts/docs-api-input-closure.mjs` —— 这两个（连同它们的传递依赖）都是类型干净的。
 *
 * ⚠️ 本文件现在带「被直接执行才跑」的守卫（见文件尾），所以 import 它**不再**付一次真
 * typedoc 全量生成 —— 那一层危险是 ISSUE #2740 的现场：为了量 `parseArgs` 的行为 `import`
 * 了一次，屏幕上多出 `[OK] html generated: 2844 files`。但**上面那一层（进 typedoc 的
 * 类型检查面）照旧成立**，所以这条「别 import」的警告整体仍然有效，别把它读成
 * 「现在可以 import 了，反正不跑了」。
 *
 * 用法：
 *   node scripts/generate-api-docs.mjs                    # 写 docs/api（默认）
 *   node scripts/generate-api-docs.mjs --out <dir>        # 写到别处（排查 / 比对用）
 *   node scripts/generate-api-docs.mjs --out=<dir>        # 同上的等号形式
 *   node scripts/generate-api-docs.mjs --attempts 1       # 不重试（想看原始失败时）
 * 退出码：0 产物已更新；1 跑了但产物没更新（或 typedoc 起不来）；
 *         **2 用法错**（缺值 / 空值 / `--attempts` 不是正整数 / 不认的参数 /
 *         解析结果落在仓库根本身）。这一档存在的理由就是：坏输入从前会被折成一个
 *         合法默认值，然后照常往下跑（ISSUE #2740）。
 */
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { DEFAULT_ATTEMPTS, runTypedoc } from "./typedoc-run.mjs";
import { rejectUnknownArgs } from "./cli-arg-contract.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
/** 与 `typedoc.json` 的 `out` 同一个目录。 */
const DEFAULT_OUT = "docs/api";
/** 这个入口认的旗标（一份出处：解析、报错话术与用例都读它）。 */
const RECOGNIZED_FLAGS = ["--out", "--attempts"];

/**
 * 解析后的形态。
 * @typedef {Object} ParsedArgs
 * @property {{out: string, attempts: number}} opts 只有 `problems` 为空时才可拿去跑
 * @property {string[]} problems 用法错的那几句（空 = 这一串可用）
 */

/**
 * 解析命令行：`--out <dir>` / `--out=<dir>` / `--attempts <n>` / `--attempts=<n>`，
 * 其余一律**记成问题**而不是静默忽略。
 *
 * 为什么这一格要判红而不是兜底（ISSUE #2740 的现场）：原来 `value()` 写的是
 * `argv[++i] ?? ""`，于是「`--out` 后面没人了」与「后面是个空串」折成同一件事实 ——
 * `out` 成了 `""`，而 `path.resolve(ROOT, "")` **就是仓库根**，下一步 typedoc 会被以
 * `--out <仓库根>` 起起来（整站产物写进根上，而根上那一份不被 `.gitignore` 忽略）。
 * 这与本文件当初换掉「`pnpm run docs` 直接写 typedoc」的理由是同一个病：
 * **接了一个用不了的值，然后照常往下跑，屏幕上什么都没说**。
 *
 * 所以这里不返回退码，只把问题攒下来交回调用方 —— 打印与退 2 都只在 `main` 一处，
 * 用例于是能只调这个函数就拿到两种形状，不必为此付一次真生成。
 * @param {string[]} argv
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  /** @type {{out: string, attempts: number}} */
  const opts = { out: DEFAULT_OUT, attempts: DEFAULT_ATTEMPTS };
  /** @type {string[]} */
  const problems = [];
  /** 被消费掉的位（旗标自己 + 它的值）；剩下的都算「不认的参数」 */
  const consumed = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    /* `noUncheckedIndexedAccess` 之下按下标取到的是 `string | undefined`；
     * `i < argv.length` 已保证这一格有值，守卫只把这件事写给类型检查器看 ——
     * 与 `scripts/dev.mjs` 的 `parseArgs` 同一个写法。 */
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 守卫为 tsc noUncheckedIndexedAccess 收窄服务（删掉 tsc 红），oxlint 的类型解析不含该开关
    if (arg === undefined) {
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (!RECOGNIZED_FLAGS.includes(name)) {
      continue;
    }
    consumed.add(i);
    /* 等号形式带值；空格形式吃下一个 token 当值（那一格也标记为已消费，
     * 否则它会被上面那句「剩下的都不认」误报成多余参数）。 */
    let value;
    if (eq > 0) {
      value = arg.slice(eq + 1);
      if (value === "") {
        problems.push(`${arg}：等号后面是空的 —— 要么给个值，要么整个旗标别写。`);
        continue;
      }
    } else {
      const next = argv[i + 1];
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- 旗标收尾时 argv[i+1] 运行时为 undefined（不是纯类型收窄）
      if (next === undefined || next.startsWith("-")) {
        problems.push(
          `${arg}：后面没有值（给了旗标却没给东西，与「压根没给」不是同一件事，不能默认）。`,
        );
        continue;
      }
      value = next;
      consumed.add(i + 1);
      i += 1;
    }
    if (name === "--out") {
      opts.out = value;
    } else {
      /* 只认**十进制正整数**字面量：`parseInt("2.9")` 给 2、`parseInt("0")` 给 0，
       * 而「你写的 2.9 我按 2 跑了」与「你写的 0 我按默认跑了」都是屏幕上没说过的改写。 */
      if (!/^\d+$/.test(value) || Number.parseInt(value, 10) < 1) {
        problems.push(
          `--attempts ${value}：要一个 ≥ 1 的整数次数（不是数字、是 0、或带小数点都不收）。`,
        );
        continue;
      }
      opts.attempts = Number.parseInt(value, 10);
    }
  }
  /* 不认的参数交给那份**既有**的可行动话术（与 `db:push` / `db:migrate` 同一条口径，
   * 不在这里重写一遍「它认什么 / 你想要的对应哪一条」）。`fail` 在这里只把正文攒进
   * `problems` —— 打印与退码仍然只有一处（`main`），本件不决定退成几。 */
  rejectUnknownArgs({
    argv: argv.filter((_arg, index) => !consumed.has(index)),
    recognized: RECOGNIZED_FLAGS,
    command: "run docs",
    action:
      "它默认动的是 **`typedoc` 真跑一遍并把整站产物写盘**（不是只读体检；只读的引用与权威源核对在 `pnpm run doc:check`）。",
    exits: [
      "只想确认这份文档生成得了 → node scripts/check-docs-api.cjs（同一份生成 + 一道自检）；",
      "写到别处去比对 → --out <目录>（不给就是 docs/api；给空串不是「不写」，而是写进仓库根）；",
      "不想重试、要看原始失败 → --attempts 1；",
      "整档测试与覆盖率 → pnpm test（这份入口不在那条链上）。",
    ],
    fail: (text) => {
      problems.push(text);
    },
  });
  return { opts, problems };
}

async function main() {
  const { opts, problems } = parseArgs(process.argv.slice(2));
  if (problems.length > 0) {
    process.stderr.write("\n[docs] ✗ 用法错：\n\n");
    for (const p of problems) {
      process.stderr.write(`  · ${p}\n`);
    }
    process.stderr.write(
      `\n[docs] 认的旗标只有 ${RECOGNIZED_FLAGS.join(" / ")}，两种形式都认` +
        "（`--out <目录>` 与 `--out=<目录>`）；这一条一个参数都没吃进去，产物没动。\n\n",
    );
    return 2;
  }
  const outDir = path.resolve(ROOT, opts.out);
  /* 最后一道边界：**输出目录不许是仓库根本身**。上面那条兜底已经修了，但
   * 「有人显式写 `--out .`」是同一后果的另一条来路 —— 而它的代价（整站写进根上）
   * 不该指望调用方自己想到。真要写到别处就给一个目录名，写到根上没有用途。 */
  if (outDir === ROOT) {
    process.stderr.write(
      `\n[docs] ✗ 输出目录解析出来是仓库根本身：${outDir}\n` +
        "[docs]   那会把整站产物（本机实测 2844 份文件）写进根上，而根上那一份**不被" +
        " `.gitignore` 忽略**（名单里只有 `docs/api/`）。\n" +
        "[docs]   出口：--out docs/api（默认即此）或 --out <你要的那个目录>。\n\n",
    );
    return 2;
  }
  // 先把「写到哪儿」这句话打出来：曾经有过「退出 0 + 说生成了 + 产物没动」的现场，
  // 而排查时第一个该排除的就是「它其实写到了另一个目录」。
  console.log(`[INFO] typedoc out: ${outDir}`);

  const res = await runTypedoc({ root: ROOT, outDir, attempts: opts.attempts });
  if (!res.ok) {
    console.error(
      `[ERROR] typedoc did not update ${res.outDir} after ${res.attempt}/${res.total} attempt(s): ${res.reason}`,
    );
    console.error(`[ERROR] files before=${res.before.files} after=${res.after.files}`);
    if (res.log) {
      console.error(`[ERROR] typedoc log tail:\n${res.log}`);
    }
    console.error(
      `[ERROR] hint: a stale process / editor / indexer may still hold files under the out dir ` +
        `(EPERM / EBUSY on Windows is the usual shape). Close it and retry, or pass ` +
        `--out <other-dir> to see whether the out dir itself is the problem.`,
    );
    return 1;
  }
  console.log(
    `[OK] html generated: ${res.files} files -> ${res.outDir} (attempt ${res.attempt}/${res.total})`,
  );
  return 0;
}

// 用 exitCode 而不是 process.exit：后者会把还没 flush 的 stdout 截掉（Windows 管道上实测）。
/* 「被直接执行才跑」的守卫（ISSUE #2740 第 2 案）：原来 `main()` 挂在模块顶层，
 * 于是 `export` 出去的 `parseArgs` **一旦被 import 就付一次真 typedoc 全量生成**
 * —— 那正是它的旗标行为至今没有用例的原因（要写用例的人得先等一整轮真生成、数十秒级，
 * 现值取法见规范 §13.5.17，并往盘上写两千多份文件）。
 * `process.argv[1] &&` 那一格不是装饰：`node --input-type=module -e …` 那种宿主里它是
 * undefined，`pathToFileURL(undefined)` 当场抛 —— 形态照 `scripts/agent-film.mjs` 的写法，
 * 也别改成手拼 `file://`（那是 `tests/script-main-guard.test.ts` 钉着的坏形）。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
