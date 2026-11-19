/**
 * `.mjs` 入口经 Node ESM 直接加载 `src/**`：**相对说明符必须带扩展名**（ISSUE #1959 立案：E2E 关键流程在 897ms 崩 `ERR_MODULE_NOT_FOUND`）。
 * 起因是 `python-resolve.ts` 等三处无后缀 import，而它们被 `e2e/support/*.mjs` 直接静态加载 —— Node ESM 不猜扩展名，而 tsc / eslint / vitest 都认，
 * 于是「用例绿、真实入口崩」。判据按 Node 口径静态复算：从 `scripts`/`e2e`/`tools` 的 `.mjs`/`.cjs` 入口沿说明符闭包，凡该链加载到的 `.ts` 都须显式带 `.ts`；不 `import()` 真入口（有副作用）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 入口所在的三层（它们是「Node 直接跑」的那一类，不经 Next 打包）。 */
const ENTRY_DIRS = ["scripts", "e2e", "tools"];

/** 跳过的大目录（与 eslint 的 ignores 同坐标，不按需增长）。 */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage"]);

/** 由 `.mjs` / `.cjs` 入口链加载的 `.ts` 源码必须带后缀 —— Node ESM 不做猜测。 */
const TS_SPEC = /\.(?:ts|tsx|mts|cts)$/;

/** 抽出一个模块里**相对**的静态说明符（只认 `from "…"` 与裸 `import "…"`）。 */
export function relativeSpecifiers(source: string): Array<string> {
  const out: Array<string> = [];
  const fromRe = /\bfrom\s+["'](?<spec>[^"']+)["']/g;
  const bareRe = /(?:^|\n)\s*import\s+["'](?<spec>[^"']+)["']/g;
  for (const re of [fromRe, bareRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const spec = m.groups?.spec;
      if (spec?.startsWith(".") === true) {
        out.push(spec);
      }
    }
  }
  return out;
}

/** 递归列出 `dir` 下的文件（跳过 `SKIP_DIRS`）。 */
function listFiles(dir: string, out: Array<string> = []): Array<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      listFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * 从入口目录出发，算「被 Node 直接加载到」的模块里**不带后缀的相对说明符**：入口是 `scripts`/`e2e`/`tools` 的 `.mjs`/`.cjs`，沿**每一个**
 * 相对说明符继续走（不带后缀的也走：Node 当场停，但判据得收全图），仅在「补后缀能解出真 `.ts`」时记违规。⚠️ 第一版对 `.mjs` 直接 `continue` ⇒ 入口那一跳没走出去、判据恒绿（末尾反向复算为此准备）。
 * @returns 每条 `{ file, spec }` —— 一个文件里一个不带后缀、且真解析得到 `.ts` 的说明符。
 */
export function extensionlessTsSpecifiers(root: string = ROOT): Array<{
  file: string;
  spec: string;
}> {
  const offenders: Array<{ file: string; spec: string }> = [];
  const seen = new Set<string>();
  const queue: Array<string> = [];

  // 入口：三个目录下的 .mjs / .cjs（它们是「Node 直接跑」的形态）。
  for (const dir of ENTRY_DIRS) {
    const abs = path.join(root, dir);
    for (const file of listFiles(abs)) {
      if (/\.(?:mjs|cjs)$/.test(file)) {
        queue.push(file);
      }
    }
  }

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) {
      continue;
    }
    seen.add(file);

    const source = readFileSync(file, "utf8");
    for (const spec of relativeSpecifiers(source)) {
      const target = path.resolve(path.dirname(file), spec);
      // ① 带上后缀就能解析到的，继续沿图走（`.ts` / `.mjs` / `.js` 都收）。
      if (isFile(target)) {
        queue.push(target);
        continue;
      }
      // ② 不带后缀：Node 的 ESM 解析器到这里就停了。只在「补 `.ts` 就真在盘上」时
      //    记一笔 —— 那正是本次事故的形态（`"./executable-resolve"` → `…ts`）。
      //    指向目录 barrel / 扩展名别名（`.js` → `.ts`）的那些不是本条的扫描面，
      //    本条不替它们下结论。
      if (TS_SPEC.test(spec)) {
        continue;
      }
      if (isFile(`${target}.ts`)) {
        offenders.push({ file: path.relative(root, file), spec });
      }
    }
  }
  return offenders;
}

/** 是不是一个**真文件**（目录与不存在都算否 —— Node 不会拿目录去当模块加载）。 */
function isFile(p: string): boolean {
  return existsSync(p) && statSync(p).isFile();
}

describe("`.mjs` 入口 → `src/**` 的 Node ESM 路径：相对说明符必须带扩展名", () => {
  it("沿 `.mjs`/`.cjs` 入口的静态闭包，`src/**` 里没有无后缀的相对 import", () => {
    const offenders = extensionlessTsSpecifiers();
    expect(
      offenders,
      `以下模块由 \`.mjs\` 入口经 Node ESM（类型擦除）直接加载，却用了无后缀的相对` +
        `说明符 —— Node 不猜扩展名，整条 stage 会在**加载期** \`ERR_MODULE_NOT_FOUND\`` +
        `退 1（ISSUE #1959 第七跑实测 897ms 崩在 \`E2E 关键流程\`）：\n${offenders
          .map((o) => `  ✗ ${o.file}：import "…${o.spec}" → 改成 "${o.spec}.ts"`)
          .join(
            "\n",
          )}\n（\`tsc\` / eslint / vitest 走的是打包器解析，三条**都会**放过无后缀形态 ——` +
        `所以只有这条按 Node 口径走的判据照得出来。）`,
    ).toEqual([]);
  });

  it("扫描面真的收到了那两条已知的 `.mjs` → `src/**` 消费方", () => {
    // 反向自证：掏空 ENTRY_DIRS 或改坏解析，上面那条会变成恒绿。
    const files = ENTRY_DIRS.flatMap((d) => listFiles(path.join(ROOT, d)));
    const mjsImportingSrc = files.filter((f) => {
      if (!/\.(?:mjs|cjs)$/.test(f)) {
        return false;
      }
      return relativeSpecifiers(readFileSync(f, "utf8")).some(
        (s) => s.includes("/src/") || path.resolve(path.dirname(f), s).includes("/src/"),
      );
    });
    expect(
      mjsImportingSrc.length,
      "没扫到任何「`.mjs` 入口 import `src/**`」的文件 —— 判据的扫描面指错了地方",
    ).toBeGreaterThanOrEqual(2);
  });

  it("判据自己会红：喂进一个无后缀的相对 import 必须被点名", () => {
    // 用真文件而不 mock fs —— 这一格判的正是「Node 会不会解析得了」，
    // mock 掉 fs 等于把判据自己关掉。
    const source = 'import { x } from "./python-candidates";\n';
    expect(relativeSpecifiers(source)).toEqual(["./python-candidates"]);
    expect(relativeSpecifiers('import { x } from "./python-candidates.ts";')).toEqual([
      "./python-candidates.ts",
    ]);
    // 带后缀的那条不该被算成违规（否则判据会逼人把正确的写法改回错的）。
    const offenders = extensionlessTsSpecifiers();
    expect(offenders.every((o) => !TS_SPEC.test(o.spec))).toBe(true);
  });
});
