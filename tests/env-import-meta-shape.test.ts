/**
 * 「会被 Turbopack 打包的那一侧，`import.meta` 上只有 `url`」这条边界（ISSUE #2599）。
 *
 * ## 它守的是什么
 *
 * `src/env.js` 有一段「缺 `.env` 时给一句人话」的预检，它要先把自己所在目录的父目录
 * 算出来。`chore #2556` 那批把全仓的 `fileURLToPath(import.meta.url)` 样板换成
 * `import.meta.dirname` —— 在 `scripts/**` 那 141 处是对的（纯 Node 宿主，ESM 运行时
 * 真的提供这一位），而 `src/**` 里那一处会被打包器重写：
 *
 *   · 产物里 `import.meta` 是 Turbopack 合成的一个**取值器对象**，只有 `url`
 *     （`var __TURBOPACK__import$2e$meta__ = { get url () { return
 *     __turbopack_context__.F("src/env.js") } }` —— 读物是本仓 `.next/dev/server/chunks/`
 *     里改动前留下的产物，两份都对过；原始读数记在单子与规范 §9.1 里）；
 *   · 于是 `join(import.meta.dirname, "..", ".env")` 抛
 *     `ERR_INVALID_ARG_TYPE: The "path" argument must be of type string. Received undefined`，
 *     抛的时机是 `next build` 的 **collect page data** ⇒ `pnpm build` 整档红。
 *
 * 这条判据**不靠那份产物读数**（`.next` 不是每次都在：全新检出、清过缓存、或别人正好在
 * 构建就没有读物，而「没有读物」绝不能被读成「判过且通过」）。它判的是四件确定的事：
 * 那一侧不许出现那两位属性、边界是刻意的（`scripts/**` 那一侧照旧在用）、这段预检真的
 * 走在安全那一侧上、以及 `SKIP_ENV_VALIDATION` 的短路排在任何干活之前。
 *
 * ## 为什么这条判据必须进固定清单
 *
 * 它读的是磁盘文本（`readdirSync` + 正则），**不在这份仓库的 import 图里**：改
 * `src/env.js` 或任何 `src/**` 的人，增量面都不会把这条带上去。本仓为这一族记过账
 * （「判据在场、执行者不在场」⇒ 红落在之后每条 PR 上，主干冻结），所以它登记在
 * `scripts/fixed-structural-tests.mjs` 的固定清单里，每次提交都跑。
 *
 * ## 为什么反向那一半也要钉
 *
 * 只判「`src/**` 不许有」的话，下一任读者最容易做的处置是**把禁用扩到全仓** ——
 * 那会连带撤掉 `#2556` 那批里 141 处正当写法。所以这里同时钉「`scripts/**` 里
 * 这一位仍然在用、且判据不许去管它」。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/** 只被打包器看过的那一侧：`src/**`，且**不含**测试（测试跑在真 Node ESM 上）。 */
const BUNDLED_FACE = "src";
/** 纯 Node 宿主那一侧：判据只读文本，不把它算进任何靶子。 */
const NODE_ONLY_FACE = "scripts";

/** 那一族属性：`import.meta.dirname` / `import.meta.filename`（`url` 不在其内）。 */
const UNSAFE_IN_BUNDLE = /import\.meta\.(dirname|filename)\b/g;

function walk(dir: string): Array<string> {
  const out: Array<string> = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** 扫一面，返回「文件:行 + 命中的那位属性」。
 *
 * **整行注释不计**（`//` 开头与 JSDoc 的 ` * ` 续行）：判据要报的是「这行代码会在
 * 打包图里取一个不存在的属性」，而 `src/env.js` 那段⚠️注释必须**点名这两位**才能把
 * 边界讲清楚 —— 把说明文字算成违规，逼出来的只会是一份读不出原因的注释。
 * 尾随注释（`code // import.meta.dirname`）仍然算：那一行本来就是代码。 */
function findUnsafe(face: string, { includeTests }: { includeTests: boolean }) {
  const hits: Array<string> = [];
  for (const file of walk(path.join(REPO_ROOT, face))) {
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(file)) continue;
    if (!includeTests && /\.test\.(ts|tsx|js|mjs|cjs)$/.test(file)) continue;
    const lines: Array<string> = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      for (const match of line.matchAll(UNSAFE_IN_BUNDLE)) {
        hits.push(`${path.relative(REPO_ROOT, file)}:${index + 1} · import.meta.${match[1]}`);
      }
    });
  }
  return hits;
}

describe("打包面上的 import.meta：src/** 只有 url 这一位是活的（ISSUE #2599）", () => {
  it("src/**（非测试）里一个 `import.meta.dirname` / `filename` 都不许有", () => {
    /* 硬闸口径（没有基线、没有 `--update`）：这一族的存量就是 0，而它**只在存量清零
     * 之后才红** —— 出问题的时刻正是「第一条带它进 `src/**` 的改动」。命中即给出
     * 「文件:行 + 哪一位」，不让读者再去猜是谁。 */
    const hits = findUnsafe(BUNDLED_FACE, { includeTests: false });
    expect(
      hits,
      `被打包器重写的那一侧出现了只在 Node ESM 运行时才有的属性 —— 下一跳就是 ` +
        "`next build` 红在 collect page data（ISSUE #2599）。改法：" +
        '`dirname(fileURLToPath(import.meta.url))` 或 `new URL("../x", import.meta.url)`。' +
        `命中：\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("**反向那一半**：`scripts/**` 里这一位仍在正当使用，判据不许扩到那一边", () => {
    /* 这条不是冗余：它钉的是「边界是刻意的」。把判据改成全仓禁用，会连带撤掉
     * `#2556` 那批里 141 处正当写法（那些文件不进打包图，`import.meta.dirname`
     * 在那里确实有值）。所以「scripts 面命中数 > 0」本身就是这条边界的存在证明。 */
    const nodeOnly = findUnsafe(NODE_ONLY_FACE, { includeTests: true });
    expect(
      nodeOnly.length,
      "`scripts/**` 一个都没命中 ⇒ 要么那批被整体改回 url 形态、要么扫描面坏了；" +
        "两种都说明这条边界已经不是 #2599 记的那条口径",
    ).toBeGreaterThan(0);
  });

  it("`src/env.js` 的 `.env` 探测走在 `import.meta.url` 那一侧", () => {
    /* 第一条禁了危险那一侧，这条补的是「这个文件真的走在安全那一侧上」—— 缺了它，
     * 把整段预检删掉也能让第一条绿。钉语义不钉整行：具体写法（`new URL` 还是
     * `dirname(fileURLToPath(…))`）随格式化漂。 */
    const text = readFileSync(path.join(REPO_ROOT, "src/env.js"), "utf8");
    expect(text).toContain("import.meta.url");
  });

  it("`SKIP_ENV_VALIDATION` 的短路排在**任何路径 / fs 动作之前**", () => {
    /* #2599 的**第二格**，比属性那一格更阴：原来写的是「先 `join(...)`、只在用结果时
     * 看旗标」，于是两个**显式声明跳过校验**的执行者（`.cnb.yml` 的构建档、
     * `standalone-runtime-env.mjs` 的桌包运行期）照样在那一行上炸 —— 表现是「我按
     * 你说的跳过了，却红在你没跳过的那一步」。旗标的语义是「整段跳过」，短路就得排在
     * 所有 fs/path 动作之前。
     *
     * 只比两个位置：短路那一行、与这段预检**第一次去碰 Node 内置模块**的那一行
     * （`await import("node:fs")`）—— 它是整段里最早的一个动作，比拿 `join(` 当锚点
     * 稳：注释里出现 `join(` 太常见，会把「干活在前」判成假红。 */
    const text = readFileSync(path.join(REPO_ROOT, "src/env.js"), "utf8");
    const guard = text.indexOf("!process.env.SKIP_ENV_VALIDATION");
    expect(guard, "取不到那条短路 ⇒ 外层守卫里没有这枚旗标（#2599 那一格会回来）").toBeGreaterThan(
      -1,
    );
    const firstWork = text.indexOf('await import("node:fs")');
    expect(
      firstWork,
      '取不到 `await import("node:fs")` ⇒ 这段预检被删了？那就不是「顺序」问题了',
    ).toBeGreaterThan(-1);
    expect(
      guard < firstWork,
      `短路排在第 ${guard} 字节、第一次碰 fs 在第 ${firstWork} 字节 ⇒ 顺序反了：` +
        "设了 SKIP_ENV_VALIDATION 也照样在那一行上炸",
    ).toBe(true);
  });
});
