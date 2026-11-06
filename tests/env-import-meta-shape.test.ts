/**
 * `import.meta` 边界（ISSUE #2599）：`src/env.js` 预检要算自身父目录；`chore #2556` 换成 `import.meta.dirname`（`scripts/**` 141 处对，`src/**` 会被打包器重写）。Turbopack 产物里 `import.meta` 只有 `url` ⇒ `join(import.meta.dirname, ...)` 抛 `ERR_INVALID_ARG_TYPE`，`pnpm build` 在 collect page data 全红。
 * 判据不靠产物读数（缺读数 ≠ 通过），判四件事：`src/**` 无此属性、`scripts/**` 边界照旧、预检在安全侧、`SKIP_ENV_VALIDATION` 短路最先。
 * 读磁盘文本不在 import 图 ⇒ 登记 `scripts/fixed-structural-tests.mjs` 固定清单；不许扩到全仓（会撤掉 141 处正当写法）。
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
const UNSAFE_IN_BUNDLE = /import\.meta\.(?<attr>dirname|filename)\b/g;

function walk(dir: string): Array<string> {
  const out: Array<string> = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** 扫一面，返回「文件:行 + 命中的那位属性」。整行注释（`//` 与 ` * ` 续行）不计：判据报的是
 * 「这行代码会在打包图里取不存在的属性」，而 `src/env.js` 那段⚠️注释必须点名这两位才能讲清
 * 边界 —— 把说明文字算违规只会逼出一份读不出原因的注释。尾随注释（`code // import.meta.dirname`）
 * 仍算：那一行本来就是代码。 */
function findUnsafe(face: string, { includeTests }: { includeTests: boolean }) {
  const hits: Array<string> = [];
  for (const file of walk(path.join(REPO_ROOT, face))) {
    if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(file)) {
      continue;
    }
    if (!includeTests && /\.test\.(?:ts|tsx|js|mjs|cjs)$/.test(file)) {
      continue;
    }
    const lines: Array<string> = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
        return;
      }
      for (const match of line.matchAll(UNSAFE_IN_BUNDLE)) {
        hits.push(
          `${path.relative(REPO_ROOT, file)}:${index + 1} · import.meta.${match.groups?.attr}`,
        );
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
    /* #2599 第二格：原写法「先 `join(...)`、只在用结果时看旗标」，于是两个**显式跳过校验**的执行者
     * （`.cnb.yml` 构建档、`standalone-runtime-env.mjs` 桌包运行期）照样在那行炸 —— 「我按你说的跳过了，
     * 却红在你没跳过的那一步」。旗标语义是整段跳过，短路必须排在所有 fs/path 动作前。
     * 只比两处：短路行与首次碰 Node 内置的 `await import("node:fs")` —— 它是最早的动作，
     * 比 `join(` 稳（注释里常见 `join(`，会把「干活在前」判成假红）。 */
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
