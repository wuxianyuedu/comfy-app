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
import { dirname, join, resolve } from "node:path";
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
/* 区间两端的取法直接单测机制层（见「区间两端」那条用例的理由）。 */
import { previewRangeEnds } from "../scripts/reformat-preview-range.mjs";

/** `perCommitShapeOf` 是判据的**自测入口**（理由见那一条用例的头注）。判据是 `.cjs`，
 * 所以只能 `require` —— 与 `check-format.test.ts` 同形。 */
/* SAFETY: 类型断言已复核 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { perCommitShapeOf } = require("../scripts/check-reformat-only.cjs") as {
  perCommitShapeOf: (
    rev: string,
    spec?: { root?: string; limit?: number },
  ) => {
    ok: boolean;
    offenders: Array<string>;
    commits: Array<{ rev: string; unknown?: boolean }>;
  };
};

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
    /* 逐提交护栏（护栏 ②）的机制层 —— 判据 `require` 它，少一份就是
     * `MODULE_NOT_FOUND`（`copyGateDeps` 只追**同目录**依赖）。 */
    { from: "scripts/reformat-per-commit.mjs", to: "scripts/reformat-per-commit.mjs" },
    {
      from: "src/lib/process/executable-resolve.ts",
      to: "src/lib/process/executable-resolve.ts",
    },
    {
      from: "src/lib/process/platform.ts",
      to: "src/lib/process/platform.ts",
    },
    /* `executable-resolve.ts` 按职责拆出的两块（它越过文件长度硬闸时切的）：
     * 前者被它静态 import（pnpm 那一族）、后者又被前者 import —— 同一条**链**，
     * 少一份临时仓库里的 `shell.mjs` 就在加载阶段 `ERR_MODULE_NOT_FOUND`。 */
    {
      from: "src/lib/process/pnpm-resolve.ts",
      to: "src/lib/process/pnpm-resolve.ts",
    },
    {
      from: "src/lib/process/version-compare.ts",
      to: "src/lib/process/version-compare.ts",
    },
    /* 合并预览那一支的「本次改动从哪算起」走的不是本脚本自己那份逻辑，而是
     * `changed-scope.mjs`（`shell-gate --base` 同一个函数）。`.cjs` 只能动态
     * `import()`，缺了它脚本以 exit 2 结束 —— 而那条链上的每一份都要在
     * （`git-name-status` 又静态 import `launcher-core/sync-attribution.mjs`）。 */
    { from: "scripts/changed-scope.mjs", to: "scripts/changed-scope.mjs" },
    /* 区间两侧的判定收在机制层（`reformat-preview-range.mjs`，`.cjs` 动态 import 它）——
     * 拆出去的是「与平台拓扑打交道」那一段，判据本体不动。 */
    { from: "scripts/reformat-preview-range.mjs", to: "scripts/reformat-preview-range.mjs" },
    { from: "scripts/git-name-status.mjs", to: "scripts/git-name-status.mjs" },
    { from: "scripts/base-check/git-ref.mjs", to: "scripts/base-check/git-ref.mjs" },
    {
      from: "scripts/launcher-core/sync-attribution.mjs",
      to: "scripts/launcher-core/sync-attribution.mjs",
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

/** 同 `commitAll`，但把那个提交的 sha 交回来（造合并预览那两条要它当 `CNB_COMMIT`）。 */
function commitAllReturningSha(repo: GateRepo, message: string): string {
  commitAll(repo, message);
  return headSha(repo);
}

/**
 * 在临时仓库里对文件跑 oxfmt —— 用**仓库真实那一版**格式化器。
 *
 * 夹具造出来的「改动后」这一侧必须是**格式化器真的给出的形态**：手写一份（prettier
 * 时代就是这么写的）在换格式化器之后会变成「手写的那一份」，判据与夹具各说一套，
 * 而用例还全绿 —— 那是最难看的一类失效。所以夹具与判据走**同一个入口**。
 */
function formatInPlace(repo: GateRepo, rel: string | Array<string>): void {
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
function seedDirty(repo: GateRepo, n: number): Array<string> {
  const files: Array<string> = [];
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
    for (let i = 0; i < 12; i++) {
      repo.write(`src/lib/added-${i}.ts`, "export const X={a:1};\n");
    }
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

  /* **三点区间（`A...B`）必须与两点判出同一个答案**（ISSUE #3024）。
   *
   * 现场：平台 `重档静态判据` 那一格红在「格式化提交分离 —— 本次改动 162 个源文件，
   * 其中纯格式化 120 个」，而**同一批改动**在本地按两点区间判也是 120 个。判据没报错，
   * 报得也对 —— 错的是另一处：CI 盘点是按 `A...B` 调的，而入口按 `".."` 裸切，
   * 切出 `["A", ".B"]`，于是每一份文件的「改动后」都取不到，**全部**被
   * `collectPairs` 按「任一侧取不到」跳过。它既不报错也不说「没判」，屏幕上是一句
   * 干干净净的 `[ok] 本次改动 … 没有纯格式化的` —— 恒绿的判据。
   *
   * 这一条把两个区间形式钉成同一份判决：三点若不等于两点，说明 `after` 那一侧又丢了。 */
  test("三点区间（`A...B`）与两点区间判出同一个结论", ({ repo }) => {
    seedDirty(repo, 12);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, declared("reformat"));
    repo.write("src/lib/feature.ts", "export const FEATURE = 1;\n");
    commitAll(repo, declared("feature"));

    const twoDots = repo.run(["--range", "HEAD~2..HEAD"]);
    const threeDots = repo.run(["--range", "HEAD~2...HEAD"]);
    expect(threeDots.code).toBe(twoDots.code);
    expect(threeDots.output).toContain("纯格式化 12 个");
  });

  /* **区间两侧是同一个提交 ⇒ 必须是 `skip`，不是「没有纯格式化」**（ISSUE #3026）。
   *
   * 现场：平台那一跑给的区间两侧取成了**同一个 sha**（`#3022` 那条修法里起点用的
   * 目标 sha 恰是 HEAD），于是每一份配对的 `before` / `after` 都取不到、
   * `classifyReformatOnly` 连 oxfmt 都没起过 —— 屏幕上却是一句
   * `[ok] 本次改动 N 个源文件，没有纯格式化的`。那两句在终端里一模一样，而一句是
   * 「判过了」、一句是「没判」，三态口径（§13.5.25）在这里塌成了两态。 */
  test("区间两侧是同一个提交 ⇒ 报「没判」，不冒充「没有纯格式化」", ({ repo }) => {
    seedDirty(repo, 12);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, declared("reformat"));

    const head = headSha(repo);
    const r = repo.run(["--range", `${head}..${head}`]);
    expect(r.code).toBe(0);
    /* 空 patch 那一支先命中（也是 `skip`）—— 这里钉的是**它不许冒充「判过了」**。 */
    expect(r.output).toContain("[skip]");
    expect(r.output).not.toContain("没有纯格式化的");
  });

  /* 「逐提交的读数取不到」≠「这条提交干净」（ISSUE #2990 的 `cnb-rmn-1k6bqsdfg`）。
   *
   * 现场：平台那一格判的是**合成合并预览**，护栏 ② 一个 offender 都没点名（屏幕上是
   * 空的），而汇总仍报一批纯格式化 ⇒ 判决落进「声明了但重排没独占」那一支 ——
   * 话术指着一件没发生的事，读者只能去猜。
   *
   * 根因在取数：**「这条提交没改文件」与「这条提交的 diff 没读到」折成同一支**（空
   * patch 就 `continue`）—— 后者是**没测**，却被 `offenders` 读成了「干净」。`ok`
   * 只看 `offenders`，于是护栏 ② 在「一条都没读到」时照样说通过。
   *
   * ⚠️ 这一条打的是判据导出的 `perCommitShapeOf`：`--range` 那一跳会先
   * `git diff <A>..<B>`，而区间两端都要能解析成**提交**，这一档的父恰恰读不到
   * （`fatal: Invalid revision range`）—— 于是那一格在进程外根本没有入口。入口本身是
   * 薄的：它把这条提交交给同一份逐提交循环。
   *
   * 变异证明：撤掉「父对象读不到 ⇒ unknown」那条判定之后这一条当场红。 */
  test("逐提交取不到 diff → 记 unknown，不许被读成干净（护栏 ②）", ({ repo }) => {
    seedDirty(repo, 12);
    repo.write("src/lib/feature.ts", "export const FEATURE = 1;\n");
    commitAll(repo, declared("migrate the formatter"));
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, declared("reformat"));

    const dirt = (args: Array<string>) =>
      execFileSync("git", args, { cwd: repo.dir, encoding: "utf8" }).trim();

    /* 取一条**父提交不存在**的提交：`cat-file` 读得到它自己（不解析父），而它与父的
     * diff 取不到 —— 这正是「历史形状在、对象不全」那一档。
     * ⚠️ 父哈希是**定长 40 位**：换成更短的会让 `cat-file commit` 当场 bad object，
     * 那时连这条提交本身都读不到，判的就变成另一件事了。 */
    const raw = dirt(["cat-file", "commit", "HEAD"]).replace(
      /^parent .*$/m,
      `parent ${"1".repeat(40)}`,
    );
    const orphan = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], {
      cwd: repo.dir,
      encoding: "utf8",
      input: `${raw}\n`,
    })
      .toString()
      .trim();

    /* 前提：这条提交**本身**读得到（`cat-file` 不解析父），而与父的 diff 取不到。 */
    expect(dirt(["cat-file", "commit", orphan])).toContain("parent 1111");
    expect(() => dirt(["diff", "--name-only", `${"1".repeat(40)}..${orphan}`])).toThrow();

    const got = perCommitShapeOf(orphan, { root: repo.dir });
    expect(got.ok, "取不到 diff 的提交不许被读成干净").toBe(false);
    expect(got.offenders.join("、")).toContain("取不到与父提交的 diff");
  });

  /* 护栏 ① 只问**含重排**的提交（ISSUE #3054）：与迁移无关的功能提交不该被它判。
   *
   * 现场：PR #2990 是 `printWidth` 迁移，而它的生命周期里追加了 5 笔**修判据本身**的
   * 功能提交（2~8 个文件、零重排）。`every()` 口径要求它们也写 `format-migration:`，
   * 于是一个合规的迁移 PR 被 `172 份里 118 份` 判红（本格平台的现场读数）。
   * 那 5 笔没碰重排、也不该撒谎写迁移尾注 ⇒ 它们不参与这一关。 */
  test("功能提交没声明、但**含重排**的那几笔都声明了 ⇒ 按迁移放行（护栏 ①）", ({ repo }) => {
    seedDirty(repo, 12);
    repo.write("src/lib/feature.ts", "export const FEATURE = 1;\n");
    commitAll(repo, "migrate the formatter"); // 零重排的功能提交：不参与护栏 ①
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, declared("reformat"));

    const r = repo.run(["--range", "HEAD~2..HEAD"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("按迁移放行");
  });

  test("**含重排**的提交漏了声明 ⇒ 不按迁移读（护栏 ① 不放宽）", ({ repo }) => {
    seedDirty(repo, 12);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, "reformat"); // 这一条是重排，却**没**写尾注

    const r = repo.run(["--range", "HEAD~1..HEAD"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("格式化提交分离");
  });

  /* **空提交不参与护栏 ①**（ISSUE #3034）。
   *
   * 现场：`pnpm ship --rerun-ci` 推的那笔空提交正文固定为
   * `ci: rerun (ship --rerun-ci)`、不带任何尾注，而它进的是 PR 区间。PR #2990
   * 重跑三次之后，一个原本合规的迁移 PR 被 `166 份里 118 份纯格式化` 判红
   * （构建 `cnb-4ig-1k6csckqj`）；同一个区间把三笔 rerun 摘掉就 `[ok] 按迁移放行`。
   * 空提交一份文件都没碰，对「这次重排有没有独占」不提供任何信息 ⇒ 不许它否决
   * 整个人证（护栏 ② 那边空提交天然是 0/0、自动干净，两处口径由此一致）。 */
  test("区间里夹着没尾注的**空提交**（如 --rerun-ci）⇒ 仍按迁移放行", ({ repo }) => {
    seedDirty(repo, 12);
    repo.write("src/lib/feature.ts", "export const FEATURE = 1;\n");
    commitAll(repo, declared("migrate the formatter"));
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    commitAll(repo, declared("reformat"));
    // 重派生流水线的那一笔：零文件改动、也没有尾注。
    repo.git("commit", "--allow-empty", "-q", "-m", "ci: rerun (ship --rerun-ci)");

    const r = repo.run(["--range", "HEAD~3..HEAD"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("按迁移放行");
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
    for (let i = 0; i < 12; i++) {
      repo.write(`src/lib/new-${i}.ts`, "export const X = { a: 1 };\n");
    }
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

  /* 合并**预览**（ISSUE #3022 / #3035）：平台那一格没有暂存区，判据落到「判 HEAD
   * 这一次提交」那一支，而那个区间的两侧不能是 `HEAD~1..HEAD`。
   *
   * ## 为什么是一对用例，而不是一条
   *
   * 平台拼出来的合并提交**不保证把本分支放在第一父**：现场（`cnb-3lk-1k6d2lm2l`）
   * 第一父是**目标分支**那一侧，于是 `HEAD~1..HEAD` 里全是主干带来的提交（它们没有
   * `format-migration:` 尾注），日志是一屏「声明了但重排没独占」，而本次改动是什么
   * 与那条红毫无关系。而 #3022 早先的修法是「起点换成平台给的目标 sha、终点仍是
   * `HEAD`」—— 那条只在「第一父 = 本 PR」时对，反过来就把**主干那批**算进分母
   * （两种拼法各红过好几十次）。
   *
   * ⇒ 现在两侧都取自合成提交的父关系（`changed-scope.mjs` 的
   * `reconcileSyntheticMergeFace()`）：区间恒为「第一父..第一父名下的那个 sha」，
   * 与拼法无关。两条用例各演一种拼法。
   *
   * ## 场景（两种拼法共用）
   *
   * 主干那边有一笔**别的**重排（没有尾注），本分支上是「声明了迁移的重排」，
   * 平台把两者合成一个合并提交。真结论只有一个：按迁移放行。
   */
  /** 造出「主干一笔无尾注重排 + 分支一笔声明了迁移的重排」，返回两个 sha。 */
  function twoSidedHistory(repo: GateRepo) {
    seedDirty(repo, 12); // 自带一次提交 ⇒ 未格式化版本进历史
    const fork = headSha(repo);
    /* 主干那边：别人一笔没有尾注的重排（它不该进本 PR 的分母）。 */
    repo.write("src/lib/main-only.ts", "export const M={a:1,b:'y'};\n");
    formatInPlace(repo, ["src/lib/main-only.ts"]);
    commitAll(repo, "主干：另一批重排（没有尾注）");
    const mainHead = headSha(repo);
    /* 分支从分叉点分出，在分支上做重排并声明迁移。 */
    repo.git("checkout", "-q", "-b", "branch-side", fork);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    const branchSha = commitAllReturningSha(repo, "format only\n\nformat-migration: 用例声明");
    return { fork, mainHead, branchSha };
  }

  /**
   * 区间**终点**不许取合成提交（ISSUE #3038 的第二处，现场 `cnb-o9p-1k6d5ohhj`）。
   *
   * `第一父..合成提交` 在「第一父 = 目标分支」那种拼法下正好是**整个 PR 区间**：
   * 逐提交口径看不出问题（合成提交自己会被 `--no-merges` 摘掉），可它把「本 PR 那条线」
   * 与「这次合并带进来的主干那一批」混成一段，`report()` 的汇总口径按整段算分母 ——
   * 实测 170 份里 118 份被判纯格式化，而同一区间逐提交复算只有一条 offender。
   * ⇒ 终点取**第二父**（本 PR 那一侧的 tip）。
   *
   * 造法：主干上有一笔**没有尾注的重排**（它只该出现在「整段」口径里），本分支上是一笔
   * 声明了迁移的重排。若终点错取合成提交，主干那一笔会进分母 ⇒ 判成「不按迁移读」。
   */
  /**
   * 区间**两端**的取法（ISSUE #3038 的第二处，现场 `cnb-o9p-1k6d5ohhj`）。
   *
   * 这一条**直接钉机制层的返回值**，不走端到端：端到端只能看出「绿了没有」，而这里
   * 要钉的是「区间是哪两个端点」—— 取错了可能照样绿（主干那批恰好没跨过阈值），
   * 那种绿正是这次事故的形状（平台上 170 份里 118 份被判纯格式化，而逐提交复算
   * 只有一条 offender）。
   */
  test("区间两端：起点取分叉点、终点取第二父（不取合成提交）", () => {
    const calls: Array<string> = [];
    const gitMap: Record<string, string> = {
      "rev-list --parents -n 1 HEAD": "HEAD_SHA FIRST_PARENT SECOND_PARENT",
      "rev-list --parents SECOND_PARENT..HEAD": "SECOND_PARENT",
      "rev-list --first-parent SECOND_PARENT..HEAD": "SECOND_PARENT",
      "merge-base FIRST_PARENT SECOND_PARENT": "FORK_POINT",
    };
    const r = previewRangeEnds({
      gitOrEmpty: (args: string[]) => {
        calls.push(args.join(" "));
        return gitMap[args.join(" ")] ?? "";
      },
      env: { CNB_COMMIT: "SECOND_PARENT", CNB_PULL_REQUEST_TARGET_SHA: "TARGET" },
      resolveBaseRef: () => ({ ok: true, ref: "TARGET", via: "用例" }),
      reconcile: () => ({
        used: true,
        firstParent: "FIRST_PARENT",
        head: "HEAD_SHA",
        files: [],
        renamedFrom: [],
        deduped: [],
        base: "TARGET",
      }),
      warn: (line: string) => calls.push(`warn:${line}`),
    });
    /* 终点**不是**合成提交（`HEAD_SHA`）：`第一父..合成提交` 会连主干那一批一起算进来。 */
    expect(r.after).toBe("SECOND_PARENT");
    /* 起点**不是**第一父：第一父是「目标分支那一刻的顶端」，它自己也落过提交。 */
    expect(r.before).toBe("FORK_POINT");
    expect(calls).toContain("merge-base FIRST_PARENT SECOND_PARENT");
  });

  test("合并预览（第一父 = 目标分支侧）⇒ 区间只含本 PR 那批提交", ({ repo }) => {
    const { fork, mainHead, branchSha } = twoSidedHistory(repo);
    /* 平台拼法之一：先落在主干上（分叉点那一笔）、再把 PR 那侧合进来 ⇒ 第一父是**主干**。 */
    repo.git("checkout", "-q", "branch-side");
    repo.git("reset", "--hard", "-q", fork);
    repo.git("merge", "--no-ff", "-q", "-m", "merge preview", branchSha);
    /* `CNB_COMMIT` 是源分支 head（平台侧恒给），父关系认得出这次合成。 */
    const r = repo.run([], {
      env: {
        CNB_PULL_REQUEST_TARGET_SHA: mainHead,
        CNB_COMMIT: branchSha,
      },
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain("按迁移放行");
    /* 主干那笔没有尾注的提交**不许**进区间 —— 它进去就会把声明判成 false。 */
    expect(r.output).not.toContain("不按迁移读");
  });

  test("合并预览（第一父 = 本分支侧）⇒ 同一份改动给同一个答案", ({ repo }) => {
    const { mainHead, branchSha } = twoSidedHistory(repo);
    /* 平台拼法之二：先切到 PR 那侧、再把主干合进来 ⇒ 第一父是**本分支**。
     * 这一形态下 `HEAD~1..HEAD` 恰好是对的那个区间，而 `#3022` 那条「起点换目标
     * sha」恰好是错的 —— 两条用例合起来才钉得住「与拼法无关」。 */
    repo.git("checkout", "-q", "branch-side");
    repo.git("merge", "--no-ff", "-q", "-m", "merge main", mainHead);
    const r = repo.run([], {
      env: {
        CNB_PULL_REQUEST_TARGET_SHA: mainHead,
        CNB_COMMIT: branchSha,
      },
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain("按迁移放行");
  });

  test("认不出合成提交（没有 CNB_COMMIT）⇒ 按拓扑钉区间，不落回 HEAD~1", ({ repo }) => {
    const { fork, mainHead, branchSha } = twoSidedHistory(repo);
    repo.git("checkout", "-q", "branch-side");
    repo.git("reset", "--hard", "-q", fork);
    repo.git("merge", "--no-ff", "-q", "-m", "merge preview", branchSha);
    /* 没有 `CNB_COMMIT` ⇒ `reconcileSyntheticMergeFace()` 认不出这次合成，但它们
     * **仍然是**一次合并预览。此时退回 `HEAD~1..HEAD` 就是红过的那个形状（第一父是
     * 主干 ⇒ 主干那批进分母）—— 所以按拓扑挑起点：`merge-base(目标 sha, HEAD)`
     * 的 `first-parent` 计数与总数相等 ⇒ 它是干净的分叉点。 */
    const r = repo.run([], { env: { CNB_PULL_REQUEST_TARGET_SHA: mainHead } });
    expect(r.code).toBe(0);
    expect(r.output).toContain("按迁移放行");
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

  /* 上面两条都把 `MERGE_HEAD` 写在 `<根>/.git/` 下面 —— 那是**主检出**的形状。
   * 链接工作树（`git worktree add` 出来的那种检出）里 `.git` 是一个
   * `gitdir: …` **文件**，硬拼 `<根>/.git/MERGE_HEAD` 永远读不到 ⇒ 这一档豁免
   * 在那种检出里**永不点火**（ISSUE #2785 的本体：同族缺陷 #2747 修在
   * `check-format.cjs`，而这一处没人看见，因为防这一族的扫描面当时只收 `.mjs`）。 */
  test("链接工作树里豁免照样点火（那里的 `.git` 是文件，不是目录）", ({ repo }) => {
    seedDirty(repo, 12);
    formatInPlace(
      repo,
      Array.from({ length: 12 }, (_, i) => `src/lib/dirty-${i}.ts`),
    );
    repo.git("add", "-A");
    const wt = mkdtempSync(join(tmpdir(), "reformat-wt-"));
    // git 不许在已有非空目录上挂工作树 ⇒ 先腾出那个空目录。
    rmSync(wt, { recursive: true, force: true });
    try {
      repo.git("worktree", "add", "--detach", wt, "HEAD");
      /* 工作树自己的 gitdir 由 **git 自己说**，不猜 `<主>/.git/worktrees/<名>`
       * （那一层 git 会按目录名归一，Windows 上还大小写不敏感 —— 猜中就是一次
       * 偶绿的用例）。 */
      const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
        cwd: wt,
        encoding: "utf8",
      }).trim();
      writeFileSync(resolve(wt, gitDir, "MERGE_HEAD"), `${headSha(repo)}\n`);

      const r = repo.run([], { cwd: wt });
      expect(r.code, `output=${r.output}`).toBe(0);
      expect(r.output).toContain("合并提交");
    } finally {
      repo.git("worktree", "prune");
    }
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
    /* SAFETY: 类型断言已复核 */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../scripts/check-reformat-only.cjs") as {
      classifyReformatOnly: (
        entries: Array<{ after: string; before: string; file: string }>,
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
    entries: Array<{ after: string; before: string; file: string }>,
  ): Set<string> {
    /* SAFETY: 类型断言已复核 */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tempMod = require(join(repo.dir, "scripts", "check-reformat-only.cjs")) as {
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
  /* SAFETY: 类型断言已复核 */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../scripts/check-reformat-only.cjs") as {
    collectChangedFiles: (patch: string) => Array<{ after: string; before: string }>;
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
