/**
 * 「被类型检查的那份源码，不该 import 一个不入库的生成件」—— 这条链的判据
 *（台账 E15 / ISSUE #1409）。
 *
 * 事故形状：`b9cbd762` 把 Storybook 的注入层接上了按检出路径现算的应用端口，
 * 产物落 `.storybook/generated/app-origin.ts`（后来改成 `.json`），只在
 * `pnpm storybook` 启动时生成，并且整目录 gitignore（端口不同 checkout 不同，
 * 写死必然错 —— 那是对的）。同时 `tsconfig.json` 的 include 显式列着这个点目录
 *（点目录不在 glob 的默认展开范围里，不列就是 tsc 与 eslint 的双重盲区 ——
 * 那也是对的）。两个各自正确的决定叠起来 = **没跑过 `pnpm storybook` 的检出
 * `tsc --noEmit` 必红**，而 tsc 正是提交门槛的 A 组 —— 拦住的是从这份基线分出去
 * 的**每一次**提交。
 *
 * **`exclude` 治不了这个病（实测，见下面「判据自身可反证」那组）**：它只过滤
 * include 的 glob，拦不住「作为 import 目标被拉进程序」的文件。最小复现 ——
 * include 那一对 `.storybook` 通配、exclude `.storybook/generated`，入口里照旧
 * `import` 那个模块，文件缺了照样 TS2307。所以修法只能是**让被引方不依赖生成件**。
 *
 * 判的是**保证链**，不是「文件此刻在不在」（后者机器相关，在干净检出上必红）：
 *   ① 被引方（注入层 / preview / main）**不 import 生成件**，且读到的类型来自
 *      入库的 `app-origin-defaults.ts`；
 *   ② 生成件的字段名与那份入库类型**逐字段对齐**（少了/改名了就是静默回落，
 *      画布上显示的端口悄悄变成缺省值）；
 *   ③ 生成物仍然不入库（端口是**这台机器**按检出路径算的，入库等于把别人的
 *      工作台指向一个不存在的端口 —— 静默的错，比红更难查）；
 *   ④ 「缺了生成件」这条路上 **tsc 真的退 0** —— 拿真检出复量，不靠读配置下结论。
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readAppOrigin } from "../.storybook/app-origin-reader";
import { APP_ORIGIN_DEFAULTS } from "../.storybook/app-origin-defaults";
import { writeStorybookAppOrigin } from "../scripts/storybook-assets.mjs";
import { stripComments } from "./helpers/strip-comments";

const ROOT = process.cwd();
const GENERATED_DIR_REL = path.join(".storybook", "generated");
const GENERATED_REL = path.join(GENERATED_DIR_REL, "app-origin.json");
const MAIN_REL = ".storybook/main.ts";
const PREVIEW_REL = ".storybook/preview.tsx";
const CONSUMER_REL = ".storybook/data-sources.tsx";
const ENTRY_REL = "scripts/install-git-hooks.mjs";
/** 生成件的**模块标识符**（原先是 TS 模块，那正是 Ts2307 的来源）。 */
const OLD_MODULE_SPEC = "./generated/app-origin";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** 一份源码里的静态 `import … from "<spec>"` / `require(<字面量>)`（剥注释后）。 */
function staticSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specs: string[] = [];
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (m[1]) specs.push(m[1]);
  }
  for (const m of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    if (m[1]) specs.push(m[1]);
  }
  return specs;
}

describe("Storybook 那份「类型程序读得到、磁盘上不入库」的输入：四条判据", () => {
  it("① 被引方都不 import 生成件 —— 那正是 TS2307 的来源", () => {
    /* 三处都可能去读它：注入层（值源）、preview（缺省 origin 与旋钮）、
       main（把值注入浏览器 bundle）。**一处都不许静态 import** —— 生成件不在
       检出里，静态说明符会让类型程序去解析一个不存在的文件。 */
    const offenders: string[] = [];
    for (const rel of [CONSUMER_REL, PREVIEW_REL, MAIN_REL]) {
      for (const spec of staticSpecifiers(read(rel))) {
        if (spec === OLD_MODULE_SPEC || spec.includes("generated/app-origin")) {
          offenders.push(`${rel} → ${spec}`);
        }
      }
    }
    expect(
      offenders,
      "这些文件静态 import 了生成件 —— 没跑过 `pnpm storybook` 的检出上 tsc 会报 TS2307" +
        "（而 tsc 是钩子 A 组：拦的是从这份基线分出去的每一次提交）",
    ).toEqual([]);
    /* 反向：注入层确实从**入库的**那份读类型（不然上面那条会因为「谁都没引」而空转）。 */
    expect(staticSpecifiers(read(CONSUMER_REL))).toContain(
      "./app-origin-defaults",
    );
    expect(staticSpecifiers(read(PREVIEW_REL))).toContain(
      "./app-origin-reader",
    );
    expect(staticSpecifiers(read(MAIN_REL))).toContain("./app-origin-reader");
  });

  it("② 生成件的字段名与入库类型逐字段对齐（改名 = 静默回落成缺省端口）", () => {
    /* 真跑一次生成器到临时目录，解析它的 JSON —— 不 mock：
       桩掉生成器等于拿自己写的期望去证明自己。 */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storybook-app-origin-"));
    let payload: Record<string, unknown>;
    try {
      const outFile = path.join(dir, GENERATED_REL);
      writeStorybookAppOrigin(dir, outFile);
      payload = JSON.parse(fs.readFileSync(outFile, "utf8")) as Record<
        string,
        unknown
      >;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // 扫描面非空：生成器什么都没写时，下面那条相等断言会在空集上假绿。
    const expected = Object.keys(APP_ORIGIN_DEFAULTS).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(Object.keys(payload).sort()).toEqual(expected);
    // 类型也要对得上：`APP_DEV_PORT` 不是数字时 reader 会整份回落到缺省值。
    for (const [key, value] of Object.entries(payload)) {
      expect(typeof value, `${key} 的类型与入库缺省值不一致`).toBe(
        typeof (APP_ORIGIN_DEFAULTS as Record<string, unknown>)[key],
      );
    }
  });

  it("③ 生成物仍然不入库 —— 端口是这台机器算的，入库等于指向别人的端口", () => {
    const ignore = read(".gitignore")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    expect(ignore).toContain("/.storybook/generated/");
    expect(ignore).toContain("/.storybook/assets/");
    expect(
      execFileSync("git", ["ls-files", "--", GENERATED_DIR_REL], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim(),
    ).toBe("");
  });

  it(
    "④ 缺了生成件时 tsc 真的退 0 —— 拿真检出复量，不靠读配置下结论",
    /* 原生 TS7 全仓 --noEmit 跑两遍（缺生成件一遍 + 在位一遍），独立跑 ~9s、
     * 钩子组 C 的降配 forks 下实测 ~32s —— 贴着全局 30s 上限，给足余量
     * （与 check-reformat-only 的慢 exec 用例同一档）。 */
    { timeout: 120_000 },
    () => {
      /* 这一条判的是**结果**：把生成件挪走（= 新检出的形态），tsc 必须退 0。
       不读 `exclude` 下结论 —— 实测那条路根本不管用（见下面那组反证）。 */
      const tsc = resolveTscBin();
      expect(
        tsc,
        "解不出任何可用的 tsc 可执行（@typescript/native / typescript 两个形态都试过了）",
      ).not.toBeNull();
      const generatedDir = path.join(ROOT, GENERATED_DIR_REL);
      const stash = path.join(
        os.tmpdir(),
        `sb-generated-${String(process.pid)}`,
      );
      const existed = fs.existsSync(generatedDir);
      try {
        if (existed) fs.renameSync(generatedDir, stash);
        const without = tsc!.run(["--noEmit"]);
        expect(
          without.status,
          `没有 ${GENERATED_REL} 时 tsc 必须退 0（新检出的形态），实际输出：\n${without.output}`,
        ).toBe(0);
      } finally {
        if (existed) {
          fs.rmSync(generatedDir, { recursive: true, force: true });
          fs.renameSync(stash, generatedDir);
        }
      }
      // 生成件在位时也得是绿的（这一条顺带证明上面那次不是「tsc 根本没跑」）。
      expect(tsc!.run(["--noEmit"]).status).toBe(0);
    },
  );

  it("判据自身可反证：静态 import 生成件会让 tsc 报 TS2307", () => {
    /* 这条反证是 ① 与 ④ 的**前提**：如果「静态 import 一个不存在的模块」并不会
       让 tsc 红，那么 ①（不许 import）与 ④（缺件也得绿）就都是空转的判据。
       在临时目录里搭一个最小复现跑真 tsc，不动本仓库。 */
    const tsc = resolveTscBin();
    expect(tsc, "解不出可用的 tsc，这条反证无法成立").not.toBeNull();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsc2307-"));
    try {
      fs.mkdirSync(path.join(dir, ".storybook"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".storybook", "entry.ts"),
        `import { X } from "./generated/app-origin";\nexport const Y: number = X;\n`,
      );
      fs.writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: { noEmit: true, strict: true },
            // 点目录不在 glob 的默认展开范围里，所以像本仓库的 tsconfig 一样
            // 显式列出来（这正是「文件进了检查面」那一半的成因）。
            include: [".storybook/**/*.ts", ".storybook/**/*.tsx"],
            // exclude 也列上：**实测它拦不住 import 目标**（这正是本病的根因，
            // 也是「用 exclude 修」那条路被否掉的依据）。
            exclude: [".storybook/generated"],
          },
          null,
          2,
        ),
      );
      const r = tsc!.runIn(dir, ["--noEmit"]);
      expect(r.output).toContain("TS2307");
      expect(r.status, "TS2307 应当让 tsc 非零退出").not.toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("postinstall 的唯一入口仍然把它补上，且这一步失败只提示", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    // 契约：postinstall 必须逐字是那一条、禁止 `&&`（launcher-core 的
    // checkPostinstall() 守的就是它，#636 的形态），所以「补输入」只能并进入口内部。
    expect(String(pkg.scripts?.postinstall)).toBe(
      "node scripts/install-git-hooks.mjs",
    );
    const entry = stripComments(read(ENTRY_REL));
    // 动态 import 的那条说明符（prettier 会按行宽折行，所以按形状判而不是整行字面量）
    expect(entry).toMatch(
      /await import\(\s*["']\.\/storybook-assets\.mjs["']\s*\)/,
    );
    expect(entry).toMatch(/\bwriteStorybookAppOrigin\s*\(/);
    // 同一族的第二格：media 值源要指向磁盘上的真图，那份目录也是现生成且不入库的。
    expect(entry).toMatch(/\bensureStorybookAssets\s*\(/);
    // 调用必须在 try 里、且 catch 说得出「这一步没做成怎么办」：
    // 它是开发体验的兜底，绝不能变成 `pnpm install` 的新失败点。
    expect(entry).toMatch(
      /try\s*\{[\s\S]*?\bwriteStorybookAppOrigin\s*\([\s\S]*?\}\s*catch/,
    );
    expect(entry).toContain("警告：Storybook");
  });

  it("读不到生成件时 reader 交回入库的缺省值（不是抛错、也不是空值）", () => {
    /* 这一条不依赖磁盘上有没有生成件：`env` 里那三个键由 `main.ts` 的 `env()`
       在编译期注入，`readAppOrigin` 只解释它 —— 把 `process.env` 临时换成缺键
       的形状，它必须给出缺省值。 */
    const keys = [
      "SB_APP_DEV_PORT",
      "SB_APP_DEV_ORIGIN",
      "SB_APP_DEV_PORT_SOURCE",
    ];
    const saved = new Map(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) delete process.env[k];
      expect(readAppOrigin()).toEqual(APP_ORIGIN_DEFAULTS);
      // 形状不对（端口不是数字）同样走缺省 —— 半份数据比没有更危险。
      process.env.SB_APP_DEV_PORT = "not-a-port";
      process.env.SB_APP_DEV_ORIGIN = "http://127.0.0.1:1";
      process.env.SB_APP_DEV_PORT_SOURCE = "derived";
      expect(readAppOrigin()).toEqual(APP_ORIGIN_DEFAULTS);
      // 齐了就用它。
      process.env.SB_APP_DEV_PORT = "3311";
      expect(readAppOrigin()).toMatchObject({
        APP_DEV_PORT: 3311,
        APP_DEV_ORIGIN: "http://127.0.0.1:1",
        APP_DEV_PORT_SOURCE: "derived",
      });
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

/** 判据要真跑一次 tsc：从依赖里解出可执行文件，不写死 `node_modules/.bin/tsc`。
 *
 *  pnpm 布局下两个形态各自带着自己的 bin 名（`@typescript/native` 的 `tsc`、
 *  `typescript`（实为 `@typescript/typescript6`）的 `tsc6`），顶层 `node_modules/`
 *  下只是链接 —— 按包名 + `bin` 字段解，别按路径猜。 */
function resolveTscBin(): {
  run: (args: string[]) => { status: number | null; output: string };
  runIn: (
    cwd: string,
    args: string[],
  ) => { status: number | null; output: string };
} | null {
  for (const [pkg, binName] of [
    ["@typescript/native", "tsc"],
    ["typescript", "tsc6"],
  ] as const) {
    const pkgJson = path.join(ROOT, "node_modules", pkg, "package.json");
    let bin: string | undefined;
    try {
      const pkgData = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as {
        bin?: Record<string, string> | string;
      };
      bin =
        typeof pkgData.bin === "string" ? pkgData.bin : pkgData.bin?.[binName];
    } catch {
      continue;
    }
    if (!bin) continue;
    const file = path.resolve(path.dirname(pkgJson), bin);
    if (!fs.existsSync(file)) continue;
    const runIn = (cwd: string, args: string[]) => {
      /* bin 是带 shebang 的 node 脚本垫片 —— Windows 的 spawnSync 不认
       * shebang，直接 exec 会 ENOENT（本机实测），必须经 node 启动。 */
      const r = spawnSync(process.execPath, [file, ...args], {
        cwd,
        encoding: "utf8",
      });
      return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    return { run: (args) => runIn(ROOT, args), runIn };
  }
  return null;
}
