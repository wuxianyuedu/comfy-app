/**
 * 「被类型检查的那份源码，import 了一个不入库的生成模块」—— 这条链剩下的三环
 *（台账 E15）。
 *
 * 事故形状很干净：`b9cbd762` 把 Storybook 的注入层接上了按检出路径现算的应用端口，
 * 产物落 `.storybook/generated/app-origin.ts`，只在 `pnpm storybook` 启动时生成，
 * 并且整目录 gitignore（端口不同 checkout 不同，写死必然错 —— 那是对的）。同时
 * `tsconfig.json` 的 include 显式列着这个点目录（点目录不在 glob 的默认展开范围里，
 * 不列就是 tsc 与 eslint 的双重盲区 —— 那也是对的，且那一头已由
 * `tests/storybook-data-sources.test.ts` 判着，本文件不重复）。
 *
 * 两个各自正确的决定叠起来 = **没跑过 storybook 的检出两个门槛一起红**：
 * `pnpm typecheck` 报 `Cannot find module './generated/app-origin'`，`pnpm test` 报
 * 「sample-landscape.svg 不在 .storybook/assets/」（media 值源要指向磁盘上的真图，
 * 那三张图同样是现生成、不入库）。两条都指向谁都没碰过的文件，而 tsc 与用例正是
 * 钩子的 A 组与 C 组 —— **拦住的是从这份基线分出去的每一次提交**。
 * 落库时全绿，因为作者的机器上那些文件在 —— 与台账 E12 同族（在别人的机器上绿），
 * 区别是这次红的不是用例，是**门槛本体**。
 *
 * 所以这里判的是**保证链**，不是「文件此刻在不在」：
 *   ① 消费方 import 的导出名 == 生成器实际产出的导出名（分叉就是下一次 typecheck 红）；
 *   ② 有一个任何检出都会跑到的入口负责把它补上（`postinstall` 的唯一入口内部）；
 *   ③ 生成物仍然不入库（② 的意义完全取决于这一条 —— 哪天改成入库，② 就该撤）。
 * 三条都是机器无关的：在干净检出上跑也是同样的结论，不需要先跑过 storybook。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { writeStorybookAppOrigin } from "../scripts/storybook-assets.mjs";
import { stripComments } from "./helpers/strip-comments";

const ROOT = process.cwd();
const GENERATED_REL = path.join(".storybook", "generated", "app-origin.ts");
const CONSUMER_REL = ".storybook/data-sources.tsx";
const ENTRY_REL = "scripts/install-git-hooks.mjs";
/** 生成物的模块标识符（消费方就是这么写 import 说明符的）。 */
const MODULE_SPEC = "./generated/app-origin";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** `import { A, B } from "<spec>"` 的大名集合（剥注释，不带别名）。 */
function importedNames(source: string, spec: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  )) {
    if (match[2] !== spec) continue;
    for (const part of String(match[1]).split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) names.push(name);
    }
  }
  return names.sort();
}

/** 一份模块源码里的 `export const NAME` 集合。 */
function exportedNames(source: string): string[] {
  return [...source.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)/g)]
    .map((m) => m[1])
    .filter((n): n is string => Boolean(n))
    .sort();
}

/** 真跑一次生成器到临时目录，返回产出的源码。
 *
 *  不 mock：这条判据要核的是「生成器实际写出什么」与「消费方实际要什么」是否同形，
 *  桩掉生成器等于拿自己写的期望去证明自己。 */
function generateIntoTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storybook-app-origin-"));
  try {
    const outFile = path.join(dir, GENERATED_REL);
    writeStorybookAppOrigin(dir, outFile);
    return fs.readFileSync(outFile, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("Storybook 那份「类型程序读得到、磁盘上不入库」的输入：保证链三环", () => {
  it("① 消费方要的导出名与生成器给的是同一组", () => {
    const wanted = importedNames(
      stripComments(read(CONSUMER_REL)),
      MODULE_SPEC,
    );
    // 扫描面非空：消费方没 import 时，下面那条相等断言会在空集上假绿
    expect(wanted.length).toBeGreaterThan(0);
    expect(exportedNames(generateIntoTemp())).toEqual(wanted);
  });

  it("② postinstall 的唯一入口负责把它补上，且这一步失败只提示", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    // 契约：postinstall 必须逐字以那一条开头、禁止 `&&`（launcher-core 的
    // checkPostinstall() 守的就是这条，#636 的形态），所以「补输入」只能并进入口内部。
    expect(String(pkg.scripts?.postinstall)).toBe(
      "node scripts/install-git-hooks.mjs",
    );
    const entry = stripComments(read(ENTRY_REL));
    // 动态 import 的那条说明符（prettier 会按行宽折行，所以按形状判而不是整行字面量）
    expect(entry).toMatch(
      /await import\(\s*["']\.\/storybook-assets\.mjs["']\s*\)/,
    );
    expect(entry).toMatch(/\bwriteStorybookAppOrigin\s*\(/);
    // 同一族的第二格：media 值源要指向磁盘上的真图，那份目录也是现生成且不入库的
    //（少它红的是 `pnpm test`，少上面那句红的是 `pnpm typecheck` —— 两个门槛同一条链）
    expect(entry).toMatch(/\bensureStorybookAssets\s*\(/);
    // 调用必须在 try 里、且 catch 说得出「这一步没做成怎么办」：
    // 它是开发体验的兜底，绝不能变成 `pnpm install` 的新失败点。
    expect(entry).toMatch(
      /try\s*\{[\s\S]*?\bwriteStorybookAppOrigin\s*\([\s\S]*?\}\s*catch/,
    );
    expect(entry).toContain("警告：Storybook");
  });

  it("③ 生成物仍然不入库 —— ② 的意义完全取决于这一条", () => {
    const ignore = read(".gitignore")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    expect(ignore).toContain("/.storybook/generated/");
    expect(ignore).toContain("/.storybook/assets/");
    // 也不许真被提交进来：那份值是**这台机器**按检出路径算出的端口，入库等于把
    // 别人的工作台指向一个不存在的端口 —— 静默的错，比红更难查。
    expect(
      execFileSync("git", ["ls-files", "--", ".storybook/generated"], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim(),
    ).toBe("");
  });

  it("判据自身可反证：少一个导出名、注掉那句调用都要红", () => {
    // 生成器漏掉 `APP_DEV_PORT_SOURCE` 时的形状：与消费方要的三件不齐
    const partial = [
      "export const APP_DEV_PORT = 3734;",
      'export const APP_DEV_ORIGIN = "http://127.0.0.1:3734";',
    ].join("\n");
    expect(exportedNames(partial)).not.toEqual(
      importedNames(stripComments(read(CONSUMER_REL)), MODULE_SPEC),
    );
    // 注掉调用那一行：剥注释后**调用形态**就该消失（② 判的是调用，不是文件名、
    // 也不是解构里那个同名标识符 —— 两者都带名字，只有调用带括号）。
    const commented = stripComments(
      read(ENTRY_REL).replace(
        "= writeStorybookAppOrigin(",
        "= 0;\n  // writeStorybookAppOrigin(",
      ),
    );
    expect(commented).not.toMatch(/\bwriteStorybookAppOrigin\s*\(/);
    // 而真文件必须有这句 —— 否则上面那条反证就成了「两边都不匹配」的永真。
    expect(stripComments(read(ENTRY_REL))).toMatch(
      /\bwriteStorybookAppOrigin\s*\(/,
    );
  });
});
