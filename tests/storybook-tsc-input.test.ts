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
 *
 * ## ④ 的输入面：两样现生成、不入库的东西，不是一样
 *
 * 同族病的第二个实例（ISSUE 的复算读数）：新检出上除了 `.storybook/generated/`，
 * 还有一份**根级**的现生成件 `next-env.d.ts`（`next dev` / `next build` 由
 * `next/dist/lib/typescript/writeAppTypeDeclarations` 写，整文件 gitignore）。
 * 它那两行 `/// <reference types="next" />` / `next/image-types/global` 才是把
 * `node_modules/next/types/global.d.ts`（`declare module '*.css' {}` 在那里）拉进
 * 类型程序的那条链 —— 缺了它，`preview.tsx` 的 `import "../src/app/globals.css"`
 * 就是 **TS2882**。
 *
 * **`.next/dev/types/**` 不是必需的那一样（实测，别按直觉把它一起挪）**：
 * `next-env.d.ts` 尾部那两条 `import "./.next/..."` 悬空时 tsc 一声不响
 *（缺生成目录不报错，`skipLibCheck` 下更静），所以四种组合里只有
 * 「`next-env.d.ts` 不在」会红。把它一并纳入暂存面只会平白多一个
 * 「并发的 tsc / eslint 正在遍历它」的风险面 —— 正是下面 ④ 里那条
 * 「目录必须还在」注释记的同一个坑。
 *
 * 于是 ④ 的形态不是「多挪一样」，而是**别拿自己保证不了的生成物当地基**：
 * 它用 Next **自己的导出**现造一份 `next-env.d.ts` 到暂存目录、窄 `include` 指
 * 过去 —— 与 #1409 的修法（让被引方不依赖生成件）是同一条道理，只是这次
 * 「被引方」是判据自己。好处是零手抄声明：Next 哪天改了文件头，这里跟着变。
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

/**
 * 剥掉说明符末尾的 `.ts` / `.tsx`（也含 `.mts` / `.cts`），让「引的是不是那个
 * 模块」这件事与**后缀写法**无关。
 *
 * 为什么需要它：`.storybook/**` 的相对 import 一律写全后缀（见
 * `tests/storybook-config.test.ts` 的「相对 import 带后缀」那条判据 —— Storybook
 * 的 Node loader 见无后缀说明符会打 deprecation）。而本文件要判的是接线关系，
 * 不该顺带把后缀写法也钉进来：否则修一次告警就得同步改这里的字面量，两处事实
 * 源反而更容易漂。带后缀是**写法**、剥掉后缀才是**指向**，这里比的是后者。
 */
function withoutModuleExt(spec: string): string {
  return spec.replace(/\.m?tsx?$/, "");
}

/**
 * ④ 用的「窄项目」：`extends` 仓库真那份 tsconfig（`paths` / `jsx` / `strict` 全部
 * 继承，不重抄一份 —— 重抄就是第二个事实来源），只把 `include` 收到 `.storybook/**`
 * 与它需要的环境声明上。
 *
 * 为什么收这一层就够：本条判的是「没有生成件的那个形态会不会让类型程序报错」，
 * 而报错只可能发生在**解析得到那个模块的文件**身上 —— 也就是 `.storybook` 那三个
 * 被引方（① 点名的就是它们）。全仓那一遍的活儿有组 A 在同一趟提交里干。
 *
 * **环境声明这份 include 指向 ④ 自己现造的那一份**（见 provisionNextEnv），不是仓库
 * 根那份 `next-env.d.ts` —— 后者在干净检出上不存在，指过去就是把判据的地基交给一个
 * 生成物（正是本节要判的病）。`.next/dev/types/**` 不进 include：实测它不是必需的那
 * 一样（见文件头），而把它拉进来等于给并发的 tsc / eslint 多一个会被搬走的遍历目标。
 * `types: []` 关掉「按 typeRoots 自动把全部 @types 拉进来」这层噪声 —— 本判据只关心
 * `.storybook` 三个被引方解析不解析得到它们的 import。
 *
 * **`exclude` 必须覆写成「仓库那份去掉 `node_modules`」**（实测踩过）：继承来的那份
 * `exclude` 列着 `node_modules`，而 ④ 现造的那份环境声明就落在 `node_modules/.cache/`
 * 下 —— 于是它被自己的 `exclude` 挡在程序外，`--listFilesOnly` 里没有它，`include`
 * 那一行成了摆设。这不是「配置写错了」而是两个正确决定（暂存点选 `node_modules/.cache`
 * 以免被并发遍历；仓库 `exclude` 掉 `node_modules` 以免扫依赖）叠起来的必然结果，
 * 所以在这里显式解开：`include` 是**逐条显式**的（三条通配 + 一个文件），
 * 去掉 `node_modules` 不会把依赖图拉进来（实测 2425 个文件里 2224 份是 `next` 等
 * 依赖的 `.d.ts`，那是 `reference types="next"` 本来就该带进来的，与去不去掉无关）。
 *
 * `incremental: false` 是必须的：真配置开着 incremental，缓存命中时这一跑可以什么都不
 * 检查就退 0 —— 判据会静默空转。宁可每次都真算。
 */
function narrowTsconfigText(
  root: string,
  envDts: string,
  inheritedExclude: string[],
): string {
  const abs = (p: string) => path.join(root, p).split(path.sep).join("/");
  return JSON.stringify(
    {
      extends: abs("tsconfig.json"),
      include: [
        envDts.split(path.sep).join("/"),
        abs(".storybook/**/*.ts"),
        abs(".storybook/**/*.tsx"),
      ],
      exclude: inheritedExclude.filter((entry) => entry !== "node_modules"),
      compilerOptions: { incremental: false, types: [] },
    },
    null,
    2,
  );
}

/**
 * 用 **Next 自己的导出**现造一份 `next-env.d.ts`（按包名解析内部模块，不写死
 * `node_modules/next/dist/...` 的物理路径 —— pnpm 布局下那是一条会随版本变的链接名）。
 *
 * 为什么不手抄那两三行：手抄就是第二个事实来源，Next 改文件头（加/删一条 reference）
 * 时这里静默过期，而判据会继续「绿」在一个已经不算新检出形态的输入上。
 *
 * `distDir` 传相对路径：那个 writer 是把 `distDir` 拼成**相对路径字符串**写进 import 的
 * （实测传绝对路径会写出 `import ".//abs/path/..."` 这种畸形说明符）。而因此产生的
 * 悬空 import 正是我们要的形态 —— 干净检出上 `.next` 本来就不存在，而它悬空时 tsc
 * 不报错（见文件头）。
 */
async function provisionNextEnv(outDir: string): Promise<string> {
  const { writeAppTypeDeclarations } = (await import(
    "next/dist/lib/typescript/writeAppTypeDeclarations.js"
  )) as {
    writeAppTypeDeclarations: (options: {
      baseDir: string;
      distDir: string;
      imageImportsEnabled: boolean;
      hasPagesDir: boolean;
      hasAppDir: boolean;
      strictRouteTypes: boolean;
      typedRoutes: boolean;
    }) => Promise<void>;
  };
  fs.mkdirSync(outDir, { recursive: true });
  await writeAppTypeDeclarations({
    baseDir: outDir,
    distDir: ".next/dev",
    imageImportsEnabled: true,
    hasPagesDir: false,
    hasAppDir: true,
    strictRouteTypes: false,
    typedRoutes: false,
  });
  const file = path.join(outDir, "next-env.d.ts");
  expect(
    fs.existsSync(file),
    "Next 自己的 writeAppTypeDeclarations 没落成 next-env.d.ts —— 这条判据的输入造不出来",
  ).toBe(true);
  return file;
}

/**
 * 把窄配置 + 它要的环境声明落到**仓库内**的暂存目录，返回可用的路径。
 *
 * 暂存点落 `node_modules/.cache` 的两个理由与 ④ 挪生成件那处同源（见
 * generatedStashFile 的注释）：git 不看、类型程序与 eslint 都不展开；且与仓库同卷
 * （Windows 上跨卷 rename / 写入直接失败）。这里多一条：`extends` 用的 `tsconfig.json`
 * 是**绝对路径**，配置本身放哪儿都不影响它继承到什么。
 *
 * `os.tmpdir()` 在这里同样不行 —— 那次事故（详见 generatedStashFile）已经把
 * 「仓库内的输入 + 仓库外的临时目录」这条组合判死过一回。
 */
async function writeNarrowTsconfig(): Promise<{
  dir: string;
  cfg: string;
  envDts: string;
}> {
  const dir = fs.mkdtempSync(
    path.join(ROOT, "node_modules", ".cache", "sb-narrow-tsc-"),
  );
  const envDts = await provisionNextEnv(path.join(dir, "env"));
  const cfg = path.join(dir, "tsconfig.json");
  fs.writeFileSync(cfg, narrowTsconfigText(ROOT, envDts, repoExclude()));
  return { dir, cfg, envDts };
}

/**
 * 仓库真那份 `tsconfig.json` 的 `exclude`，读出来（不重抄一份 —— 重抄就是第二个
 * 事实来源，而这份清单本来就是「只许减不许加」的语境，抄窄了会让窄项目悄悄多扫）。
 *
 * 用 `typescript` 自己的解析器而不是手剥注释 + `JSON.parse`：真配置里既有块注释也有
 * 行注释与尾逗号，手搓的剥离器是第三个事实来源。用 `tsc6` 那份包（与 `resolveTscBin`
 * 解出的可执行同源）—— 拿到的是**解析后**的清单，`extends` 链也一并展开。
 */
function repoExclude(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ts = require("typescript") as {
    readConfigFile: (
      file: string,
      read: (p: string) => string | undefined,
    ) => { config?: { exclude?: string[] } };
  };
  const parsed = ts.readConfigFile("tsconfig.json", (f) =>
    fs.readFileSync(f, "utf8"),
  );
  const exclude = parsed.config?.exclude;
  expect(
    Array.isArray(exclude) && exclude.length > 0,
    "读不出仓库 tsconfig.json 的 exclude —— 窄项目无法据此解开 node_modules 这一条",
  ).toBe(true);
  /* 上面那条断言已经把 `undefined` / 非数组挡掉了，这里用 `!` 表达「到此已非空」
     （而不是再写一次 `as` —— 那是同一件事的更啰嗦说法）。 */
  return exclude!;
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
    /* 反向：注入层确实从**入库的**那份读类型（不然上面那条会因为「谁都没引」而空转）。
       比的是剥掉后缀的说明符（见 withoutModuleExt）：要判的是「引的是不是那个模块」，
       后缀写法由 `tests/storybook-config.test.ts` 那条判据单独守。 */
    expect(
      staticSpecifiers(read(CONSUMER_REL)).map(withoutModuleExt),
    ).toContain("./app-origin-defaults");
    expect(staticSpecifiers(read(PREVIEW_REL)).map(withoutModuleExt)).toContain(
      "./app-origin-reader",
    );
    expect(staticSpecifiers(read(MAIN_REL)).map(withoutModuleExt)).toContain(
      "./app-origin-reader",
    );
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
    /* 本机实测（空闲机器、同一份输入，连跑三次全仓 `tsc --noEmit`）：
     * 20.7s / 26.7s / 131.9s —— 一遍全仓编译自己就有 6 倍的抖动，进 pre-commit
     * 组 C 的并发池子（--maxWorkers=4，且 A/B/D 同时在跑）实测 181–182s，
     * 120s 预算必爆；串行 8/8 绿 ⇒ 争用假红（定性手法见规范 §11.13）。
     * 修法按 §11.13 的口径走「精确化判据」而不是再抬预算：编译面从全仓收到
     * 窄项目（见 narrowTsconfigText），实测 6.9s；预算留 120s 不动，
     * 现在它离天花板很远。
     *
     * 输入面多一样（`next-env.d.ts`，见文件头）之后，这一条的时间还要算上
     * `provisionNextEnv` 现造那份声明（约十几毫秒的 fs 写）—— 无关紧要。 */
    { timeout: 120_000 },
    async () => {
      /* 这一条判的是**结果**：把生成件挪走（= 新检出的形态），tsc 必须退 0。
       不读 `exclude` 下结论 —— 实测那条路根本不管用（见下面那组反证）。 */
      const tsc = resolveTscBin();
      expect(
        tsc,
        "解不出任何可用的 tsc 可执行（@typescript/native / typescript 两个形态都试过了）",
      ).not.toBeNull();
      const generatedDir = path.join(ROOT, GENERATED_DIR_REL);
      const generatedFile = path.join(ROOT, GENERATED_REL);
      const stash = generatedStashFile(ROOT, process.pid);
      const existed = fs.existsSync(generatedFile);
      if (existed) {
        /* 先确认「挪得动」再往下跑：挪不动就当场说清是暂存点的问题，别由后面
           那句还原替它顶罪（跨卷时真因是 EXDEV，报出来的却是 ENOENT）。 */
        fs.mkdirSync(path.dirname(stash), { recursive: true });
        fs.renameSync(generatedFile, stash);
        expect(
          fs.existsSync(stash) && !fs.existsSync(generatedFile),
          `生成件没能挪进 ${stash} —— 暂存点必须与仓库同卷（见 generatedStashFile）`,
        ).toBe(true);
        /* 挪的只是那个 json，**目录必须还在**：pre-commit 各组是并发跑的
           （`wall ≈ max(各组)`），组 A 的 tsc 与组 B 的 eslint 都在遍历
           `.storybook/**`。目录在它们遍历中途消失，撞上是 `ENOENT: scandir
           '.storybook\generated'` —— 报错既不含本条判据、也不含真凶，
           只会让「组 B 失败」看起来像别人写坏了（实测崩过一回）。
           空目录不影响任何人：json 不是 tsc / eslint 的展开目标。 */
        expect(
          fs.existsSync(generatedDir),
          "④ 只许挪走那个 json，不许把 .storybook/generated 目录一起搬走 —— 同批并发的 tsc / eslint 正在遍历这个目录",
        ).toBe(true);
      }
      try {
        const { dir, cfg } = await writeNarrowTsconfig();
        try {
          const without = tsc!.run(["-p", cfg, "--noEmit"]);
          expect(
            without.status,
            `没有 ${GENERATED_REL} 时类型程序必须退 0（新检出的形态），实际输出：\n${without.output}`,
          ).toBe(0);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } finally {
        if (existed) restoreGeneratedFile(generatedFile, stash);
      }
      /* 活性证明（≈0.3s）：同一个可执行文件报得出版本号 —— 上面断言的是退出码，
         万一解出来的是个空壳，`--version` 也会红。 */
      const alive = tsc!.run(["--version"]);
      expect(
        alive.status,
        `tsc --version 都退非 0，上面那次「退 0」不可信：\n${alive.output}`,
      ).toBe(0);
      expect(
        alive.output.trim().length,
        "--version 输出为空 —— 那不是真的跑起来了",
      ).toBeGreaterThan(0);
    },
  );

  it(
    "④ 的窄项目不是空转：三个被引方与那份环境声明真的在类型程序里",
    /* 把编译面从全仓收到 .storybook 之后，新出现的失效方式是「窄配置根本没把
       被引方纳进来」—— 那样 ④ 会永远绿，而这正是它唯一要判的东西。所以判据换形
       时必须补一条在场证明：拿 `--listFilesOnly` 把类型程序的文件清单打出来，
       ① 点名的三个被引方一个都不许缺。这条与 ④ 用同一份配置，形状不会分叉。

       现在多一个必须点名的：**④ 自己现造的那份 `next-env.d.ts`**。它是 ④ 的地基
       （缺了它，`preview.tsx` 的 CSS import 就是 TS2882），而它的产生路径要经过
       Next 的一个内部模块 —— 那条路径哪天断了、或 `include` 里的路径形态写错了，
       ④ 会**先红**（这比静默更安全）。但反过来也要挡住：`provisionNextEnv` 里那条
       `existsSync` 只证明文件落了盘，不证明它在**程序**里 —— 清单里点它的名，
       这条判据才算把「地基在场」判住。 */
    { timeout: 120_000 },
    async () => {
      const tsc = resolveTscBin();
      expect(tsc, "解不出可用的 tsc，这条无法成立").not.toBeNull();
      const { dir, cfg, envDts } = await writeNarrowTsconfig();
      try {
        const listed = tsc!.run(["-p", cfg, "--noEmit", "--listFilesOnly"]);
        expect(
          listed.status,
          `--listFilesOnly 都退非 0，配置本身有问题：\n${listed.output}`,
        ).toBe(0);
        const norm = listed.output.split("\\").join("/");
        for (const rel of [CONSUMER_REL, PREVIEW_REL, MAIN_REL]) {
          expect(
            norm.includes(rel.split("\\").join("/")),
            `${rel} 不在窄类型的文件清单里 —— ④ 那一跑是空转`,
          ).toBe(true);
        }
        const envRel = path.relative(ROOT, envDts).split(path.sep).join("/");
        expect(
          norm.includes(envRel),
          `④ 现造的那份环境声明（${envRel}）不在窄类型的文件清单里 —— 地基没进程序，④ 是空转`,
        ).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("④ 的暂存点形状：仓库内、同卷、不入库，且挪的是文件不是目录", () => {
    /* 这条是 ④ 的前提，不是装饰。两处约束各自对应一次真实事故：
       · 落回 `os.tmpdir()` ⇒ 仓库与临时目录不同卷的机器上 rename 直接 EXDEV，
         「挪走」从没成功，报错却指向还原（ENOENT），顺带把真目录删了；
       · 挪整目录 ⇒ 并发的 tsc / eslint 遍历到一半撞 ENOENT scandir，红在别的组上。
       判形状而不判当前机器的卷：单卷机器上按卷判据永远绿，只有按位置判才能拦住回潮。 */
    const stash = generatedStashFile(ROOT, 4242);
    expect(path.relative(ROOT, stash)).not.toMatch(/^\.\./);
    expect(
      stash.startsWith(path.join(ROOT, "node_modules") + path.sep),
      "暂存点只在 node_modules 下面：那里 git 不看、类型程序与 eslint 也不展开",
    ).toBe(true);
    expect(
      path.parse(stash).root,
      "暂存点与仓库必须同一卷 —— 跨卷 rename 在 Windows 直接失败",
    ).toBe(path.parse(ROOT).root);
    expect(
      path.basename(stash),
      "挪的必须是那个 json 本身；把目录搬走会让同批并发的遍历撞 ENOENT",
    ).toBe(path.basename(GENERATED_REL));
    /* `git check-ignore -q` 的退出码就是判据（0 = 被忽略）。用 spawnSync 而不是
       execFileSync：后者在非零时抛的是 git 的报错，读起来指不到「暂存点会入库」这件事。 */
    expect(
      spawnSync("git", ["check-ignore", "-q", "--", stash], {
        cwd: ROOT,
      }).status,
      "暂存点得被 gitignore 盖住，否则一次判据能在仓库里留个未跟踪目录",
    ).toBe(0);
  });

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

  it("判据自身可反证：缺那份环境声明会让 tsc 报 TS2882", () => {
    /* 这条反证是本节新增输入面的**前提**，形状与上面那条 TS2307 的同源：
       如果「缺了 `next-env.d.ts` 那两行 reference」并不会让 tsc 红，那么 ④ 为它
       专门造一份输入就是多余的仪式，而这条判据也就没有存在理由。

       实测过四种组合（真 tsc6）：只有「`next-env.d.ts` 不在」会红；
       `next-env.d.ts` 在而 `.next/dev/types/**` 整目录不在时 tsc 退 0 —— 这正是
       「别按直觉把 `.next` 也一起挪」那条结论的实物证据，一并钉在这里。

       在临时目录里搭最小复现，不动本仓库：`*.css` 的模块声明来自
       `node_modules/next/types/global.d.ts`，要靠那两行 reference 才进程序。
       所以这里给一份**只指向仓库 node_modules 的**环境声明，不复制声明本身。 */
    const tsc = resolveTscBin();
    expect(tsc, "解不出可用的 tsc，这条反证无法成立").not.toBeNull();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsc2882-"));
    try {
      /* pnpm 布局下 `node_modules/next` 是链接，指向仓库那一份 —— 用符号链接把
         类型程序接到真 Next 上，不拷贝（拷贝等于把被测对象换成一份快照）。
         链接建在临时目录里，不改仓库。 */
      fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
      fs.symlinkSync(
        path.join(ROOT, "node_modules", "next"),
        path.join(dir, "node_modules", "next"),
        "junction",
      );
      fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src", "app", "globals.css"), "/* x */\n");
      fs.writeFileSync(
        path.join(dir, "entry.tsx"),
        `import "./src/app/globals.css";\nexport const Y = 1;\n`,
      );
      const writeCfg = (include: string[]): void => {
        fs.writeFileSync(
          path.join(dir, "tsconfig.json"),
          JSON.stringify(
            {
              compilerOptions: {
                noEmit: true,
                strict: true,
                jsx: "react-jsx",
                moduleResolution: "Bundler",
                module: "ESNext",
                skipLibCheck: true,
              },
              include: ["entry.tsx", ...include],
            },
            null,
            2,
          ),
        );
      };

      // ① 没有那份环境声明 → TS2882（本条反证要的读数）。
      writeCfg([]);
      const bare = tsc!.runIn(dir, ["--noEmit"]);
      expect(bare.output).toContain("TS2882");
      expect(bare.status, "TS2882 应当让 tsc 非零退出").not.toBe(0);

      // ② 补上那两行 reference → 退 0（`* .css` 的声明这才进程序）。
      fs.writeFileSync(
        path.join(dir, "next-env.d.ts"),
        `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\nimport "./.next/dev/types/routes.d.ts";\n`,
      );
      writeCfg(["next-env.d.ts"]);
      const withEnv = tsc!.runIn(dir, ["--noEmit"]);
      expect(
        withEnv.status,
        `补上环境声明后必须退 0，实际输出：\n${withEnv.output}`,
      ).toBe(0);
      /* 上面那份声明里的 `import "./.next/dev/types/routes.d.ts"` 是**悬空**的
         （`.next` 根本不存在），而这一跑照样退 0 —— 与仓库里那条长期存在的读数
         （`check-tsc-artifact-hint.cjs` 的注释也记了）一致。别把这段拆掉换成
         「把 .next 也造出来」：那会让这条反证依赖一件与结论无关的东西。 */
      expect(
        fs.existsSync(path.join(dir, ".next")),
        "反证的前提是 `.next` 不存在 —— 悬空 import 退 0 才是要钉住的那个事实",
      ).toBe(false);
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

/** ④ 把生成件**挪走**时的暂存位置（一个与生成件同名的文件）。
 *
 *  两条约束，各自对应一次真实事故：
 *
 *  ① 必须在仓库内、与仓库**同一卷**。Windows 上 `rename` 跨卷直接 EXDEV（仓库在
 *     F:、`%TEMP%` 在 C: 是常见开发机形态，本机实测）。原先暂存在 `os.tmpdir()`，
 *     「挪」这一步从没成功，`finally` 却照旧把真目录 `rmSync` 掉、再去 rename 一个
 *     从没存在的暂存点 —— 报出来的是 ENOENT（指向还原），真因被盖掉，而且每跑一次
 *     就把这台机器的开发期输入删一次。
 *     选 `node_modules/.cache`：git 不看这里、类型程序与 eslint 都不展开这里，而
 *     `package.json` 的 lint 早已把 `.cache` 当缓存目录在用 —— 同一处用途，不另造约定。
 *
 *  ② 挪的是**那个 json**，不是它所在的目录。pre-commit 各组并发跑（`wall ≈ max(各组)`），
 *     组 A 的 tsc 与组 B 的 eslint 都在遍历 `.storybook/**`；目录在遍历中途消失，
 *     它们撞上是 `ENOENT: scandir`，报错既指不到本条判据、也指不到真凶。 */
function generatedStashFile(root: string, pid: number): string {
  return path.join(
    root,
    "node_modules",
    ".cache",
    `sb-generated-${String(pid)}`,
    path.basename(GENERATED_REL),
  );
}

/** 把暂存的生成件放回原处，并收掉本次自建的暂存目录（判据不该在缓存里留垃圾）。
 *  放回不了（进程被中断、暂存没落成）就按本机现生成一份：一次判据不该把开发期
 *  输入弄丢 —— 丢了之后的现象是「跑过 storybook 的机器才开始红」。 */
function restoreGeneratedFile(generatedFile: string, stash: string): void {
  if (fs.existsSync(stash)) {
    if (fs.existsSync(generatedFile)) {
      fs.rmSync(generatedFile, { force: true });
    }
    fs.renameSync(stash, generatedFile);
    fs.rmSync(path.dirname(stash), { recursive: true, force: true });
    return;
  }
  writeStorybookAppOrigin(ROOT, path.join(ROOT, GENERATED_REL));
}

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
