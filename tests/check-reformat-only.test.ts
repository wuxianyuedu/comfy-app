/**
 * 提交门槛自检：格式化提交必须与行为改动分离（ISSUE #575 第 9 项 / 规范 §13.5）。
 *
 * 这条门禁的判据是「把改动前的**整份文件**交给 oxfmt 重排，看是否逐字等于
 * 改动后」—— 踩过两个坑，用例把两坑都钉住：
 *   ① 判据若用「抹掉空白后逐行比对」，格式化器的**重新断行**与 Tailwind 类名重排
 *      （prettier 时代靠 `prettier-plugin-tailwindcss`，oxfmt 内置）都看不见（实测漏报）；
 *   ② 若把 `git diff` 的 **hunk 片段**单独交给格式化器，会 `SyntaxError`
 *      （片段不是完整的语法单元）—— 那样每个文件都「无法判定」，门禁静默失效。
 * 所以这里必须真跑 git + oxfmt（临时仓库 + 真提交），不能靠桩。
 *
 * 临时仓库走共享夹具 `defineGateRepo`（§11.16.1）—— 手搓的那套四件套收在一处。
 * 本文件的形状比多数门禁自测重：既要 `git init` + 真提交，又要把仓库的
 * `node_modules` 软链进工作区（脚本按「向上找 node_modules」解析 oxfmt）。
 * 两项都通过夹具的 `setup` / `copy` 选项声明，不回到「自己 beforeEach 里搭」。
 *
 * 规范：docs/standards/13-提交与-code-review.md §13.5
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { vi } from "vitest";

import {
  afterEach,
  beforeEach,
  defineGateRepo,
  describe,
  type GateRepo,
} from "./helpers/gate-repo";
import { symlinkDir } from "./helpers/symlink-dir";

/* 每条用例都要在临时仓库里真跑 git（init / add / commit / merge）+ 真起 oxfmt
 * （门禁按「整批一次 oxfmt」调用，但建库 / 提交 / 判定的固定成本仍在）：默认
 * 5s 的用例超时在全量并行满载时会被击穿（CI 实测过一次 `Test timed out in 5000ms`，
 * 报在 `tests/check-format.test.ts` 的同类用例上）。整文件放宽到 30s——只影响本文件，
 * 不掩盖其它文件的真实挂起。 */
/* oxfmt 全仓扫描是本套件最慢的用例族：满载下 30s 不够（实测越线）。 */
/* 本文件的每个用例都要反复 spawn oxfmt（全仓扫描 + 逐文件格式化）：
   全量满载下 60s 仍不够（实测 683s 跑完 17 例）——这是套件里最重的
   合法用例族；vitest 5 升级后全量并发下「12 文件阻断」单例实测又顶穿
   120s，预算给到 300s（与 storybook-tsc-input ④ 同档）。 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

/**
 * oxfmt 的 **JS 入口**（不是 `node_modules/.bin/oxfmt`）。
 *
 * `.bin/` 下那个是启动 shell 包装（Windows 上是 .cmd），`node <它>` 会
 * `SyntaxError: Invalid or unexpected token`；而临时目录里没有 node_modules，
 * 也不能直接执行它。走 `require.resolve` 拿真实包根再拼 `bin/oxfmt`（`bin/oxfmt`
 * 本身不在包的 `exports` 里，直接 resolve 会被挡），`node <它>` 才成立。
 */
const OXFMT_PKG_DIR = dirname(require.resolve("oxfmt/package.json"));
const OXFMT_ENTRY = join(OXFMT_PKG_DIR, "bin", "oxfmt");
/** `bin/oxfmt` 只是一行 `import "../dist/cli.js"`，计数 wrapper 要转发的是**真身**。 */
const OXFMT_CLI = join(OXFMT_PKG_DIR, "dist", "cli.js");

/** 探针 / wrapper 的落点（在临时仓库**之外**，避免被 `git add -A` 一并提交）。 */
let configDir = "";

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "reformat-cfg-"));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

/**
 * 夹具：`scripts/` 下放被测判据脚本，工作区里备好它跑起来真正依赖的那几样。
 *
 * `copy` 的两项都是「不带就 exit 2」的硬依赖（缺了的表现是「门禁坏了」，
 * 实际是夹具少一块）：
 *   · `scripts/launcher-core/` —— 格式化器形态判据模块按**相对脚本的路径**动态
 *     `import()`（`launcher-core/shell.mjs`），缺了脚本以 exit 2 结束；
 *     递归拷整个目录而不是软链单文件（`shell.mjs` 还依赖同目录的 `command-echo.mjs`，
 *     且 Windows 下 `fs.symlink(文件)` 普通用户 100% EPERM）。
 *   · `src/lib/process/executable-resolve.ts` 与它自己的依赖
 *     `src/lib/process/platform.ts` —— `shell.mjs` 静态 import 前者
 *     （ISSUE #1327），而前者又 import 后者：**链上的每一份都要在**
 *     （只抄第一份等于把「链」抄成「一个点」，漏的那一份同样让临时仓库里的
 *     `shell.mjs` 在**加载阶段**就 `ERR_MODULE_NOT_FOUND` —— 实测踩过，见
 *     ISSUE #1961）。
 */
const { test, expect } = defineGateRepo({
  script: "check-reformat-only.cjs",
  workdir: "reformat",
  /* `src/lib` 是被扫目录（建空的即可，`seedEmpty` 往里放一份），其余三处是
   * `--staged` 那组用例要造的**扫描面上的别的树** —— 夹具只建这几层，
   * 「面上有源文件 ⇒ 不跳过」才不是一句空话（见文件末尾那组用例）。 */
  dirs: ["src/lib", "scripts", "docs", "changelog.d"],
  copy: [
    { from: "scripts/launcher-core", to: "scripts/launcher-core" },
    {
      from: "src/lib/process/executable-resolve.ts",
      to: "src/lib/process/executable-resolve.ts",
    },
    {
      from: "src/lib/process/platform.ts",
      to: "src/lib/process/platform.ts",
    },
  ],
  setup: (repo) => {
    /* 临时仓库也要能解析 oxfmt：真实场景里门禁在**源码仓库**里跑
     * （node_modules 就在旁边），临时仓库没有 —— 软链过来最贴近真实的解析路径，
     * 也让脚本的「向上找 oxfmt」这一档被真正走到（而不是悄悄退回 pnpm 兜底）。
     * `symlinkDir` 内部按平台选 junction / dir（Windows 下目录软链需特权，
     * junction 是 NTFS 内建、无需特权且语义等价）。 */
    symlinkDir(join(process.cwd(), "node_modules"), join(repo.dir, "node_modules"));
    repo.git("init", "-q");
    repo.git("config", "user.email", "t@local");
    repo.git("config", "user.name", "t");
    /* 本机 / CI 可能全局开着 commit.gpgsign，临时仓库里没有可用密钥。 */
    repo.git("config", "commit.gpgsign", "false");
    repo.git("config", "tag.gpgsign", "false");
    repo.write(".gitignore", "node_modules\n");
  },
});

/**
 * 工作区 HEAD 的提交哈希 —— 造 `MERGE_HEAD` 那档要一个**真实存在**的提交。
 *
 * 夹具的 `repo.git()` 只转 `stdio: "ignore"`（它服务的是「造状态」而不是「读数」），
 * 所以读数要自己起一次 git 把 stdout 拿回来。
 */
function headSha(repo: GateRepo): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo.dir,
    encoding: "utf8",
  }).trim();
}

/**
 * 提交当前工作区的全部改动。
 *
 * 夹具的 `repo.commit()` 只做 commit（`git add` 留给调用点显式写 —— 分支守卫那
 * 一族要的是「精确暂存某几个文件」）。本文件的语义是「把这一批文件整体提交成基线」，
 * 所以每次都先 `add -A`：写在一处，避免十几条用例各抄一遍 add。
 */
function commitAll(repo: GateRepo, message: string): void {
  repo.git("add", "-A");
  repo.commit(message);
}

/**
 * 在临时仓库里对文件跑 oxfmt —— 用**仓库真实那一版**格式化器。
 *
 * 夹具造出来的「改动后」这一侧必须是**格式化器真的给出的形态**：手写一份（prettier
 * 时代就是这么写的）在换格式化器之后会变成「手写的那一份」，判据与夹具各说一套，
 * 而用例还全绿 —— 那是最难看的一类失效。所以夹具与判据走**同一个入口**。
 */
function formatInPlace(repo: GateRepo, rel: string | string[]): void {
  /* 路径可以是**一批**：`oxfmt a b c…` 一次做完，而每条路径各起一次进程是本文件
   * 最大的那笔开销（格式化器冷启实测百毫秒级，与文件大小几乎无关）。「12 个文件
   * 各起一次」与「一次做完」在**判据上等价** —— 被测的是「这些文件有没有被重排」，
   * 不是「格式化器被起了几次」。
   * 仍逐条调用的用例（单文件那一族）语义不变，形参收一个字符串即可。 */
  const paths = Array.isArray(rel) ? rel : [rel];
  execFileSync("node", [OXFMT_ENTRY, ...paths], {
    cwd: repo.dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * 把一段源码交给 oxfmt，拿回它的规范形态（不落进仓库）。
 *
 * 直接喂 `classifyReformatOnly` 的那几条用例要自己给「改动后」这一侧，理由同
 * `formatInPlace`：**那一侧必须是格式化器真给的形态**。
 */
function oxfmtText(text: string, ext = "ts"): string {
  const dir = mkdtempSync(join(tmpdir(), "reformat-probe-"));
  try {
    const target = join(dir, `probe.${ext}`);
    writeFileSync(target, text);
    execFileSync("node", [OXFMT_ENTRY, target], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readFileSync(target, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 把临时仓库里那份 oxfmt 换成一个**计数 wrapper**：命中一次 = 「格式化器被起了一次」。
 *
 * 为什么能换掉：脚本按「从自己所在目录向上找 `node_modules`」解析 `oxfmt/package.json`
 * 再拼 `bin/oxfmt`，而**被检查的那份脚本**就放在临时仓库的 `scripts/` 下 —— 于是临时
 * 仓库里的 `node_modules` 才是它命中的那一处（真仓库那一份换不掉，`HERE` 就是真仓库；
 * 这正是这几条用例要把脚本从临时仓库里 `require` 进来的原因）。
 *
 * `failFirst`:整批那一次故意以非 0 退出 —— 用来验「批量没给结论时，是不是每个文件
 * 都退回了逐文件那一档」。`bin/oxfmt` 只有一行 `import "../dist/cli.js"`，所以
 * wrapper 转发的是 `dist/cli.js` 这个真身（ESM，用 `type: "module"` 让 extensionless
 * 的入口按 ESM 加载 —— 真的那份就是这么跑起来的）。
 *
 * @returns 读调用次数的函数
 */
function instrumentOxfmt(repo: GateRepo, failFirst = false): () => number {
  const counter = join(configDir, "oxfmt-calls.txt");
  const flag = join(configDir, "oxfmt-failed-once");
  writeFileSync(counter, "");
  const wrapper = join(configDir, "oxfmt-instrumented.mjs");
  writeFileSync(
    wrapper,
    [
      'import { appendFileSync, existsSync, writeFileSync } from "node:fs";',
      `appendFileSync(${JSON.stringify(counter)}, "call\\n");`,
      ...(failFirst
        ? [
            `if (!existsSync(${JSON.stringify(flag)})) {`,
            `  writeFileSync(${JSON.stringify(flag)}, "1");`,
            "  process.exit(1);",
            "}",
          ]
        : []),
      `await import(${JSON.stringify(pathToFileURL(OXFMT_CLI).href)});`,
    ].join("\n"),
  );
  rmSync(join(repo.dir, "node_modules"), { recursive: true, force: true });
  mkdirSync(join(repo.dir, "node_modules", "oxfmt", "bin"), {
    recursive: true,
  });
  copyFileSync(wrapper, join(repo.dir, "node_modules", "oxfmt", "bin", "oxfmt"));
  writeFileSync(
    join(repo.dir, "node_modules", "oxfmt", "package.json"),
    JSON.stringify({ name: "oxfmt", version: "0.0.0", type: "module" }),
  );
  return () => readFileSync(counter, "utf8").split("\n").filter(Boolean).length;
}

/** 生成 n 个未过 oxfmt 的源文件并提交成基线。 */
function seedDirty(repo: GateRepo, n: number): string[] {
  const files: string[] = [];
  for (let i = 0; i < n; i++) {
    const rel = `src/lib/dirty-${i}.ts`;
    repo.write(rel, `export const PROBE_${i}={a:${i},b:"x"};\n`);
    files.push(rel);
  }
  commitAll(repo, "base");
  return files;
}

/** 建一个空的基线提交：只在「判定与门禁现场无关」的用例里用（它们不需要脏文件）。 */
function seedEmpty(repo: GateRepo): void {
  repo.write("src/lib/keep.ts", "export const KEEP = 1;\n");
  commitAll(repo, "base");
}
describe("格式化提交与行为改动分离", { timeout: 300_000 }, () => {
  test("一次提交格式化 12 个文件 → 阻断（远超阈值）", ({ repo }) => {
    const files = seedDirty(repo, 12);
    formatInPlace(repo, files);
    commitAll(repo, "format only");
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("格式化提交分离");
    expect(r.output).toContain("git reset --soft HEAD~1");
  });

  test("只格式化 1 个文件（未达阈值）→ 放行，但明确报出来", ({ repo }) => {
    const files = seedDirty(repo, 1);
    formatInPlace(repo, files[0]!);
    commitAll(repo, "tiny format");
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("未达阈值");
  });

  test("真实行为改动 → 放行（不把功能提交误判成格式化）", ({ repo }) => {
    seedDirty(repo, 1);
    repo.write("src/lib/dirty-0.ts", 'export const PROBE_0={a:99,b:"changed"};\n');
    commitAll(repo, "behaviour change");
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("没有纯格式化的");
  });

  test("格式化器的重新断行也算纯格式化（逐行比对会漏报的那一档）", ({ repo }) => {
    seedDirty(repo, 1);
    const rel = "src/lib/dirty-0.ts";
    // 超宽对象 → 格式化器一定把它拆成多行：断行变了，内容没变。
    repo.write(
      rel,
      'export const PROBE_0={aLongFieldName:"x",anotherLongFieldName:"y",third:"z"};\n',
    );
    commitAll(repo, "wide");
    formatInPlace(repo, rel);
    commitAll(repo, "reflow");
    const r = repo.run(["--strict"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("格式化提交分离");
  });

  test("没有父提交（首次提交 / 浅克隆）→ 跳过，不阻断", ({ repo }) => {
    repo.write("src/lib/a.ts", "export const A = 1;\n");
    commitAll(repo, "root");
    // --range 指向空 diff：应当以「没有文件改动」放行，而不是崩掉。
    const r = repo.run(["--range", "HEAD..HEAD"]);
    expect(r.code).toBe(0);
  });

  test("纯新增文件的提交不算格式化（没有旧内容可比）", ({ repo }) => {
    seedDirty(repo, 1);
    for (let i = 0; i < 12; i++) repo.write(`src/lib/added-${i}.ts`, "export const X={a:1};\n");
    commitAll(repo, "add files");
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("没有纯格式化的");
  });
});

/**
 * 换格式化器那一笔的显式出口：`format-migration:` 尾注（#2541）。
 *
 * 两条硬闸在这件事上**互锁**：格式判据是硬闸且没有基线 ⇒ 全量重排必须与切换同批；
 * 而本判据的阈值又会拦住同批里的重排 —— 迁移没有可落地的形状。所以给了声明这条
 * 路，但**它是两道护栏之后才成立**的，这组用例锁的正是「护栏真的会拦」：
 *   ① 区间里**每个**提交都要声明（漏一条就不认）；
 *   ② **逐提交**看，重排要么不到阈值、要么那条提交整条都是重排。
 * 少任何一道都回到阻断那一支 —— 否则这条尾注就成了「格式化随便夹带」的万能钥匙。
 */
describe("格式化器迁移的声明（`format-migration:`）", { timeout: 300_000 }, () => {
  /** 一条带迁移尾注的提交正文（尾注写在正文里，与标题分行）。 */
  const declared = (title: string) => `${title}\n\nformat-migration: prettier → oxfmt`;

  test("每条提交都声明 + 重排独占一条 ⇒ 按迁移放行（读数照报）", ({ repo }) => {
    seedDirty(repo, 12);
    // 第一条：切换本身（功能改动 + 零重排）。
    repo.write("src/lib/feature.ts", "export const FEATURE = 1;\n");
    commitAll(repo, declared("migrate the formatter"));
    // 第二条：重排独占。
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, declared("reformat"));

    const r = repo.run(["--range", "HEAD~2..HEAD"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("按迁移放行");
    expect(r.output).toContain("纯格式化 12 个");
  });

  test("重排与功能改动混在**同一条**提交里 ⇒ 声明了照样拦（护栏 ②）", ({ repo }) => {
    seedDirty(repo, 12);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    repo.write("src/lib/feature.ts", "export const FEATURE = 1;\n");
    commitAll(repo, declared("reformat and sneak a change in"));

    const r = repo.run(["--range", "HEAD~1..HEAD"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("不按迁移读");
  });

  test("漏了一个提交没声明 ⇒ 不按迁移读（护栏 ①）", ({ repo }) => {
    seedDirty(repo, 12);
    repo.write("src/lib/feature.ts", "export const FEATURE = 1;\n");
    commitAll(repo, "migrate the formatter"); // 这一条**没**写尾注
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, declared("reformat"));

    const r = repo.run(["--range", "HEAD~2..HEAD"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("格式化提交分离");
  });

  /* 平台侧那条流水线跑的是**合并预览**：`HEAD` 是合并提交，于是 `HEAD~1..HEAD`
   * 覆盖的是**整个 PR 区间**而不是「一条提交」（这正是 CI 那一格的现场 —— 不带
   * `--range`、也没有暂存区，脚本落到「判 HEAD~1..HEAD」那一支）。
   *
   * 合并提交相对第一父提交的 diff 就是整份 PR：把它算进「逐提交」那张表，等于把
   * 汇总又请回分母（切换那一笔的判据脚本 / 文档进分母 ⇒ 32/56），护栏 ② 当场自锁；
   * 它自动生成的正文也不会带尾注 ⇒ 护栏 ① 同样不成立。所以两条都按 `--no-merges`
   * 摘掉它，只判区间里那些真有人做了改动的提交。 */
  test("合并预览（HEAD 是合并提交）⇒ 合并提交不进逐提交那张表", ({ repo }) => {
    seedDirty(repo, 12);
    repo.write("src/lib/feature.ts", "export const FEATURE = 1;\n");
    commitAll(repo, declared("migrate the formatter"));

    repo.git("checkout", "-b", "reformat");
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, declared("reformat"));
    repo.git("checkout", "-");
    repo.git("merge", "--no-ff", "-q", "reformat", "-m", "Merge reformat");

    // 合并预览那一支：没有 --range、也没有暂存改动 ⇒ 判 `HEAD~1..HEAD`。
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("按迁移放行");
  });
});

describe("pre-commit 现场：必须判「暂存区」而不是上一次提交", { timeout: 300_000 }, () => {
  /* 这组用例守的是一条**真实发生过的**失效：脚本接在 pre-commit 里，而
   * pre-commit 在提交对象生成**之前**运行，此时 `HEAD` 仍是上一次提交。
   * 早先实现无条件取 `HEAD~1..HEAD`，于是：
   *   · 本次暂存内容一个都没参与判定；
   *   · 只要上一次提交恰好是格式化提交（master 上的存量治理就是这样），
   *     门禁就把那次**已合并**的提交当成「本次」拦下，后续每个提交都过不去。
   * 现场表现是「我什么都没格式化，门禁却报 563 个纯格式化文件」。 */

  test("上一次提交是格式化提交、本次暂存是真实改动 → 放行（不被上一次污染）", ({ repo }) => {
    seedDirty(repo, 12);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, "format only"); // 上一次提交：12 个纯格式化（会被判为阻断）

    // 本次只暂存一个真实行为改动，还没提交（正是 pre-commit 的现场）。
    repo.write("src/lib/feature.ts", "export const answer = 42;\n");
    repo.git("add", "src/lib/feature.ts");

    const r = repo.run();
    expect(r.code).toBe(0);
    // 判的是暂存区：只有 1 个改动文件，且它不是「重排既有文件」。
    expect(r.output).toContain("改动 1 个源文件");
    expect(r.output).toContain("没有纯格式化的");
  });

  test("暂存区里一次格式化 12 个既有文件 → 仍然阻断（该拦的照样拦）", ({ repo }) => {
    // `seedDirty` 自己就提交了基线，这里不能再 commit 一次（会因无改动而失败）。
    seedDirty(repo, 12);

    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    repo.git("add", "-A"); // 暂存但**不提交**

    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("纯格式化 12 个");
  });

  test("暂存区只有纯新增文件 → 放行（新增不是「重排既有文件」）", ({ repo }) => {
    seedDirty(repo, 1);
    for (let i = 0; i < 12; i++) repo.write(`src/lib/new-${i}.ts`, "export const X = { a: 1 };\n");
    repo.git("add", "-A");

    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("没有纯格式化的");
  });

  test("无暂存改动时回落到「判 HEAD 这一次提交」（本地事后复盘口径不变）", ({ repo }) => {
    seedDirty(repo, 12);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, "format only"); // 已提交，暂存区是空的

    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("纯格式化 12 个");
  });

  /* 合并提交豁免：一次 merge 会把上游整批（含别处做的格式化）带进来，
   * 「拆成两次提交」在这里物理上不可能 —— 上游形态已定死在历史里。
   * 判据取 `MERGE_HEAD` 是否存在（pre-commit 跑在合并提交对象生成**之前**，
   * 此时该文件由 `git merge` 写入、合并完成后删除）。 */
  test("合并进行中（MERGE_HEAD 存在）→ 跳过判定，不阻断", ({ repo }) => {
    seedDirty(repo, 12);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    repo.git("add", "-A");
    // 模拟 `git merge` 的现场：pre-commit 触发时 MERGE_HEAD 已写好。
    writeFileSync(join(repo.dir, ".git", "MERGE_HEAD"), `${headSha(repo)}\n`);

    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("合并提交");
  });

  test("合并提交豁免不掩盖 CI 的 --range 盘点（按范围判，不受现场影响）", ({ repo }) => {
    seedDirty(repo, 12);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, "format only");
    writeFileSync(join(repo.dir, ".git", "MERGE_HEAD"), `${headSha(repo)}\n`);

    const r = repo.run(["--range", "HEAD~1..HEAD"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("纯格式化 12 个");
  });
});

describe("判定成本：整批一次 oxfmt，不按文件各起一次", { timeout: 300_000 }, () => {
  /* 这条用例守的是一条**真实发生过的**失效：早先的实现对每个文件各起一次
   * `prettier --stdin-filepath`，而格式化器的启动 + 插件加载是主要成本
   * （实测单文件约 400ms，与文件大小几乎无关）—— 12 个文件 ≈ 5s，正好把
   * vitest 默认的 testTimeout 顶穿。现场表现是 `Test timed out in 5000ms`，
   * 报在别的门禁用例上，看起来像「测试写得慢」，实际是门禁自身的调用形态
   * 在文件数上线性叠加（真人「批量格式化」提交改几十个文件时只会更慢）。
   *
   * 判据用**计数**而不是耗时：耗时在负载波动下必然抖动，而「格式化器起了
   * 几次」是确定的。整批口径下 batch 恰好一次（外加逐文件兜底，正常路径上为 0），
   * 逐文件口径下是「文件数 + 1」。用包装脚本记调用次数，
   * 断言与阈值无关的形态：次数远小于文件数。 */
  test("12 个文件的改动 → oxfmt 调用次数远小于文件数（整批口径）", ({ repo }) => {
    seedDirty(repo, 12);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, "format only");
    writeFileSync(join(repo.dir, ".gitignore"), "node_modules\n");

    const calls = instrumentOxfmt(repo);

    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("纯格式化 12 个");

    // 逐文件口径下这里会是 13；整批口径下是 1（兜底最多再补几次）。
    expect(calls()).toBeLessThanOrEqual(3);
  });
});

/**
 * 「回读比对」这一档的两端（真起 oxfmt，不打桩 —— 被锁的正是「谁来给答案」）。
 *
 * oxfmt 时代没有「格式化器输出了什么」可解析（prettier 时代那份 `(unchanged)` 标记就是
 * 这一类 —— 它把判据绑死在输出文案上，换一次工具就得重写一次）。现在判的是**写盘前
 * 留快照、写盘后回读比对**：结论只依赖文件内容。于是「改动前本来就规范」与「改动后
 * 正是它的规范形态」这两种形状都必须由**格式化器真给出来的形态**造 —— 手写一份
 * （旧用例就是这么写的）在换格式化器之后会变成「手写的那一份」，判据与夹具各说一套，
 * 而用例还全绿。
 */
describe("回读比对：本来就规范 / 改动后正是规范形态", { timeout: 300_000 }, () => {
  /** 真仓库里那份判据（`HERE` 就是真仓库，oxfmt 解析不受临时仓库影响）。 */
  function realJudge() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return /* SAFETY: 类型断言已复核 */ require("../scripts/check-reformat-only.cjs") as {
      classifyReformatOnly: (
        entries: Array<{ file: string; before: string; after: string }>,
      ) => Set<string>;
    };
  }

  test("改动前不规范、改动后正是 oxfmt 给的形态 → 判为纯格式化", ({ repo }) => {
    seedEmpty(repo);
    const messy = "export const P={a:1,\n\n\n  b:2};\n";
    const tidy = oxfmtText(messy);
    expect(tidy, "夹具造出来的形态必须与改动前不同").not.toBe(messy);
    expect([
      ...realJudge().classifyReformatOnly([{ file: "src/lib/p.ts", before: messy, after: tidy }]),
    ]).toEqual(["src/lib/p.ts"]);
  });

  test("改动前本来就规范、改动后是真实改动 → 不判为纯格式化", ({ repo }) => {
    seedEmpty(repo);
    const clean = oxfmtText("export const P = { a: 1, b: 2 };\n");
    const changed = "export const P = { a: 1, b: 3 };\n";
    expect([
      ...realJudge().classifyReformatOnly([
        { file: "src/lib/p.ts", before: clean, after: changed },
      ]),
    ]).toEqual([]);
  });
});

/**
 * 批量那一档的两件事：**退出 0 ⇒ 每个文件都拿到了结论**（改写与否交给回读比对），
 * **非 0 ⇒ 没有结论**，此时每个文件都要退回逐文件那一档再判一次。
 *
 * 判据是**格式化器被起了几次**而不是耗时：次数在负载波动下是确定的，耗时不是。
 * 计数靠换掉**临时仓库里那份 oxfmt 的入口**（见 `instrumentOxfmt`），而**被检查的
 * 那份脚本也要从临时仓库里 `require`** —— 真仓库那一份的 `HERE` 就是真仓库，换不掉。
 *
 * 真起 oxfmt 而不打桩：被锁的正是「谁来给答案」。
 */
describe("批量那一档：退出 0 一次给全部结论，非 0 逐文件兜底", { timeout: 300_000 }, () => {
  /**
   * 在临时仓库里加载**那一份**脚本（而不是真仓库的），再把一批文件喂给它 ——
   * 于是 wrapper 命中、计数有意义。
   */
  function verdictViaTempRepo(
    repo: GateRepo,
    entries: Array<{ file: string; before: string; after: string }>,
  ): Set<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tempMod = /* SAFETY: 类型断言已复核 */ require(
      join(repo.dir, "scripts", "check-reformat-only.cjs"),
    ) as {
      classifyReformatOnly: typeof entries extends never
        ? never
        : (e: typeof entries) => Set<string>;
    };
    return tempMod.classifyReformatOnly(entries);
  }

  test("本来就规范的文件：整批一次就够，不再为它另起一次", ({ repo }) => {
    seedEmpty(repo);
    const before = oxfmtText("export const P = { a: 1, b: 2 };\n");
    const after = "export const P = { a: 1, b: 3 };\n";

    const calls = instrumentOxfmt(repo);
    const value = verdictViaTempRepo(repo, [{ file: "src/lib/keep-clean.ts", before, after }]);

    expect([...value], "改动后不是它的规范形态 → 不是纯格式化").toEqual([]);
    expect(
      calls(),
      "整批那一次已经给了结论（回读没变），再起一次是白付 —— 实际提交里" + "绝大多数文件都在这一档",
    ).toBe(1);
  });

  test("整批没跑起来 ⇒ 每个文件各退一次兜底（没结论不许当成「本来就规范」）", ({ repo }) => {
    seedEmpty(repo);
    const messy = "export const P={a:1,\n\n\n  b:2};\n";
    const tidy = oxfmtText(messy);

    // 整批那一次故意以非 0 退出 ⇒ 没有结论，必须退回逐文件那一档。
    const calls = instrumentOxfmt(repo, true);
    const value = verdictViaTempRepo(repo, [
      { file: "src/lib/messy.ts", before: messy, after: tidy },
    ]);

    expect([...value], "兜底那一档照样给出正确答案").toEqual(["src/lib/messy.ts"]);
    expect(calls(), "整批那一次失败后，这一个文件补了一次逐文件判定").toBe(2);
  });

  test("被改写的那一档：规范形态取自回读，不再另起一次", ({ repo }) => {
    seedEmpty(repo);
    const messy = "export const P={a:1,\n\n\n  b:2};\n";
    const tidy = oxfmtText(messy);

    const calls = instrumentOxfmt(repo);
    const value = verdictViaTempRepo(repo, [
      { file: "src/lib/messy.ts", before: messy, after: tidy },
    ]);

    expect([...value], "改动后正是格式化器给出的形态 → 纯格式化").toEqual(["src/lib/messy.ts"]);
    expect(calls(), "改写过的文件由整批那一次给出结论").toBe(1);
  });
});

describe("补丁解析（纯函数，不跑 git）", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = /* SAFETY: 类型断言已复核 */ require("../scripts/check-reformat-only.cjs") as {
    collectChangedFiles: (patch: string) => Array<{ before: string; after: string }>;
    LIMIT: number;
  };

  test("只收源码扩展名，忽略图片", () => {
    const patch = [
      "diff --git a/src/lib/a.ts b/src/lib/a.ts",
      "--- a/src/lib/a.ts",
      "+++ b/src/lib/a.ts",
      "diff --git a/docs/x.png b/docs/x.png",
      "diff --git a/README.md b/README.md",
    ].join("\n");
    expect(mod.collectChangedFiles(patch).map((f) => f.after)).toEqual([
      "src/lib/a.ts",
      "README.md",
    ]);
  });

  test("阈值是 10：低于它的顺手格式化不该阻断", () => {
    expect(mod.LIMIT).toBe(10);
  });
});

/**
 * `--staged` 的扫描面（ISSUE #1993 / 规范 §13.5.21）。
 *
 * 这条判据在**只改文档 / 只改 `changelog.d/`** 的提交上一份源文件都列不出来，却仍要
 * 把暂存区与 `HEAD` 各取一遍、对每个文件跑一次 oxfmt。收窄之后那些提交直接跳过。
 *
 * 收窄最坏的失效形态是**静默漏判**：根清单写窄了，某一处的纯格式化提交从此不再触发
 * 这条判据，而没有任何东西会红。所以这里不做「清单里有几个元素」这种空转断言 ——
 * 每条用例都**真起脚本**，看它判没判到。
 */
describe("`--staged`：面上没有源文件时跳过，有源文件时照旧判", () => {
  test("只暂存文档 / 碎片 ⇒ 跳过，而且不碰格式化器", ({ repo }) => {
    seedEmpty(repo);
    repo.write("docs/note.md", "# 随手笔记\n");
    repo.write("changelog.d/1993-x.md", "## Added\n\n- 一条\n");
    repo.git("add", "-A");

    /* 这一档**必须有漂亮的下界**：扫描面靠 `readdir` 现算，而这套夹具只建了
     * `src/lib` / `scripts` / `docs` / `changelog.d` 四层 —— 于是 `docs/` 与
     * `changelog.d/` 确实在面上（它们是源文件扩展名，本判据会判），这一步
     * **不该跳过**。所以这条用例判的是「跳过的原因是面，不是别的」：
     * 把两份文档从我面上挪走之后必须跳。 */
    rmSync(join(repo.dir, "docs"), { recursive: true, force: true });
    rmSync(join(repo.dir, "changelog.d"), { recursive: true, force: true });
    repo.git("add", "-A");
    const r = repo.run(["--staged"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("跳过");
  });

  test("面上一份源文件都没有时跳过；有 `docs/**.md` 这种也在面上（扩展名口径）", ({ repo }) => {
    seedEmpty(repo);
    repo.write("docs/note.md", "# 随手笔记\n");
    repo.git("add", "-A");
    const r = repo.run(["--staged"]);
    /* `SOURCE_RE` 认得 `.md` ⇒ 文档目录本来就在面上。收窄只掐「面上真的一份都没有」，
     * 不按「改了代码没有」判 —— 后者会让「只改文档」的提交绕过这条判据。 */
    expect(r.output).not.toContain("未触及扫描面");
  });

  test("暂存里有一份源文件 ⇒ 不跳过（`src/` 与根级文件都算）", ({ repo }) => {
    seedEmpty(repo);
    for (const rel of ["src/lib/probe.ts", "scripts/probe.mjs"]) {
      repo.write(rel, "export const A={a:1};\n");
      /* **点名 add 这一份**，不用 `-A`：`.gitignore` 里 `node_modules` 是一条
       * 目录规则，它会连带忽略 `node_modules/oxfmt` 这一整棵（含夹具软链进来的
       * 那些包），于是 `add -A` 之后暂存清单可能只剩一个
       * 「什么都没加」的空集 —— 断言「面被碰到」的前提就不成立了。 */
      repo.git("add", rel);
      const r = repo.run(["--staged"]);
      expect(r.code, `${rel} 被跳过了 —— 扫描面写窄了`).toBe(0);
      expect(r.output, `${rel} 应当被判到`).not.toContain("未触及扫描面");
      repo.git("reset", "-q");
      rmSync(join(repo.dir, rel), { force: true });
    }
  });

  test("根级源文件（如 `package.json`）也在面上 —— 空串根不命中任何东西", ({ repo }) => {
    seedEmpty(repo);
    repo.write("package.json", '{ "name": "probe" }\n');
    repo.git("add", "-A");
    const r = repo.run(["--staged"]);
    expect(r.output).not.toContain("未触及扫描面");
  });

  test("带了 `--range` 时一律不跳（它按显式范围判，与暂存区无关）", ({ repo }) => {
    seedEmpty(repo);
    repo.write("docs/note.md", "# 只有文档\n");
    repo.git("add", "-A");
    const r = repo.run(["--staged", "--range", "HEAD~1..HEAD"]);
    expect(r.output).not.toContain("未触及扫描面");
  });
});
