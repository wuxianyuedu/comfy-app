/**
 * 「被类型检查的源码不该 import 一个不入库的生成件」（台账 E15 / ISSUE #1409）：生成件只在 `pnpm storybook` 时
 * 产出且 gitignore，tsconfig include 却显式列着它 ⇒ 干净检出 `tsc --noEmit` 必红（门槛 A 组）；`exclude` 拦不住被
 * import 拉进程序的文件（实测 TS2307），故修法是让被引方不依赖生成件；同理 ④ 用 Next 导出现造 `next-env.d.ts`（缺则 TS2882）。
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

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
function staticSpecifiers(source: string): Array<string> {
  const code = stripComments(source);
  const specs: Array<string> = [];
  for (const m of code.matchAll(/from\s+["'](?<specifier>[^"']+)["']/g)) {
    const spec = m.groups?.specifier;
    if (spec !== undefined && spec !== "") {
      specs.push(spec);
    }
  }
  for (const m of code.matchAll(/\brequire\(\s*["'](?<specifier>[^"']+)["']\s*\)/g)) {
    const spec = m.groups?.specifier;
    if (spec !== undefined && spec !== "") {
      specs.push(spec);
    }
  }
  return specs;
}

/**
 * 剥掉说明符末尾的 `.ts` / `.tsx`（含 `.mts` / `.cts`），让「引的是不是那个模块」与**后缀写法**无关：`.storybook/**`
 * 的相对 import 一律写全后缀（否则 loader 打 deprecation，见 `tests/storybook-config.test.ts`），而本文件判接线关系，
 * 不该顺带把写法钉进来 —— 带后缀是**写法**、剥掉后缀才是**指向**。
 */
function withoutModuleExt(spec: string): string {
  return spec.replace(/\.m?tsx?$/, "");
}

/**
 * ④ 用的「窄项目」：`extends` 仓库真那份 tsconfig（paths/jsx/strict 全继承，重抄就是第二事实源），include 只收到
 * `.storybook/**` 与 ④ 现造的环境声明（`provisionNextEnv`，不是仓库根那份生成件）；`exclude` 必须覆写成仓库那份去掉
 * `node_modules`（现造声明落在 `node_modules/.cache/`，否则被自己挡在程序外）；`incremental: false` 必须，缓存命中会静默退 0。
 */
function narrowTsconfigText(root: string, envDts: string, inheritedExclude: Array<string>): string {
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
 * 用 **Next 自己的导出**现造一份 `next-env.d.ts`（按包名解析内部模块，不写死 `node_modules/next/dist/...` —— pnpm 布局
 * 下那是随版本变的链接名）；手抄那几行即第二事实源，Next 改文件头时这里会静默过期。`distDir` 传相对路径（writer 拼进
 * import，绝对路径会写出 `import ".//abs/path/..."` 畸形说明符），由此的悬空 import 正是干净检出要的形态。
 */
async function provisionNextEnv(outDir: string): Promise<string> {
  /* SAFETY: 类型断言已复核 */
  const { writeAppTypeDeclarations } =
    (await import("next/dist/lib/typescript/writeAppTypeDeclarations.js")) as {
      writeAppTypeDeclarations: (options: {
        baseDir: string;
        distDir: string;
        hasAppDir: boolean;
        hasPagesDir: boolean;
        imageImportsEnabled: boolean;
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
 * 把窄配置 + 它要的环境声明落到**仓库内**的暂存目录（`node_modules/.cache`：git 不看、tsc 与 eslint 不展开、与仓库
 * 同卷 —— 跨卷 `rename` 会 EXDEV，由 `moveFileAcrossVolumes` 退 copy）；`extends` 用绝对路径，放哪儿都不影响继承。
 * `os.tmpdir()` 不行：「仓库内输入 + 仓库外临时目录」这条组合已被那次事故判死过一回（见 generatedStashFile）。
 */
async function writeNarrowTsconfig(): Promise<{
  cfg: string;
  dir: string;
  envDts: string;
}> {
  const dir = fs.mkdtempSync(path.join(ROOT, "node_modules", ".cache", "sb-narrow-tsc-"));
  const envDts = await provisionNextEnv(path.join(dir, "env"));
  const cfg = path.join(dir, "tsconfig.json");
  fs.writeFileSync(cfg, narrowTsconfigText(ROOT, envDts, repoExclude()));
  return { dir, cfg, envDts };
}

/**
 * 仓库真那份 `tsconfig.json` 的 `exclude`（读而不重抄 —— 重抄即第二事实源，且这份清单只许减不许加，抄窄会让窄项目
 * 悄悄多扫）。用 `typescript` 自己的解析器而非手剥注释 + `JSON.parse`：真配置带块/行注释与尾逗号，手搓剥离器是第三
 * 事实源；`extends` 链也一并展开。
 */
function repoExclude(): Array<string> {
  /* SAFETY: 类型断言已复核 */
  // oxlint-disable-next-line typescript/no-require-imports
  const ts = require("typescript") as {
    readConfigFile: (
      file: string,
      read: (p: string) => string | undefined,
    ) => { config?: { exclude?: Array<string> } };
  };
  const parsed = ts.readConfigFile("tsconfig.json", (f) => fs.readFileSync(f, "utf8"));
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
    const offenders: Array<string> = [];
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
    expect(staticSpecifiers(read(CONSUMER_REL)).map(withoutModuleExt)).toContain(
      "./app-origin-defaults",
    );
    expect(staticSpecifiers(read(PREVIEW_REL)).map(withoutModuleExt)).toContain(
      "./app-origin-reader",
    );
    expect(staticSpecifiers(read(MAIN_REL)).map(withoutModuleExt)).toContain("./app-origin-reader");
  });

  it("② 生成件的字段名与入库类型逐字段对齐（改名 = 静默回落成缺省端口）", () => {
    /* 真跑一次生成器到临时目录，解析它的 JSON —— 不 mock：
       桩掉生成器等于拿自己写的期望去证明自己。 */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storybook-app-origin-"));
    let payload: Record<string, unknown>;
    try {
      const outFile = path.join(dir, GENERATED_REL);
      writeStorybookAppOrigin(dir, outFile);
      /* SAFETY: 类型断言已复核 */
      payload = JSON.parse(fs.readFileSync(outFile, "utf8")) as Record<string, unknown>;
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
        /* SAFETY: 类型断言已复核 */
        typeof (APP_ORIGIN_DEFAULTS as Record<string, unknown>)[key],
      );
    }
  });

  it("③ 生成物仍然不入库 —— 端口是这台机器算的，入库等于指向别人的端口", () => {
    const ignore = read(".gitignore")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
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
    /* 本机实测（同一份输入连跑三次全仓 `tsc --noEmit`）：20.7s / 26.7s / 131.9s —— 一遍全仓编译自身就有 6 倍抖动；
     * 进 pre-commit 组 C 的并发池（`--maxWorkers=4`，A/B/D 同跑）实测 181–182s，120s 预算必爆，串行 8/8 绿 ⇒ 争用假红
     * （规范 §11.13）。修法按 §11.13 走「精确化判据」：编译面收到窄项目（见 narrowTsconfigText），实测 6.9s，预算不动；
     * 输入面多一样 `next-env.d.ts` 的现造开销约十几毫秒，无关紧要。 */
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
        moveFileAcrossVolumes(generatedFile, stash);
        expect(
          fs.existsSync(stash) && !fs.existsSync(generatedFile),
          `生成件没能挪进 ${stash} —— 暂存点必须在仓库内（跨卷本应由 copy 退路兜住，
挪不动说明这一格没跑起来，不是判据红；见 generatedStashFile）`,
        ).toBe(true);
        /* 挪的只是那个 json，**目录必须还在**：pre-commit 各组并发（`wall ≈ max(各组)`），组 A 的 tsc 与组 B 的 eslint
           都在遍历 `.storybook/**`；目录中途消失会撞 `ENOENT: scandir '.storybook\generated'`，报错既不含本条判据
           也不含真凶（实测崩过一回）。空目录不影响任何人：json 不是 tsc / eslint 的展开目标。 */
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
        if (existed) {
          restoreGeneratedFile(generatedFile, stash);
        }
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
    /* 编译面收到 `.storybook` 后新的失效方式是「窄配置根本没把被引方纳进来」—— 那样 ④ 永远绿，而这正是它唯一要判的。
     * 故补一条在场证明：`--listFilesOnly` 打出类型程序的文件清单，① 点名的三个被引方一个都不许缺（与 ④ 同一份配置）。
     * 还要点名 ④ 现造的 `next-env.d.ts`：它是 ④ 的地基（缺了 `preview.tsx` 的 CSS import 就是 TS2882），而
     * `provisionNextEnv` 的 `existsSync` 只证明落了盘、不证明在**程序**里 —— 清单点名才算把「地基在场」判住。 */
    { timeout: 120_000 },
    async () => {
      const tsc = resolveTscBin();
      expect(tsc, "解不出可用的 tsc，这条无法成立").not.toBeNull();
      const { dir, cfg, envDts } = await writeNarrowTsconfig();
      try {
        const listed = tsc!.run(["-p", cfg, "--noEmit", "--listFilesOnly"]);
        expect(listed.status, `--listFilesOnly 都退非 0，配置本身有问题：\n${listed.output}`).toBe(
          0,
        );
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

  it("④ 的暂存点形状：仓库内、不入库、不被遍历，且挪的是文件不是目录", () => {
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
    /* 「与仓库同卷」现在是**首选**而不是硬要求（跨卷由 moveFileAcrossVolumes 退成 copy），
       所以这里不判卷。而且原来那句 `path.parse(stash).root === path.parse(ROOT).root`
       在 stash 由 ROOT 拼出来的前提下恒真 —— 一条恒真的断言不是判据，它只教会人忽略红。
       换成可证伪的那一条：暂存点必须跟着 `root` 参数走。照 `os.tmpdir()` 写死的实现
       在单卷机器上永远绿，而它正是当年把这台机器的开发期输入删掉的那一版。 */
    const elsewhere = generatedStashFile(path.join(ROOT, "elsewhere"), 4242);
    expect(
      elsewhere.startsWith(path.join(ROOT, "elsewhere") + path.sep),
      "暂存点必须由传进来的 root 派生 —— 写死到仓库外的临时目录，跨卷那一格就又回来了",
    ).toBe(true);
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
    /* 这条反证是本节新增输入面的**前提**：若「缺 `next-env.d.ts` 那两行 reference」不让 tsc 红，④ 为它造输入就是多余
       仪式。实测四种组合（真 tsc6）：只有「`next-env.d.ts` 不在」会红；它在而 `.next/dev/types/**` 整目录不在时 tsc 退 0
       —— 这正是「别按直觉把 `.next` 一起挪」的证据。临时目录搭最小复现、不动仓库：`*.css` 的模块声明来自
       `node_modules/next/types/global.d.ts`，要靠那两行 reference 才进程序，故这里给一份只指向仓库 node_modules 的声明。 */
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
      const writeCfg = (include: Array<string>): void => {
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
      expect(withEnv.status, `补上环境声明后必须退 0，实际输出：\n${withEnv.output}`).toBe(0);
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
    /* SAFETY: 类型断言已复核 */
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    // 契约：postinstall 必须逐字是那一条、禁止 `&&`（launcher-core 的
    // checkPostinstall() 守的就是它，#636 的形态），所以「补输入」只能并进入口内部。
    expect(String(pkg.scripts?.postinstall)).toBe("node scripts/install-git-hooks.mjs");
    const entry = stripComments(read(ENTRY_REL));
    // 动态 import 的那条说明符（prettier 会按行宽折行，所以按形状判而不是整行字面量）
    expect(entry).toMatch(/await import\(\s*["']\.\/storybook-assets\.mjs["']\s*\)/);
    expect(entry).toMatch(/\bwriteStorybookAppOrigin\s*\(/);
    // 同一族的第二格：media 值源要指向磁盘上的真图，那份目录也是现生成且不入库的。
    expect(entry).toMatch(/\bensureStorybookAssets\s*\(/);
    // 调用必须在 try 里、且 catch 说得出「这一步没做成怎么办」：
    // 它是开发体验的兜底，绝不能变成 `pnpm install` 的新失败点。
    expect(entry).toMatch(/try\s*\{[\s\S]*?\bwriteStorybookAppOrigin\s*\([\s\S]*?\}\s*catch/);
    expect(entry).toContain("警告：Storybook");
  });

  it("读不到生成件时 reader 交回入库的缺省值（不是抛错、也不是空值）", () => {
    /* 这一条不依赖磁盘上有没有生成件：`env` 里那三个键由 `main.ts` 的 `env()`
       在编译期注入，`readAppOrigin` 只解释它 —— 把 `process.env` 临时换成缺键
       的形状，它必须给出缺省值。 */
    const keys = ["SB_APP_DEV_PORT", "SB_APP_DEV_ORIGIN", "SB_APP_DEV_PORT_SOURCE"];
    const saved = new Map(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) {
        delete process.env[k];
      }
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
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  });
});

/** ④ 把生成件**挪走**时的暂存位置（与生成件同名的文件）。两条约束各对应一次真实事故：
 *  ① 必须在仓库内、优先同卷：`rename` 跨卷会 EXDEV，由 {@link moveFileAcrossVolumes} 退 copy+unlink，语义等价；**仓库内**
 *     不打折 —— 原先暂存 `os.tmpdir()`（F: 仓库 / C: `%TEMP%`），没有 copy 退路时「挪」从没成功，`finally` 却照旧删真目录
 *     再 rename 一个不存在的暂存点，报 ENOENT（指向还原）且每次删掉这台机器的开发期输入；选 `node_modules/.cache`（git/tsc/
 *     eslint 都不看这里，lint 早已把它当缓存）。② 挪的是**那个 json**不是目录 —— 各组并发遍历会撞 `ENOENT: scandir`。 */
function generatedStashFile(root: string, pid: number): string {
  return path.join(
    root,
    "node_modules",
    ".cache",
    `sb-generated-${String(pid)}`,
    path.basename(GENERATED_REL),
  );
}

/** 把一份文件挪到另一处，**跨卷时退成 copy + unlink**。立案现场（2026-10-20 的 CI 节点）：workspace 在 G:、
 *  `workspace/node_modules` 是指向写死在 F: 的缓存槽的链接 ⇒ `renameSync` 直接 EXDEV，红的是本条判据，原因在缓存选址上；
 *  挪不动只说明「这一格没跑起来」不是判据红 —— 拿它拦 PR 等于让节点布局冒充代码结论。⚠️ 写死槽根已由 `pnpm store path`
 *  所在卷推导（#2061），节点上走的仍是 rename；留着这一支是别让判据依赖「恰好同卷」，换盘机器它还得跑得起来。 */
function moveFileAcrossVolumes(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch (error) {
    /* SAFETY: 类型断言已复核 */
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

/** 把暂存的生成件放回原处，并收掉本次自建的暂存目录（判据不该在缓存里留垃圾）。放回不了（进程被中断、暂存没落成、
 *  **挪这一步自己抛**）就按本机现生成一份 —— 一次判据不该把开发期输入弄丢，丢了之后的现象是「跑过 storybook 的机器才
 *  开始红」。`move` 可注入：那条路本机造不出来（同卷 rename 一定成功、ENOSPC 也无法按需触发），不给缝就只能干看着
 *  承诺与实现不一致。 */
function restoreGeneratedFile(
  generatedFile: string,
  stash: string,
  move: (from: string, to: string) => void = moveFileAcrossVolumes,
): void {
  if (fs.existsSync(stash)) {
    if (fs.existsSync(generatedFile)) {
      fs.rmSync(generatedFile, { force: true });
    }
    /* 放回这一跳走同一个挪法（跨卷时它自己退成 copy），不许在这里留第二条只会 EXDEV 的路。
       但 copy 那一支中间**两侧都没有文件**（先 rm 再 copy），ENOSPC / EACCES 抛在中间时
       既没放回、也不会走到下面那条「暂存点不存在才触发」的重生成 —— 所以这一跳包 try/catch，
       兜回承诺的那一句：就地现生成一份，比给下一跑留一个缺失态便宜。 */
    try {
      move(stash, generatedFile);
    } catch {
      writeStorybookAppOrigin(ROOT, generatedFile);
    }
    fs.rmSync(path.dirname(stash), { recursive: true, force: true });
    return;
  }
  /* 重生成落到**传进来的那个路径**，不在这里重算一遍 `ROOT/GENERATED_REL`：
     两处各算一份的漂移形态是「测的时候写到仓库里、跑的时候写到别处」，
     而这条承诺的全部内容就是「别把开发期输入弄丢」。 */
  writeStorybookAppOrigin(ROOT, generatedFile);
}

/** 判据要真跑一次 tsc：从依赖里解出可执行文件，不写死 `node_modules/.bin/tsc`。
 *
 *  pnpm 布局下两个形态各自带着自己的 bin 名（`@typescript/native` 的 `tsc`、
 *  `typescript`（实为 `@typescript/typescript6`）的 `tsc6`），顶层 `node_modules/`
 *  下只是链接 —— 按包名 + `bin` 字段解，别按路径猜。 */
function resolveTscBin(): {
  run: (args: Array<string>) => { output: string; status: number | null };
  runIn: (cwd: string, args: Array<string>) => { output: string; status: number | null };
} | null {
  /* SAFETY: 类型断言已复核 */
  for (const [pkg, binName] of [
    ["@typescript/native", "tsc"],
    ["typescript", "tsc6"],
  ] as const) {
    const pkgJson = path.join(ROOT, "node_modules", pkg, "package.json");
    let bin: string | undefined;
    try {
      /* SAFETY: 类型断言已复核 */
      const pkgData = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as {
        bin?: Record<string, string> | string;
      };
      bin = typeof pkgData.bin === "string" ? pkgData.bin : pkgData.bin?.[binName];
    } catch {
      continue;
    }
    if (bin === undefined || bin === "") {
      continue;
    }
    const file = path.resolve(path.dirname(pkgJson), bin);
    if (!fs.existsSync(file)) {
      continue;
    }
    const runIn = (cwd: string, args: Array<string>) => {
      /* bin 是带 shebang 的 node 脚本垫片 —— Windows 的 spawnSync 不认
       * shebang，直接 exec 会 ENOENT（本机实测），必须经 node 启动。 */
      const r = spawnSync(process.execPath, [file, ...args], {
        cwd,
        encoding: "utf8",
      });
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    return { run: (args) => runIn(ROOT, args), runIn };
  }
  return null;
}

/** ④ 那格「挪得动」的前提曾在 CI 节点上不成立（ISSUE #2059 的现场）：workspace 在 G:、`workspace\node_modules` 是
 *  指向写死在 F: 的缓存槽的链接，`renameSync` 直接 EXDEV。本机造不出跨卷（同卷 rename 一定成功），故按形状替掉
 *  rename，而不是留一段「只有节点上才跑得到」的死代码。⚠️ 槽根已被 #2061 订正成按 store 所在卷推导 ⇒ 节点上仍走
 *  rename，这两条测的是**形状兜底还在**。 */
describe("moveFileAcrossVolumes：跨卷退成 copy+unlink，别把节点布局当判据红", () => {
  const errno = (code: string): NodeJS.ErrnoException => {
    /* SAFETY: 类型断言已复核 */
    const e = new Error(`${code}: simulated`) as NodeJS.ErrnoException;
    e.code = code;
    return e;
  };

  it("EXDEV ⇒ 原处不再有、暂存点有了、内容一致", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-exdev-"));
    try {
      const from = path.join(dir, "app-origin.json");
      const to = path.join(dir, "cache", "app-origin.json");
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(from, '{"port":3123}', "utf8");
      const spy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
        throw errno("EXDEV");
      });
      moveFileAcrossVolumes(from, to);
      /* 取读数要排在 `mockRestore()` **之前** —— 它会把调用记录一起清掉，
       * 排后面拿到的是 0，看起来像「rename 从没被试过」。 */
      const tried = spy.mock.calls.length;
      spy.mockRestore();
      expect(tried, "没有先试 rename").toBeGreaterThan(0);
      expect(fs.existsSync(to), "跨卷退路没把东西放到暂存点").toBe(true);
      expect(fs.existsSync(from), "原处还在 ⇒ 缺失态根本没造出来").toBe(false);
      expect(fs.readFileSync(to, "utf8")).toBe('{"port":3123}');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("非 EXDEV 的失败原样抛 —— 兜底不许把别的错读成「挪好了」", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-eperm-"));
    try {
      const from = path.join(dir, "app-origin.json");
      const to = path.join(dir, "cache", "app-origin.json");
      fs.writeFileSync(from, "{}", "utf8");
      const spy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
        throw errno("EPERM");
      });
      expect(() => {
        moveFileAcrossVolumes(from, to);
      }).toThrow("EPERM");
      spy.mockRestore();
      expect(fs.existsSync(from), "报错被吞了 ⇒ 原处不该还在").toBe(true);
      expect(fs.existsSync(to), "EPERM 不该被当成「走退路」").toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** 还原那一跳的窗口（同一族的「曾经真、现在不真」：头上的承诺写的是「放回不了就现生成」，
 *  而实现里那条现生成**只挂在「暂存点不存在」那一支** —— copy 退路中途抛（ENOSPC / EACCES）
 *  就既没放回也没重生成，开发期输入当场丢了。
 *  ⚠️ 严重性说清：`sameVolume` 守卫之后节点走的是 rename，这条窗口目前打不到 ——
 *  修的是承诺与实现的一致性，不是正在发生的坏。 */
describe("restoreGeneratedFile：挪不动也必须把开发期输入找回来", () => {
  /** 造一份「生成件已被挪走、暂存点在」的现场，返回两侧路径。 */
  const staged = (dir: string, content: string) => {
    const generatedFile = path.join(dir, ".storybook", "generated", "app-origin.json");
    const stash = generatedStashFile(dir, 7777);
    fs.mkdirSync(path.dirname(stash), { recursive: true });
    fs.writeFileSync(stash, content, "utf8");
    return { generatedFile, stash };
  };

  it("挪回中途抛 ⇒ 就地现生成一份，且暂存目录照样收干净", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-restore-throw-"));
    try {
      const { generatedFile, stash } = staged(dir, '{"APP_DEV_PORT":3999}');
      restoreGeneratedFile(generatedFile, stash, () => {
        throw Object.assign(new Error("ENOSPC: simulated"), { code: "ENOSPC" });
      });
      expect(
        fs.existsSync(generatedFile),
        "承诺是「一次判据不该把开发期输入弄丢」—— 挪不动时两侧都不许是空的",
      ).toBe(true);
      /* SAFETY: 类型断言已复核 */
      const restored = JSON.parse(fs.readFileSync(generatedFile, "utf8")) as {
        APP_DEV_PORT?: number;
      };
      expect(typeof restored.APP_DEV_PORT).toBe("number");
      expect(fs.existsSync(path.dirname(stash)), "暂存目录不许留在缓存里").toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("挪得动 ⇒ 放回的是暂存那一份，不是重生成出来的另一份", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-restore-ok-"));
    try {
      const { generatedFile, stash } = staged(dir, '{"sentinel":"放回的不是重生成"}');
      restoreGeneratedFile(generatedFile, stash, (from, to) => {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
      });
      expect(fs.readFileSync(generatedFile, "utf8")).toBe('{"sentinel":"放回的不是重生成"}');
      expect(fs.existsSync(path.dirname(stash))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("暂存点压根不存在 ⇒ 现生成一份（既有那一支不许被上面的 try/catch 带跑）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-restore-nostash-"));
    try {
      const generatedFile = path.join(dir, ".storybook", "generated", "app-origin.json");
      restoreGeneratedFile(generatedFile, generatedStashFile(dir, 6666), () => {
        throw new Error("这一支不该碰到 move");
      });
      expect(fs.existsSync(generatedFile)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
