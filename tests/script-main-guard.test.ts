/**
 * `scripts/**` 的「是否被直接执行」守卫：**不许拼 `file://${argv[1]}`**（ISSUE #1961 最后一格）。Windows 上 `import.meta.url` 是 `file:///F:/…`（三斜杠 + 正斜杠），拼出来的是 `file://F:\…`（两斜杠 + 反斜杠）——**恒不相等**，于是 `main()` 一次不跑、进程正常退出 0。
 * 两步探针（`== OS ==` / `== python ==`）一字未出，缺 Python 一路滑到 18 分钟后的 E2E 才以功能红暴露 ——「一步没跑」被读成「这一步过了」。本仓另三处（`check-merge-parents.mjs` 等）有注释无判据，靠注释传的约定下次新增脚本必再犯。
 * 判据按**代码行**扫 `scripts/**` / `tools/**` 的 `.mjs`/`.cjs`（先剥注释与字符串），命中「与 `import.meta.url` 比较」即红；正确写法两侧都过 `path.resolve`（或 `pathToFileURL(...).href`）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** 扫这些目录下的脚本（`tools/` 里也有 `.ps1`，按扩展名过滤掉）。 */
const SCAN_DIRS = ["scripts", "tools"];

/** 只认这两种脚本扩展名 —— `.ps1` / `.rs` 里出现同形文本不是本判据的事。 */
const SCRIPT_EXTS = new Set([".mjs", ".cjs"]);

/** 递归收集待扫文件（跳过 `node_modules` 与隐藏目录）。 */
function collect(dir: string, out: Array<string> = []): Array<string> {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (SCRIPT_EXTS.has(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 剥掉注释与字符串字面量，只留「会被执行到的代码」。为什么非剥不可：本仓另三处的注释里**正当地**
 * 写着这个坏形态（当反面教材，如 `check-merged-side-loss.mjs`），不剥会把「写了警告的文件」判红 ——
 * 那是**反向**的，且会让下一个人删掉注释让它变绿。
 */
function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  /** 状态：`code` / `line` / `block` / `sq`（'）/ `dq`（"）/ `bt`（`） */
  let state: "code" | "line" | "block" | "sq" | "dq" | "bt" = "code";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && n === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") {
        state = "sq";
        i++;
        continue;
      }
      if (c === '"') {
        state = "dq";
        i++;
        continue;
      }
      // 反引号：模板串里正是那个坏形态所在的地方，必须**保留内容**
      // （判据要判的就是 `file://${...}` 这个模板串），所以整段原样收进来。
      // 模板串里的注释语法不存在，剥它没有意义；扫到配对的收尾反引号为止
      // （不展开 `${}` 里的嵌套模板 —— 扫描面里没有那种形态，宁可漏也不误报）。
      if (c === "`") {
        out += c;
        i++;
        while (i < src.length && src[i] !== "`") {
          out += src[i];
          i++;
        }
        if (i < src.length) {
          out += src[i];
          i++;
        }
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += c;
      }
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        state = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    // 普通字符串（单引号 / 双引号两档）：走到同种引号即收尾。刻意不处理转义 ——
    // 本判据的扫描面里没有需要在字符串内转义的引号形态，宁可漏一个也不误报一片。
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"')) {
      state = "code";
      i++;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * 坏形态：拿拼接出的 `file://` 串与 `import.meta.url` 做相等比较。收两种拼法（自托管节点上恒不相等）：`file://${process.argv[1]}`（绝对路径但分隔符是反斜杠）、`file://${path.resolve(process.argv[1])}`。
 * **只判「与 `import.meta.url` 比较」这一形态**，不禁所有 `file://${…}`（`src/server/workshop/comfyui.ts` 拼 `file://` 是给前端的图片 URL，与直接执行无关）。
 */
const BAD_PATTERNS: Array<{ re: RegExp; what: string }> = [
  {
    re: /import\.meta\.url\s*===\s*`file:\/\/\$\{[^}]*process\.argv\[1\][^}]*\}`/,
    what: "import.meta.url === `file://${process.argv[1]}`",
  },
  {
    re: /`file:\/\/\$\{[^}]*process\.argv\[1\][^}]*\}`\s*===\s*import\.meta\.url/,
    what: "`file://${process.argv[1]}` === import.meta.url",
  },
  {
    re: /import\.meta\.url\s*===\s*`file:\/\/\$\{[^}]*path\.resolve\(\s*process\.argv\[1\]\s*\)[^}]*\}`/,
    what: "import.meta.url === `file://${path.resolve(process.argv[1])}`",
  },
  {
    re: /`file:\/\/\$\{[^}]*path\.resolve\(\s*process\.argv\[1\]\s*\)[^}]*\}`\s*===\s*import\.meta\.url/,
    what: "`file://${path.resolve(process.argv[1])}` === import.meta.url",
  },
];

describe("「是不是被直接执行」的守卫：不许拼 file://（ISSUE #1961）", () => {
  it("`scripts/**` / `tools/**` 里没有一处拿拼接的 file:// 串与 import.meta.url 比", () => {
    const files = SCAN_DIRS.flatMap((d) => collect(path.join(ROOT, d)));
    // 扫描面不许空转：这两个目录合起来几十个入口，扫成 0 个说明路径写错了。
    expect(files.length).toBeGreaterThan(20);

    const offenders: Array<string> = [];
    for (const file of files) {
      const code = stripCommentsAndStrings(readFileSync(file, "utf8"));
      for (const { re, what } of BAD_PATTERNS) {
        if (re.test(code)) {
          offenders.push(`${path.relative(ROOT, file)} → ${what}`);
        }
      }
    }
    expect(
      offenders,
      `拼出来的 file:// 串在 Windows 上恒不等于 import.meta.url（三斜杠 vs 两斜杠、` +
        `正斜杠 vs 反斜杠），那会让守卫里的 main() 一次都不跑、**退出码恒 0 且零输出**` +
        `—— 是「这一步没跑」被读成了「这一步过了」。改用两侧都过 path.resolve 的比较` +
        `（或 pathToFileURL(…).href）。命中：\n${offenders.map((o) => `  · ${o}`).join("\n")}`,
    ).toEqual([]);
  });

  it("三个曾经栽在这上面的入口是**跑得动**的（不是靠注释记得）", () => {
    /* 反向钉住「修好了」这一侧：这三份是本次改过的文件，它们都必须带
     * `import.meta.dirname` / `import.meta.filename` 的规范化比较（由
     * `fileURLToPath(import.meta.url)` 迁移而来）。少了它 = 又变回拼串那一形态。 */
    for (const rel of [
      "scripts/ci-toolchain-selfcheck.mjs",
      "scripts/python-probe.mjs",
      "scripts/db-legacy-sweep.mjs",
    ]) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      expect(
        src,
        `${rel} 丢了 import.meta 的规范化比较（import.meta.dirname / import.meta.filename）`,
      ).toMatch(/import\.meta\.(?:dirname|filename)/);
      // 也可以两侧都过 path.resolve；无论哪种，都不许再出现拼串比较。
      for (const { re, what } of BAD_PATTERNS) {
        expect(re.test(stripCommentsAndStrings(src)), `${rel} 又出现 ${what}`).toBe(false);
      }
    }
  });

  it("判据自己不许空转：坏形态的样例必须判红、好形态必须判绿", () => {
    /* 这条是本判据的**自证**（本仓既有口径：判据要能反向复算）。造两份最小样例，
     * 走的是与上面同一条判定函数。 */
    const bad = stripCommentsAndStrings(
      "if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) { main(); }",
    );
    expect(BAD_PATTERNS.some(({ re }) => re.test(bad))).toBe(true);

    const bad2 = stripCommentsAndStrings(
      "if (import.meta.url === `file://${process.argv[1]}`) { main(); }",
    );
    expect(BAD_PATTERNS.some(({ re }) => re.test(bad2))).toBe(true);

    const good = stripCommentsAndStrings(
      "if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) { main(); }",
    );
    expect(BAD_PATTERNS.some(({ re }) => re.test(good))).toBe(false);

    const good2 = stripCommentsAndStrings(
      "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { main(); }",
    );
    expect(BAD_PATTERNS.some(({ re }) => re.test(good2))).toBe(false);

    // 注释里的同形文本要放过（本仓另三处的反面教材注释正是这个形状）。
    const commented = stripCommentsAndStrings(
      "// 拼 `file://${argv[1]}` 在 Windows 上恒不相等，那会让 main() 一次都不跑\nconst x = 1;\n",
    );
    expect(BAD_PATTERNS.some(({ re }) => re.test(commented))).toBe(false);
  });
});
